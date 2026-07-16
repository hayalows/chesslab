export type Difficulty = "beginner" | "easy" | "medium" | "hard" | "expert" | "master" | "adaptive";
export type CoachLevel = "off" | "gentle" | "candidates" | "best";
export type GameResult = "win" | "loss" | "draw";
export type GameTermination = "checkmate" | "timeout" | "stalemate" | "threefold-repetition" | "insufficient-material" | "fifty-move-rule" | "draw";
export type TimeControl = "open" | "blitz5" | "rapid10" | "steady15";
export type PlayerSide = "white" | "black" | "random";
export type PlayerColor = "w" | "b";
export type DecisionSource = "independent" | "coach-guided" | "coach-followed" | "coach-diverged";

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
  mate?: number;
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

export type MoveDecision = {
  ply: number;
  move: string;
  uci: string;
  source: DecisionSource;
  coachLevel?: CoachLevel;
  suggestedMoves: string[];
  delta?: number;
  severity?: AssistantSnapshot["severity"];
};

export type EngineStatus = "loading" | "ready" | "error";

export type PlayerProfile = {
  displayName: string;
  avatarSeed: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  hintUsage: number;
  adaptiveLevel: number;
  recentResults: GameResult[];
  trainingPoints: number;
  trainingMinutes: number;
  currentStreak: number;
  bestStreak: number;
  lastLevelChangeGame: number;
  milestones: string[];
  independentMoves: number;
  independentAccuracy: number;
  estimatedStrength: number;
};

export type GameTelemetry = {
  timeControl: TimeControl;
  totalTimeMs: number;
  playerThinkMs: number;
  rivalThinkMs: number;
  coachUses: number;
  coachTimeMs: number;
  accuracy: number;
  bestMoveMatches: number;
  analyzedMoves: number;
  independentMoves: number;
  independentAccuracy: number;
  coachFollowedMoves: number;
  coachDivergedMoves: number;
  coachGuidedMoves: number;
  adaptiveBefore: number;
  adaptiveAfter: number;
  trainingPointsEarned: number;
};

export type PostGameSummary = {
  result: GameResult;
  termination: GameTermination;
  outcomeTitle: string;
  outcomeDetail: string;
  scoreline: string;
  headline: string;
  well: string;
  watch: string;
  keyMoment: string;
  telemetry: GameTelemetry;
  newMilestones: string[];
  decisions: MoveDecision[];
};

export const DEFAULT_PROFILE: PlayerProfile = {
  displayName: "Chess learner",
  avatarSeed: "rivalmind-guest",
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  hintUsage: 0,
  adaptiveLevel: 4,
  recentResults: [],
  trainingPoints: 0,
  trainingMinutes: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastLevelChangeGame: 0,
  milestones: [],
  independentMoves: 0,
  independentAccuracy: 0,
  estimatedStrength: 900,
};
