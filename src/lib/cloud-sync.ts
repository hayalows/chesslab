import type { Chess } from "chess.js";
import { opponentSettings } from "./engine-adapter";
import type { AssistantSnapshot, Difficulty, GameResult, PlayerProfile } from "./game-types";
import { createClient } from "./supabase/client";

type Summary = { result: GameResult; well: string; watch: string };

export async function loadCloudProfile(): Promise<PlayerProfile | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("total_games,wins,losses,draws,hint_usage,adaptive_level").maybeSingle();
  if (!data) return null;
  return {
    games: data.total_games,
    wins: data.wins,
    losses: data.losses,
    draws: data.draws,
    hintUsage: data.hint_usage,
    adaptiveLevel: data.adaptive_level,
    recentResults: [],
  };
}

export async function syncProfile(profile: PlayerProfile, assistantEnabled: boolean) {
  const supabase = createClient();
  if (!supabase) return { synced: false as const, reason: "not-configured" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { synced: false as const, reason: "guest" };
  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id,
    display_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Chess learner",
    total_games: profile.games,
    wins: profile.wins,
    losses: profile.losses,
    draws: profile.draws,
    hint_usage: profile.hintUsage,
    adaptive_level: profile.adaptiveLevel,
    assistant_enabled: assistantEnabled,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
  return { synced: true as const };
}

export async function syncCompletedGame(args: {
  game: Chess;
  difficulty: Difficulty;
  profile: PlayerProfile;
  summary: Summary;
  timeline: AssistantSnapshot[];
  assistantEnabled: boolean;
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
    summary: { well: args.summary.well, watch: args.summary.watch },
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
    };
  });
  if (rows.length) {
    const { error } = await supabase.from("moves").insert(rows);
    if (error) throw error;
  }
}
