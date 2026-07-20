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
  clock?: EngineClockState;
  moves?: string[];
  mateMoves?: number;
};

export type EngineClockState = {
  whiteMs: number | null;
  blackMs: number | null;
  whiteIncrementMs: number;
  blackIncrementMs: number;
};

export type RivalSearchContext = {
  clock?: EngineClockState;
  moves?: string[];
  movingColor?: "w" | "b";
};

export type CoachSearchOptions = {
  movetimeMs?: number;
  multiPv?: number;
  mateMoves?: number;
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
  mate?: number;
};

type PendingSearch = {
  analyses: Map<number, AnalysisLine>;
  fen: string;
  reject: (reason: Error) => void;
  resolve: (result: SearchResult & { bestMove: SearchMove }) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type BridgeMessage =
  | { type: "bridge-ready" }
  | { type: "bridge-error"; message: string }
  | { type: "line"; line: string };

export type EngineStatusListener = (status: EngineStatus, name: string) => void;

export const DIFFICULTY_PRESETS: Record<Exclude<Difficulty, "adaptive">, { elo: number | null; movetimeMs: number; description: string }> = {
  beginner: { elo: 1320, movetimeMs: 220, description: "A forgiving first rival that leaves room to recover." },
  easy: { elo: 1450, movetimeMs: 380, description: "Clear plans, with enough mistakes to practice punishing them." },
  medium: { elo: 1700, movetimeMs: 650, description: "A steady club-level challenge that notices loose pieces." },
  hard: { elo: 2050, movetimeMs: 1000, description: "A precise rival that calculates tactics carefully." },
  expert: { elo: 2400, movetimeMs: 1500, description: "Serious calculation with very few unforced mistakes." },
  master: { elo: null, movetimeMs: 2600, description: "Maximum-strength Stockfish with no Elo limit and clock-aware search." },
};

function adaptiveSettings(profile: PlayerProfile): StockfishSettings {
  const adjustedLevel = Math.max(1, Math.min(10, profile.adaptiveLevel));
  return {
    elo: 1350 + (adjustedLevel - 1) * 120,
    movetimeMs: 240 + adjustedLevel * 110,
    multiPv: 1,
  };
}

function clockAwareMoveCap(baseMs: number, clock?: EngineClockState, movingColor?: "w" | "b") {
  if (!clock) return baseMs;
  const activeClock = movingColor === "w" ? clock.whiteMs : movingColor === "b" ? clock.blackMs : null;
  const remaining = activeClock ?? Math.min(...[clock.whiteMs, clock.blackMs].filter((value): value is number => value !== null));
  if (!Number.isFinite(remaining)) return baseMs;
  return Math.max(120, Math.min(baseMs, Math.round(remaining * (remaining < 30_000 ? 0.025 : 0.04))));
}

export function opponentSettings(difficulty: Difficulty, profile: PlayerProfile, context: RivalSearchContext = {}): StockfishSettings {
  const base = difficulty === "adaptive" ? adaptiveSettings(profile) : DIFFICULTY_PRESETS[difficulty];
  return {
    elo: base.elo,
    movetimeMs: clockAwareMoveCap(base.movetimeMs, context.clock, context.movingColor),
    multiPv: 1,
    clock: context.clock,
    moves: context.moves,
  };
}

export function opponentStrengthLabel(difficulty: Difficulty, profile: PlayerProfile) {
  const settings = opponentSettings(difficulty, profile);
  if (settings.elo === null) return `Maximum strength · up to ${(settings.movetimeMs / 1000).toFixed(1)}s search`;
  return `${settings.elo} Elo · up to ${(settings.movetimeMs / 1000).toFixed(2)}s search`;
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
  const mate = scoreKind === "mate" ? rawScore : undefined;
  const score = mate !== undefined ? Math.sign(mate || 1) * (100_000 - Math.abs(mate)) : rawScore;
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
    mate,
  };
}

