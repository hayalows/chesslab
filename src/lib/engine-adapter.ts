import { Chess } from "chess.js";
import type {
  Difficulty,
  EngineStatus,
  PlayerProfile,
  SearchMove,
  SearchResult,
} from "./game-types";

type StockfishSettings = {
  elo: number | null;
  movetimeMs: number;
  multiPv: number;
};

type AnalysisLine = {
  depth: number;
  move: string;
  multipv: number;
  nodes: number;
  nps: number;
  score: number;
  timeMs: number;
  pv: string[];
  wdl?: { win: number; draw: number; loss: number };
};

type PendingSearch = {
  analyses: Map<number, AnalysisLine>;
  fen: string;
  reject: (reason: Error) => void;
  resolve: (result: SearchResult & { bestMove: SearchMove }) => void;
};

type BridgeMessage =
  | { type: "bridge-ready" }
  | { type: "bridge-error"; message: string }
  | { type: "line"; line: string };

export type EngineStatusListener = (status: EngineStatus, name: string) => void;

export const DIFFICULTY_PRESETS: Record<Exclude<Difficulty, "adaptive">, { elo: number; movetimeMs: number; description: string }> = {
  easy: { elo: 1350, movetimeMs: 140, description: "A patient club player who still leaves chances." },
  medium: { elo: 1700, movetimeMs: 280, description: "A confident tournament player with fewer loose moves." },
  hard: { elo: 2200, movetimeMs: 650, description: "Expert strength with deeper, more precise calculation." },
};

function adaptiveSettings(profile: PlayerProfile): StockfishSettings {
  const wins = profile.recentResults.filter((result) => result === "win").length;
  const losses = profile.recentResults.filter((result) => result === "loss").length;
  const adjustedLevel = Math.max(1, Math.min(10, profile.adaptiveLevel + Math.sign(wins - losses)));
  return {
    elo: 1350 + (adjustedLevel - 1) * 130,
    movetimeMs: 160 + adjustedLevel * 45,
    multiPv: 1,
  };
}

export function opponentSettings(difficulty: Difficulty, profile: PlayerProfile): StockfishSettings {
  if (difficulty === "adaptive") return adaptiveSettings(profile);
  const preset = DIFFICULTY_PRESETS[difficulty];
  return { elo: preset.elo, movetimeMs: preset.movetimeMs, multiPv: 1 };
}

export function opponentStrengthLabel(difficulty: Difficulty, profile: PlayerProfile) {
  const settings = opponentSettings(difficulty, profile);
  return `${settings.elo} Elo · ${(settings.movetimeMs / 1000).toFixed(2)}s search`;
}

function valueAfter(tokens: string[], key: string, fallback = 0) {
  const index = tokens.indexOf(key);
  return index >= 0 ? Number(tokens[index + 1]) || fallback : fallback;
}

function parseInfo(line: string): AnalysisLine | null {
  const tokens = line.trim().split(/\s+/);
  const pvIndex = tokens.indexOf("pv");
  const scoreIndex = tokens.indexOf("score");
  if (pvIndex < 0 || !tokens[pvIndex + 1] || scoreIndex < 0) return null;
  const scoreKind = tokens[scoreIndex + 1];
  const rawScore = Number(tokens[scoreIndex + 2]) || 0;
  const score = scoreKind === "mate" ? Math.sign(rawScore || 1) * (100_000 - Math.abs(rawScore)) : rawScore;
  const wdlIndex = tokens.indexOf("wdl");
  return {
    depth: valueAfter(tokens, "depth"),
    move: tokens[pvIndex + 1],
    multipv: valueAfter(tokens, "multipv", 1),
    nodes: valueAfter(tokens, "nodes"),
    nps: valueAfter(tokens, "nps"),
    score,
    timeMs: valueAfter(tokens, "time"),
    pv: tokens.slice(pvIndex + 1),
    wdl: wdlIndex >= 0 ? {
      win: Number(tokens[wdlIndex + 1]) || 0,
      draw: Number(tokens[wdlIndex + 2]) || 0,
      loss: Number(tokens[wdlIndex + 3]) || 0,
    } : undefined,
  };
}

