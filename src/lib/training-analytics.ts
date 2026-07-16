import type { AssistantSnapshot, GameResult, GameTelemetry, PlayerProfile, TimeControl } from "./game-types";

export const TIME_CONTROLS: Record<TimeControl, { label: string; short: string; initialMs: number | null; incrementMs: number; description: string }> = {
  open: { label: "Open practice", short: "No clock", initialMs: null, incrementMs: 0, description: "Take your time. Best for learning a new idea." },
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

export function learningScore(timeline: AssistantSnapshot[]) {
  const playerMoves = timeline.filter((item) => item.actor === "You");
  if (!playerMoves.length) return { accuracy: 0, bestMoveMatches: 0, analyzedMoves: 0 };
  const losses = playerMoves.map((item) => Math.max(0, -item.delta) / 100);
  const averageLoss = losses.reduce((sum, loss) => sum + Math.min(loss, 5), 0) / losses.length;
  const accuracy = Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-0.55 * averageLoss))));
  const bestMoveMatches = playerMoves.filter((item) => timeline.find((previous) => previous.ply === item.ply - 1)?.result.candidates[0]?.san === item.move).length;
  return { accuracy, bestMoveMatches, analyzedMoves: playerMoves.length };
}

export function adaptiveProgress(profile: PlayerProfile) {
  if (!profile.recentResults.length) return 20;
  const score = profile.recentResults.reduce((sum, result) => sum + (result === "win" ? 1 : result === "draw" ? 0.5 : 0), 0);
  return Math.round(Math.min(100, score / Math.max(3.5, profile.recentResults.length) * 100));
}

export function trainingRating(profile: PlayerProfile) {
  return 700 + profile.adaptiveLevel * 100 + Math.min(99, Math.round((profile.trainingPoints % 500) / 5));
}

export function advanceProfile(profile: PlayerProfile, result: GameResult, telemetry: Omit<GameTelemetry, "adaptiveAfter" | "trainingPointsEarned">) {
  const games = profile.games + 1;
  const recentResults = [...profile.recentResults, result].slice(-5);
  const formScore = recentResults.reduce((sum, item) => sum + (item === "win" ? 1 : item === "draw" ? 0.5 : 0), 0);
  const canAdjust = games - profile.lastLevelChangeGame >= 3 && recentResults.length >= 4;
  const levelDelta = canAdjust && formScore >= 3.5 ? 1 : canAdjust && formScore <= 1 ? -1 : 0;
  const adaptiveLevel = Math.max(1, Math.min(10, profile.adaptiveLevel + levelDelta));
  const currentStreak = result === "win" ? profile.currentStreak + 1 : 0;
  const points = (result === "win" ? 120 : result === "draw" ? 75 : 45) + Math.round(telemetry.accuracy * 0.3) + (telemetry.coachUses === 0 ? 20 : 0);
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
  };
  const unlocked = MILESTONES.filter((milestone) => !base.milestones.includes(milestone.code) && milestone.reached(base));
  base.milestones.push(...unlocked.map((milestone) => milestone.code));
  return { profile: base, points, newMilestones: unlocked.map((milestone) => milestone.title), levelDelta };
}
