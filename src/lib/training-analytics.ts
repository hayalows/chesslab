import type { AssistantSnapshot, GameResult, GameTelemetry, MoveDecision, PlayerProfile, TimeControl } from "./game-types";

export const TIME_CONTROLS: Record<TimeControl, { label: string; short: string; initialMs: number | null; incrementMs: number; description: string }> = {
  open: { label: "Open practice", short: "No clock", initialMs: null, incrementMs: 0, description: "Take your time. Best for learning a new idea." },
  blitz5: { label: "5 minute game", short: "5 min", initialMs: 5 * 60_000, incrementMs: 0, description: "Five minutes each. Train quick, disciplined decisions." },
  rapid10: { label: "10 minute game", short: "10 min", initialMs: 10 * 60_000, incrementMs: 0, description: "A focused game with ten minutes each." },
  steady15: { label: "15 + 10 training", short: "15 + 10", initialMs: 15 * 60_000, incrementMs: 10_000, description: "Fifteen minutes each, plus ten seconds per move." },
};

export const MILESTONES = [
  { code: "first_game", title: "First step", detail: "Complete your first training game.", reached: (p: PlayerProfile) => p.games >= 1 },
  { code: "five_games", title: "Building a habit", detail: "Complete five training games.", reached: (p: PlayerProfile) => p.games >= 5 },
  { code: "three_streak", title: "In rhythm", detail: "Win three games in a row.", reached: (p: PlayerProfile) => p.bestStreak >= 3 },
  { code: "hour_trained", title: "One focused hour", detail: "Spend sixty minutes in training games.", reached: (p: PlayerProfile) => p.trainingMinutes >= 60 },
  { code: "twenty_games", title: "Dedicated learner", detail: "Complete twenty training games.", reached: (p: PlayerProfile) => p.games >= 20 },
] as const;

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

export function formatClock(ms: number | null) {
  if (ms === null) return "No clock";
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function learningScore(timeline: AssistantSnapshot[], decisions: MoveDecision[] = []) {
  const playerMoves = timeline.filter((item) => item.actor === "You");
  if (!playerMoves.length) return { accuracy: 0, bestMoveMatches: 0, analyzedMoves: 0, independentMoves: 0, independentAccuracy: 0, coachFollowedMoves: 0, coachDivergedMoves: 0, coachGuidedMoves: 0 };
  const losses = playerMoves.map((item) => Math.max(0, -item.delta) / 100);
  const averageLoss = losses.reduce((sum, loss) => sum + Math.min(loss, 5), 0) / losses.length;
  const accuracy = Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-0.55 * averageLoss))));
  const bestMoveMatches = playerMoves.filter((item) => timeline.find((previous) => previous.ply === item.ply - 1)?.result.candidates[0]?.san === item.move).length;
  const independentPly = new Set(decisions.filter((item) => item.source === "independent").map((item) => item.ply));
  const independent = playerMoves.filter((item) => independentPly.has(item.ply));
  const independentLoss = independent.map((item) => Math.max(0, -item.delta) / 100);
  const independentAverageLoss = independentLoss.length ? independentLoss.reduce((sum, loss) => sum + Math.min(loss, 5), 0) / independentLoss.length : 0;
  const independentAccuracy = independent.length ? Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-0.55 * independentAverageLoss)))) : 0;
  return {
    accuracy,
    bestMoveMatches,
    analyzedMoves: playerMoves.length,
    independentMoves: independent.length,
    independentAccuracy,
    coachFollowedMoves: decisions.filter((item) => item.source === "coach-followed").length,
    coachDivergedMoves: decisions.filter((item) => item.source === "coach-diverged").length,
    coachGuidedMoves: decisions.filter((item) => item.source === "coach-guided").length,
  };
}

export function adaptiveProgress(profile: PlayerProfile) {
  if (!profile.recentResults.length) return 0;
  const score = profile.recentResults.reduce((sum, result) => sum + (result === "win" ? 1 : result === "draw" ? 0.5 : 0), 0);
  const form = score / Math.max(1, profile.recentResults.length) * 100;
  const quality = profile.independentMoves ? profile.independentAccuracy : 50;
  return Math.round(Math.min(100, form * 0.55 + quality * 0.45));
}

