import type { Chess } from "chess.js";
import { opponentSettings } from "./engine-adapter";
import type { AssistantSnapshot, Difficulty, PlayerColor, PlayerProfile, PostGameSummary } from "./game-types";
import { createClient } from "./supabase/client";
import { trainingRating } from "./training-analytics";

export async function loadCloudProfile(): Promise<PlayerProfile | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("display_name,avatar_seed,total_games,wins,losses,draws,hint_usage,adaptive_level,training_points,training_minutes,current_streak,best_streak,last_level_change_game,milestones,independent_moves,independent_accuracy,estimated_strength").maybeSingle();
  if (!data) return null;
  return {
    displayName: data.display_name || "Chess learner",
    avatarSeed: !data.avatar_seed || data.avatar_seed === "rivalmind-player" ? user.id : data.avatar_seed,
    games: data.total_games,
    wins: data.wins,
    losses: data.losses,
    draws: data.draws,
    hintUsage: data.hint_usage,
    adaptiveLevel: data.adaptive_level,
    recentResults: [],
    trainingPoints: data.training_points,
    trainingMinutes: data.training_minutes,
    currentStreak: data.current_streak,
    bestStreak: data.best_streak,
    lastLevelChangeGame: data.last_level_change_game,
    milestones: Array.isArray(data.milestones) ? data.milestones : [],
    independentMoves: data.independent_moves ?? 0,
    independentAccuracy: Number(data.independent_accuracy) || 0,
    estimatedStrength: data.estimated_strength ?? 900,
  };
}