function toSearchMove(fen: string, uci: string, score = 0, pv: string[] = [uci], wdl?: { win: number; draw: number; loss: number }, mate?: number): SearchMove {
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
    mate,
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
  private usingModernWorker = true;
  private triedLegacyWorker = false;
  private readonly ready: Promise<void>;

  constructor(private onStatus?: EngineStatusListener) {
    this.onStatus?.("loading", this.engineName);
    this.ready = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
    void this.ready.catch(() => undefined);
    if (typeof window === "undefined") return;
    this.startWorker(true);
  }

  private startWorker(modern: boolean) {
    if (this.disposed) return;
    this.usingModernWorker = modern;
    this.supportsElo = false;
    this.supportsLimitStrength = false;
    this.supportsWdl = false;
    this.worker?.terminate();
    this.worker = modern
      ? new Worker("/stockfish/rivalmind-stockfish.worker.js", { type: "module", name: "rivalmind-stockfish-18" })
      : new Worker("/stockfish/rivalmind-stockfish-legacy.worker.js", { name: "rivalmind-stockfish-legacy" });
    const worker = this.worker;
    worker.onmessage = (event: MessageEvent<BridgeMessage>) => {
      if (this.worker === worker) this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker === worker) this.handleWorkerFailure(new Error(event.message || "Stockfish WASM could not start in this browser."));
    };
  }

  private handleWorkerFailure(error: Error) {
    if (this.usingModernWorker && !this.triedLegacyWorker) {
      this.triedLegacyWorker = true;
      this.engineName = "Stockfish compatibility engine";
      this.onStatus?.("loading", this.engineName);
      this.startWorker(false);
      return;
    }
    this.fail(error);
  }

  private post(command: string) {
    if (!this.worker || this.disposed) throw new Error("Stockfish is unavailable.");
    this.worker.postMessage(command);
  }

  private handleMessage(message: BridgeMessage) {
    if (message.type === "bridge-error") {
      this.handleWorkerFailure(new Error(message.message));
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
      this.post("setoption name Hash value 32");
      this.post("setoption name Move Overhead value 100");
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
    if (this.pending) clearTimeout(this.pending.timeout);
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
    clearTimeout(pending.timeout);
    try {
      const lines = [...pending.analyses.values()].sort((a, b) => a.multipv - b.multipv);
      const bestLine = lines.find((line) => line.move === bestUci) ?? lines[0];
      const bestMove = toSearchMove(pending.fen, bestUci, bestLine?.score ?? 0, bestLine?.pv, bestLine?.wdl, bestLine?.mate);
      const candidates = lines.map((line) => toSearchMove(pending.fen, line.move, line.score, line.pv, line.wdl, line.mate));
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
        const timeout = setTimeout(() => {
          if (this.pending?.fen !== fen) return;
          try { this.post("stop"); } catch { /* The worker may already be recovering. */ }
          this.pending = null;
          reject(new Error("Stockfish search timed out before returning a completed line."));
        }, Math.max(4_000, settings.movetimeMs + 3_000));
        this.pending = { analyses: new Map(), fen, reject, resolve, timeout };
        this.post(settings.moves?.length ? `position startpos moves ${settings.moves.join(" ")}` : `position fen ${fen}`);
        const limits: string[] = [];
        if (settings.clock && settings.clock.whiteMs !== null && settings.clock.blackMs !== null) {
          limits.push(
            `wtime ${Math.max(1, Math.round(settings.clock.whiteMs))}`,
            `btime ${Math.max(1, Math.round(settings.clock.blackMs))}`,
            `winc ${Math.max(0, Math.round(settings.clock.whiteIncrementMs))}`,
            `binc ${Math.max(0, Math.round(settings.clock.blackIncrementMs))}`,
          );
        }
        limits.push(`movetime ${Math.max(50, Math.round(settings.movetimeMs))}`);
        if (settings.mateMoves) limits.push(`mate ${settings.mateMoves}`);
        this.post(`go ${limits.join(" ")}`);
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
    if (this.pending) clearTimeout(this.pending.timeout);
    this.pending?.reject(new Error("Stockfish was stopped."));
    this.pending = null;
  }
}

export interface OpponentEngine {
  chooseMove(fen: string, difficulty: Difficulty, profile: PlayerProfile, context?: RivalSearchContext): Promise<SearchResult & { move: SearchMove }>;
  dispose(): void;
}

export interface AssistantEngine {
  analyze(fen: string, mode?: "quick" | "deep", options?: CoachSearchOptions): Promise<SearchResult>;
  peek(fen: string, mode?: "quick" | "deep", options?: CoachSearchOptions): SearchResult | null;
  dispose(): void;
}

export class RivalEngine implements OpponentEngine {
  private client: StockfishClient;
  constructor(onStatus?: EngineStatusListener) { this.client = new StockfishClient(onStatus); }
  async chooseMove(fen: string, difficulty: Difficulty, profile: PlayerProfile, context: RivalSearchContext = {}) {
    const result = await this.client.search(fen, opponentSettings(difficulty, profile, context));
    return { ...result, move: result.bestMove };
  }
  dispose() { this.client.dispose(); }
}

export class RivalAssistant implements AssistantEngine {
  private client: StockfishClient;
  private cache = new Map<string, SearchResult>();
  private inFlight = new Map<string, Promise<SearchResult>>();
  constructor(onStatus?: EngineStatusListener) { this.client = new StockfishClient(onStatus); }
  private cacheKey(fen: string, mode: "quick" | "deep", multiPv: number) {
    return `${fen}|${mode}|${multiPv}`;
  }
  peek(fen: string, mode: "quick" | "deep" = "quick", options: CoachSearchOptions = {}) {
    const multiPv = options.multiPv ?? (mode === "deep" ? 4 : 3);
    const result = this.cache.get(this.cacheKey(fen, mode, multiPv));
    return result ? { ...result, cached: true } : null;
  }
  async analyze(fen: string, mode: "quick" | "deep" = "quick", options: CoachSearchOptions = {}) {
    const multiPv = options.multiPv ?? (mode === "deep" ? 4 : 3);
    const key = this.cacheKey(fen, mode, multiPv);
    const cached = this.cache.get(key);
    if (cached) return { ...cached, cached: true };
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const search = this.client.search(fen, {
      elo: null,
      movetimeMs: options.movetimeMs ?? (mode === "deep" ? 1400 : 480),
      multiPv,
      mateMoves: options.mateMoves,
    }).then((result) => {
      const clean: SearchResult = {
        candidates: result.candidates,
        depth: result.depth,
        engine: result.engine,
        nodes: result.nodes,
        nps: result.nps,
        timeMs: result.timeMs,
        wdl: result.wdl,
      };
      this.cache.set(key, clean);
      if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value!);
      return clean;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, search);
    return search;
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
