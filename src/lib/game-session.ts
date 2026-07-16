import type { CoachLevel, PlayerColor } from "./game-types";

export function isPlayerTurn(turn: PlayerColor, playerColor: PlayerColor) {
  return turn === playerColor;
}

export function coachCacheMode(level: CoachLevel): "quick" | "deep" {
  return level === "gentle" ? "quick" : "deep";
}

export function canRevealCoachStep(currentStep: number, coachThinking: boolean) {
  return !coachThinking || currentStep < 3;
}

export function normalizeCustomTime(minutes: string | number | undefined, increment: string | number | undefined) {
  return {
    minutes: Math.max(1, Math.min(180, Number(minutes) || 20)),
    incrementSeconds: Math.max(0, Math.min(60, Number(increment) || 0)),
  };
}