export async function syncProfile(profile: PlayerProfile, assistantEnabled: boolean) {
  const supabase = createClient();
  if (!supabase) return { synced: false as const, reason: "not-configured" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { synced: false as const, reason: "guest" };
  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id,
    display_name: profile.displayName.trim() || user.user_metadata?.display_name || user.email?.split("@")[0] || "Chess learner",
    avatar_seed: profile.avatarSeed || user.id,
    total_games: profile.games,
    wins: profile.wins,
    losses: profile.losses,
    draws: profile.draws,
    hint_usage: profile.hintUsage,
    adaptive_level: profile.adaptiveLevel,
    assistant_enabled: assistantEnabled,
    rating: trainingRating(profile),
    training_points: profile.trainingPoints,
    training_minutes: profile.trainingMinutes,
    current_streak: profile.currentStreak,
    best_streak: profile.bestStreak,
    last_level_change_game: profile.lastLevelChangeGame,
    milestones: profile.milestones,
    independent_moves: profile.independentMoves,
    independent_accuracy: profile.independentAccuracy,
    estimated_strength: profile.estimatedStrength,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
  return { synced: true as const };
}

export async function syncCompletedGame(args: {
  game: Chess;
  difficulty: Difficulty;
  profile: PlayerProfile;
  summary: PostGameSummary;
  timeline: AssistantSnapshot[];
  assistantEnabled: boolean;
  playerColor: PlayerColor;
}) {
  const supabase = createClient();
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await syncProfile(args.profile, args.assistantEnabled);
  const settings = opponentSettings(args.difficulty, args.profile);
  const { data: gameRow, error: gameError } = await supabase.from("games").insert({
    user_id: user.id,
    status: "complete",
    result: args.summary.result,
    difficulty: args.difficulty,
    opponent_elo: settings.elo,
    pgn: args.game.pgn(),
    final_fen: args.game.fen(),
    summary: { outcomeTitle: args.summary.outcomeTitle, outcomeDetail: args.summary.outcomeDetail, scoreline: args.summary.scoreline, termination: args.summary.termination, headline: args.summary.headline, well: args.summary.well, watch: args.summary.watch, keyMoment: args.summary.keyMoment, decisions: args.summary.decisions, newMilestones: args.summary.newMilestones },
    player_color: args.playerColor,
    time_control: args.summary.telemetry.timeControl,
    total_time_ms: args.summary.telemetry.totalTimeMs,
    player_think_ms: args.summary.telemetry.playerThinkMs,
    rival_think_ms: args.summary.telemetry.rivalThinkMs,
    coach_uses: args.summary.telemetry.coachUses,
    coach_time_ms: args.summary.telemetry.coachTimeMs,
    accuracy: args.summary.telemetry.analyzedMoves ? args.summary.telemetry.accuracy : null,
    best_move_matches: args.summary.telemetry.bestMoveMatches,
    analyzed_moves: args.summary.telemetry.analyzedMoves,
    adaptive_before: args.summary.telemetry.adaptiveBefore,
    adaptive_after: args.summary.telemetry.adaptiveAfter,
    training_points_earned: args.summary.telemetry.trainingPointsEarned,
    completed_at: new Date().toISOString(),
  }).select("id").single();
  if (gameError) throw gameError;
  const verbose = args.game.history({ verbose: true });
  const rows = verbose.map((move, index) => {
    const snapshot = args.timeline.find((item) => item.ply === index + 1);
    return {
      game_id: gameRow.id,
      user_id: user.id,
      ply: index + 1,
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ""}`,
      fen_after: move.after,
      evaluation_cp: snapshot?.whiteScore,
      wdl: snapshot?.result.wdl ?? null,
      depth: snapshot?.result.depth,
      nodes: snapshot?.result.nodes,
      classification: snapshot?.severity,
      explanation: snapshot?.explanation,
      principal_variation: snapshot?.result.candidates[0]?.lineSan ?? [],
      decision_source: args.summary.decisions.find((item) => item.ply === index + 1)?.source ?? null,
      coach_suggestions: args.summary.decisions.find((item) => item.ply === index + 1)?.suggestedMoves ?? [],
    };
  });
  if (rows.length) {
    const { error } = await supabase.from("moves").insert(rows);
    if (error) throw error;
  }
  const { error: ratingError } = await supabase.from("rating_history").insert({ user_id: user.id, game_id: gameRow.id, rating: trainingRating(args.profile) });
  if (ratingError) throw ratingError;
  if (args.summary.newMilestones.length) {
    const { error: achievementError } = await supabase.from("achievements").upsert(args.summary.newMilestones.map((name) => ({
      user_id: user.id,
      code: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      description: "Unlocked through your RivalMind training journey.",
      unlocked_at: new Date().toISOString(),
    })), { onConflict: "user_id,code" });
    if (achievementError) throw achievementError;
  }
  const independentPly = new Set(args.summary.decisions.filter((item) => item.source === "independent").map((item) => item.ply));
  const playerMoves = verbose.map((move, index) => ({ move, ply: index + 1 })).filter(({ ply }) => (ply - 1) % 2 === (args.playerColor === "b" ? 1 : 0) && independentPly.has(ply)).map(({ move }) => move);
  const forcingMoves = playerMoves.filter((move) => Boolean(move.captured) || move.san.includes("+")).length;
  const earlyCastle = playerMoves.slice(0, 10).some((move) => move.san === "O-O" || move.san === "O-O-O");
  const { data: currentStats } = await supabase.from("player_stats").select("style_metrics,average_accuracy,analyzed_games").maybeSingle();
  const oldMetrics = (currentStats?.style_metrics ?? {}) as { forcing_moves?: number; player_moves?: number; early_castles?: number };
  const metrics = {
    forcing_moves: (oldMetrics.forcing_moves ?? 0) + forcingMoves,
    player_moves: (oldMetrics.player_moves ?? 0) + playerMoves.length,
    early_castles: (oldMetrics.early_castles ?? 0) + (earlyCastle ? 1 : 0),
  };
  const analyzedGames = (currentStats?.analyzed_games ?? 0) + (playerMoves.length ? 1 : 0);
  const forcingRate = metrics.forcing_moves / Math.max(1, metrics.player_moves);
  const castleRate = metrics.early_castles / Math.max(1, analyzedGames);
  const styleLabel = analyzedGames < 20 ? null : forcingRate >= 0.32 ? "Tactical explorer" : castleRate >= 0.7 ? "Patient planner" : "Balanced builder";
  const averageAccuracy = !args.summary.telemetry.independentMoves ? currentStats?.average_accuracy ?? null : currentStats?.average_accuracy == null ? args.summary.telemetry.independentAccuracy : ((Number(currentStats.average_accuracy) * Math.max(0, analyzedGames - 1)) + args.summary.telemetry.independentAccuracy) / analyzedGames;
  const { error: statsError } = await supabase.from("player_stats").upsert({ user_id: user.id, style_metrics: metrics, style_label: styleLabel, average_accuracy: averageAccuracy, analyzed_games: analyzedGames, last_calculated_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (statsError) throw statsError;
}
