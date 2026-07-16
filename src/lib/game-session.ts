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