function toSearchMove(fen: string, uci: string, score = 0, pv: string[] = [uci], wdl?: { win: number; draw: number; loss: number }): SearchMove {
  const chess = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci[4];
  const move = chess.move({ from, to, promotion: promotion || "q" });
  if (!move) throw new Error(`Stockfish returned an invalid move: ${uci}`);
  const lineGame = new Chess(fen);
  const lineSan: string[] = [];
  for (const pvMove of pv) {
    try {
      const played = lineGame.move({ from: pvMove.slice(0, 2), to: pvMove.slice(2, 4), promotion: pvMove[4] || "q" });
      if (!played) break;
      lineSan.push(played.san);
    } catch { break; }
  }
  return {
    from,
    to,
    san: move.san,
    promotion: move.promotion,
    captured: move.captured,
    score,
    uci,
    line: pv,
    lineSan,
    wdl,
  };
}

class StockfishClient {
  private worker: Worker | null = null;
  private engineName = "Stockfish WASM";
  private initResolve: (() => void) | null = null;
  private initReject: ((reason: Error) => void) | null = null;
  private readyResolve: (() => void) | null = null;
  private pending: PendingSearch | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private supportsElo = false;
  private supportsLimitStrength = false;
  private supportsWdl = false;
  private readonly ready: Promise<void>;

