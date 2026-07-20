import type { CoachLevel, PlayerColor } from "./game-types";
import type { CoachSearchOptions } from "./engine-adapter";

export function isPlayerTurn(turn: PlayerColor, playerColor: PlayerColor) {
  return turn === playerColor;
}

export function coachCacheMode(level: CoachLevel): "quick" | "deep" {
  return level === "gentle" ? "quick" : "deep";
}

export type CoachSearchPlan = {
  mode: "quick" | "deep";
  options: CoachSearchOptions;
  label: string;
  detail: string;
  pressure: "none" | "steady" | "quick" | "critical";
};

export function coachSearchPlan(level: CoachLevel, remainingMs: number | null): CoachSearchPlan {
  if (remainingMs === null) {
    return {
      mode: coachCacheMode(level),
      options: { movetimeMs: level === "gentle" ? 480 : 1400, multiPv: level === "best" ? 4 : 3 },
      label: "Deep help",
      detail: "No clock is running, so Stockfish can take a deeper look.",
      pressure: "none",
    };
  }
  if (remainingMs <= 30_000) {
    return {
      mode: "quick",
      options: { movetimeMs: 220, multiPv: 3 },
      label: "Critical time",
      detail: "RivalMind uses the fastest completed Stockfish line. Your clock keeps running.",
      pressure: "critical",
    };
  }
  if (remainingMs <= 90_000) {
    return {
      mode: "quick",
      options: { movetimeMs: 320, multiPv: 3 },
      label: "Quick help",
      detail: "The coach favors a fast verified answer while your clock keeps running.",
      pressure: "quick",
    };
  }
  if (remainingMs <= 180_000) {
    return {
      mode: "quick",
      options: { movetimeMs: 480, multiPv: 3 },
      label: "Clock-aware help",
      detail: "The coach keeps its search short because your clock keeps running.",
      pressure: "steady",
    };
  }
  return {
    mode: coachCacheMode(level),
    options: { movetimeMs: level === "gentle" ? 480 : 1200, multiPv: level === "best" ? 4 : 3 },
    label: "Full help",
    detail: "Your clock keeps running, so asking for help is still a time-management choice.",
    pressure: "none",
  };
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