export function adaptiveExplanation(profile: PlayerProfile) {
  const gamesNeeded = Math.max(0, 4 - profile.recentResults.length);
  const movesNeeded = Math.max(0, 20 - profile.independentMoves);
  if (gamesNeeded) return `${gamesNeeded} more completed game${gamesNeeded === 1 ? "" : "s"} before RivalMind can adjust the challenge.`;
  if (movesNeeded) return `${movesNeeded} more independent moves will make the strength decision more reliable.`;
  if (profile.independentAccuracy >= 76) return "Your independent quality supports a harder rival if recent results stay strong.";
  if (profile.independentAccuracy < 58) return "The rival will hold or ease only after a repeated low-quality pattern—not one difficult game.";
  return "Your current rival matches the evidence so far. Results and independent quality must move together.";
}

export function coachRecommendation(profile: PlayerProfile) {
  if (profile.independentMoves >= 80 && profile.independentAccuracy >= 82) return "Try one full game with the coach off.";
  if (profile.independentMoves >= 40 && profile.independentAccuracy >= 70) return "Use clues first; reveal the move only after naming your candidate.";
  return "Name your candidate before asking, then move through the clues one at a time.";
}

export function trainingRating(profile: PlayerProfile) {
  return profile.estimatedStrength;
}

export function advanceProfile(profile: PlayerProfile, result: GameResult, telemetry: Omit<GameTelemetry, "adaptiveAfter" | "trainingPointsEarned">) {
  const games = profile.games + 1;
  const recentResults = [...profile.recentResults, result].slice(-5);
  const formScore = recentResults.reduce((sum, item) => sum + (item === "win" ? 1 : item === "draw" ? 0.5 : 0), 0);
  const gameIndependentMoves = telemetry.independentMoves ?? 0;
  const gameIndependentAccuracy = telemetry.independentAccuracy ?? 0;
  const blendedIndependentAccuracy = profile.independentMoves
    ? Math.round((profile.independentAccuracy * Math.min(profile.independentMoves, 30) + gameIndependentAccuracy * gameIndependentMoves) / (Math.min(profile.independentMoves, 30) + gameIndependentMoves || 1))
    : gameIndependentAccuracy;
  const independentSignal = gameIndependentMoves >= 4 ? blendedIndependentAccuracy : null;
  const canAdjust = games - profile.lastLevelChangeGame >= 3 && recentResults.length >= 4;
  const levelDelta = canAdjust && formScore >= 3 && independentSignal !== null && independentSignal >= 76 ? 1
    : canAdjust && formScore <= 1.5 && independentSignal !== null && independentSignal < 58 ? -1 : 0;
  const adaptiveLevel = Math.max(1, Math.min(10, profile.adaptiveLevel + levelDelta));
  const currentStreak = result === "win" ? profile.currentStreak + 1 : 0;
  const points = (result === "win" ? 120 : result === "draw" ? 75 : 45) + Math.round(telemetry.accuracy * 0.3) + Math.min(30, gameIndependentMoves * 3);
  const previousIndependentMoves = profile.independentMoves ?? 0;
  const independentMoves = previousIndependentMoves + gameIndependentMoves;
  const independentAccuracy = independentMoves ? Math.round((((profile.independentAccuracy ?? 0) * previousIndependentMoves) + (gameIndependentAccuracy * gameIndependentMoves)) / independentMoves) : 0;
  const confidence = Math.min(1, independentMoves / 40);
  const qualityEstimate = 600 + independentAccuracy * 16;
  const estimatedStrength = independentMoves === 0 ? (profile.estimatedStrength ?? 900) : Math.max(600, Math.min(3000, Math.round(900 * (1 - confidence) + qualityEstimate * confidence)));
  const base: PlayerProfile = {
    ...profile,
    games,
    wins: profile.wins + (result === "win" ? 1 : 0),
    losses: profile.losses + (result === "loss" ? 1 : 0),
    draws: profile.draws + (result === "draw" ? 1 : 0),
    adaptiveLevel,
    recentResults,
    trainingPoints: profile.trainingPoints + points,
    trainingMinutes: profile.trainingMinutes + Math.max(1, Math.round(telemetry.totalTimeMs / 60_000)),
    currentStreak,
    bestStreak: Math.max(profile.bestStreak, currentStreak),
    lastLevelChangeGame: levelDelta ? games : profile.lastLevelChangeGame,
    milestones: [...profile.milestones],
    independentMoves,
    independentAccuracy,
    estimatedStrength,
  };
  const unlocked = MILESTONES.filter((milestone) => !base.milestones.includes(milestone.code) && milestone.reached(base));
  base.milestones.push(...unlocked.map((milestone) => milestone.code));
  return { profile: base, points, newMilestones: unlocked.map((milestone) => milestone.title), levelDelta };
}