  constructor(private onStatus?: EngineStatusListener) {
    this.onStatus?.("loading", this.engineName);
    this.ready = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
    void this.ready.catch(() => undefined);
    if (typeof window === "undefined") return;
    this.worker = new Worker("/stockfish/rivalmind-stockfish.worker.js");
    this.worker.onmessage = (event: MessageEvent<BridgeMessage>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => this.fail(new Error(event.message || "Stockfish WASM could not start in this browser."));
  }

  private post(command: string) {
    if (!this.worker || this.disposed) throw new Error("Stockfish is unavailable.");
    this.worker.postMessage(command);
  }

  private handleMessage(message: BridgeMessage) {
    if (message.type === "bridge-error") {
      this.fail(new Error(message.message));
      return;
    }
    if (message.type === "bridge-ready") {
      this.post("uci");
      return;
    }

    const line = message.line.trim();
    if (line.startsWith("id name ")) this.engineName = line.slice(8);
    if (line.startsWith("option name UCI_Elo ")) this.supportsElo = true;
    if (line.startsWith("option name UCI_LimitStrength ")) this.supportsLimitStrength = true;
    if (line.startsWith("option name UCI_ShowWDL ")) this.supportsWdl = true;
    if (line === "uciok") {
      if (!this.supportsElo || !this.supportsLimitStrength) {
        this.fail(new Error("This Stockfish build does not expose Elo strength controls."));
        return;
      }
      this.post("setoption name Threads value 1");
      this.post("setoption name Hash value 16");
      if (this.supportsWdl) this.post("setoption name UCI_ShowWDL value true");
      this.post("isready");
      return;
    }
    if (line === "readyok") {
      if (this.initResolve) {
        this.initResolve();
        this.initResolve = null;
        this.initReject = null;
        this.onStatus?.("ready", this.engineName);
      } else {
        this.readyResolve?.();
        this.readyResolve = null;
      }
      return;
    }
    if (line.startsWith("info ") && this.pending) {
      const analysis = parseInfo(line);
      if (analysis) this.pending.analyses.set(analysis.multipv, analysis);
      return;
    }
    if (line.startsWith("bestmove ") && this.pending) this.finishSearch(line.split(/\s+/)[1]);
  }

  private fail(error: Error) {
    this.initReject?.(error);
    this.initResolve = null;
    this.initReject = null;
    this.pending?.reject(error);
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.onStatus?.("error", this.engineName);
  }

  private finishSearch(bestUci: string) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    try {
      const lines = [...pending.analyses.values()].sort((a, b) => a.multipv - b.multipv);
      const bestLine = lines.find((line) => line.move === bestUci) ?? lines[0];
      const bestMove = toSearchMove(pending.fen, bestUci, bestLine?.score ?? 0, bestLine?.pv, bestLine?.wdl);
      const candidates = lines.map((line) => toSearchMove(pending.fen, line.move, line.score, line.pv, line.wdl));
      if (!candidates.some((move) => move.from === bestMove.from && move.to === bestMove.to)) candidates.unshift(bestMove);
      pending.resolve({
        bestMove,
        candidates,
        depth: Math.max(0, ...lines.map((line) => line.depth)),
        engine: this.engineName,
        nodes: Math.max(0, ...lines.map((line) => line.nodes)),
        nps: Math.max(0, ...lines.map((line) => line.nps)),
        timeMs: Math.max(0, ...lines.map((line) => line.timeMs)),
        wdl: bestLine?.wdl,
      });
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error("Stockfish returned an unreadable line."));
    }
  }

  private waitUntilReady() {
    return new Promise<void>((resolve) => {
      this.readyResolve = resolve;
      this.post("isready");
    });
  }

  search(fen: string, settings: StockfishSettings) {
    const run = this.queue.then(async () => {
      await this.ready;
      this.post(`setoption name MultiPV value ${settings.multiPv}`);
      this.post(`setoption name UCI_LimitStrength value ${settings.elo === null ? "false" : "true"}`);
      if (settings.elo !== null) this.post(`setoption name UCI_Elo value ${settings.elo}`);
      await this.waitUntilReady();
      return new Promise<SearchResult & { bestMove: SearchMove }>((resolve, reject) => {
        this.pending = { analyses: new Map(), fen, reject, resolve };
        this.post(`position fen ${fen}`);
        this.post(`go movetime ${settings.movetimeMs}`);
      });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  dispose() {
    this.disposed = true;
    try { this.worker?.postMessage("quit"); } catch { /* Worker may already be gone. */ }
    this.worker?.terminate();
    this.worker = null;
    this.pending?.reject(new Error("Stockfish was stopped."));
    this.pending = null;
  }
}

export interface OpponentEngine {
  chooseMove(fen: string, difficulty: Difficulty, profile: PlayerProfile): Promise<SearchResult & { move: SearchMove }>;
  dispose(): void;
}

export interface CoachEngine {
  analyze(fen: string): Promise<SearchResult>;
  dispose(): void;
}

export interface AssistantEngine {
  analyze(fen: string): Promise<SearchResult>;
  dispose(): void;
}

export class RivalEngine implements OpponentEngine {
  private client: StockfishClient;
  constructor(onStatus?: EngineStatusListener) { this.client = new StockfishClient(onStatus); }
  async chooseMove(fen: string, difficulty: Difficulty, profile: PlayerProfile) {
    const result = await this.client.search(fen, opponentSettings(difficulty, profile));
    return { ...result, move: result.bestMove };
  }
  dispose() { this.client.dispose(); }
}

export class RivalCoach implements CoachEngine {
  private client: StockfishClient;
  constructor(onStatus?: EngineStatusListener) { this.client = new StockfishClient(onStatus); }
  async analyze(fen: string) {
    const result = await this.client.search(fen, { elo: null, movetimeMs: 700, multiPv: 4 });
    return {
      candidates: result.candidates,
      depth: result.depth,
      engine: result.engine,
      nodes: result.nodes,
      nps: result.nps,
      timeMs: result.timeMs,
      wdl: result.wdl,
    };
  }
  dispose() { this.client.dispose(); }
}

export class RivalAssistant implements AssistantEngine {
  private client: StockfishClient;
  constructor(onStatus?: EngineStatusListener) { this.client = new StockfishClient(onStatus); }
  async analyze(fen: string) {
    const result = await this.client.search(fen, { elo: null, movetimeMs: 520, multiPv: 3 });
    return {
      candidates: result.candidates,
      depth: result.depth,
      engine: result.engine,
      nodes: result.nodes,
      nps: result.nps,
      timeMs: result.timeMs,
      wdl: result.wdl,
    };
  }
  dispose() { this.client.dispose(); }
}

export function explainMove(move: SearchMove) {
  const pieceName = move.san.startsWith("N") ? "knight"
    : move.san.startsWith("B") ? "bishop"
      : move.san.startsWith("R") ? "rook"
        : move.san.startsWith("Q") ? "queen"
          : move.san.startsWith("K") ? "king" : "pawn";
  if (move.san.includes("#")) return "It ends the game with checkmate.";
  if (move.promotion) return "It promotes a pawn and creates a decisive new threat.";
  if (move.san === "O-O" || move.san === "O-O-O") return "It tucks your king away and connects your rooks.";
  if (move.captured) return `It lets your ${pieceName} win material while staying active.`;
  if (move.san.includes("+")) return `It improves your ${pieceName} with tempo by checking the king.`;
  if (["d4", "d5", "e4", "e5"].includes(move.to)) return `It brings your ${pieceName} into the center, where it influences more squares.`;
  return `It improves your ${pieceName} and keeps useful options open.`;
}
