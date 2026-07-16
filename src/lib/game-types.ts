export type Difficulty = "easy" | "medium" | "hard" | "adaptive";
export type CoachLevel = "off" | "gentle" | "candidates" | "best";
export type GameResult = "win" | "loss" | "draw";

export type SearchMove = {
  from: string;
  to: string;
  san: string;
  promotion?: string;
  score: number;
  captured?: string;
  uci: string;
  line: string[];
  lineSan: string[];
  wdl?: { win: number; draw: number; loss: number };
};

export type SearchResult = {
  candidates: SearchMove[];
  nodes: number;
  depth: number;
  timeMs: number;
  nps: number;
  engine: string;
  wdl?: { win: number; draw: number; loss: number };
};

export type AssistantSnapshot = {
  id: string;
  ply: number;
  fen: string;
  actor: "You" | "Rival" | "Start";
  move?: string;
  whiteScore: number;
  delta: number;
  severity: "steady" | "inaccuracy" | "mistake" | "blunder";
  result: SearchResult;
  explanation: string;
};

export type EngineStatus = "loading" | "ready" | "error";

export type PlayerProfile = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  hintUsage: number;
  adaptiveLevel: number;
  recentResults: GameResult[];
};

export const DEFAULT_PROFILE: PlayerProfile = {
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  hintUsage: 0,
  adaptiveLevel: 4,
  recentResults: [],
};
