import { Chess } from "chess.js";
import type { Difficulty, PlayerProfile, SearchMove, SearchResult } from "./game-types";

type PendingSearch = { resolve: (value: SearchResult) => void; reject: (reason: Error) => void };
type WorkerResponse = { id: number; result?: SearchResult; error?: string };

export interface OpponentEngine {
  chooseMove(fen: string, difficulty: Difficulty, profile: PlayerProfile): Promise<SearchResult & { move: SearchMove }>;
  dispose(): void;
}

export interface CoachEngine {
  analyze(fen: string): Promise<SearchResult>;
  dispose(): void;
}

class SearchWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingSearch>();

  constructor() {
    if (typeof window === "undefined") return;
    this.worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      if (event.data.result) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error ?? "Engine search failed"));
    };
    this.worker.onerror = () => {
      for (const request of this.pending.values()) request.reject(new Error("Engine worker unavailable"));
      this.pending.clear();
    };
  }

  search(fen: string, depth: number, maxCandidates: number) {
    if (!this.worker) return Promise.resolve(fallbackSearch(fen));
    const id = this.nextId++;
    return new Promise<SearchResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ id, fen, depth, maxCandidates });
    }).catch(() => fallbackSearch(fen));
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const request of this.pending.values()) request.reject(new Error("Engine disposed"));
    this.pending.clear();
  }
}

function fallbackSearch(fen: string): SearchResult {
  const candidates = new Chess(fen).moves({ verbose: true }).slice(0, 4).map((move, index) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    promotion: move.promotion,
    captured: move.captured,
    score: -index,
  }));
  return { candidates, simulations: candidates.length, depth: 0 };
}

function settingsFor(difficulty: Difficulty, profile: PlayerProfile) {
  if (difficulty === "easy") return { depth: 1, pool: 4 };
  if (difficulty === "medium") return { depth: 2, pool: 2 };
  if (difficulty === "hard") return { depth: 3, pool: 1 };
  const wins = profile.recentResults.filter((result) => result === "win").length;
  const losses = profile.recentResults.filter((result) => result === "loss").length;
  const effectiveLevel = Math.max(1, Math.min(10, profile.adaptiveLevel + Math.sign(wins - losses)));
  return effectiveLevel <= 3
    ? { depth: 1, pool: 4 }
    : effectiveLevel <= 7
      ? { depth: 2, pool: 2 }
      : { depth: 3, pool: 1 };
}

export class RivalEngine implements OpponentEngine {
  private client = new SearchWorkerClient();
  async chooseMove(fen: string, difficulty: Difficulty, profile: PlayerProfile) {
    const settings = settingsFor(difficulty, profile);
    const result = await this.client.search(fen, settings.depth, Math.max(4, settings.pool));
    if (!result.candidates.length) throw new Error("No legal reply is available");
    const pool = result.candidates.slice(0, settings.pool);
    return { ...result, move: pool[Math.floor(Math.random() * pool.length)] };
  }
  dispose() { this.client.dispose(); }
}

export class RivalCoach implements CoachEngine {
  private client = new SearchWorkerClient();
  analyze(fen: string) { return this.client.search(fen, 2, 4); }
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
