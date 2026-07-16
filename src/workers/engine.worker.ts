/// <reference lib="webworker" />

import { Chess, type Move, type PieceSymbol } from "chess.js";

type RequestMessage = { id: number; fen: string; depth: number; maxCandidates: number };
type Candidate = {
  from: string;
  to: string;
  san: string;
  promotion?: string;
  score: number;
  captured?: string;
};

const PIECE_VALUES: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
let simulations = 0;

function evaluate(chess: Chess) {
  if (chess.isCheckmate()) return -100_000;
  if (chess.isDraw()) return 0;

  let whiteScore = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type];
      whiteScore += piece.color === "w" ? value : -value;
    }
  }
  return chess.turn() === "w" ? whiteScore : -whiteScore;
}

function movePriority(move: Move) {
  let priority = 0;
  if (move.captured) priority += 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece];
  if (move.promotion) priority += PIECE_VALUES[move.promotion];
  if (move.san.includes("+")) priority += 75;
  if (move.san.includes("#")) priority += 100_000;
  return priority;
}

function orderedMoves(chess: Chess) {
  return chess.moves({ verbose: true }).sort((a, b) => movePriority(b) - movePriority(a));
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number): number {
  simulations += 1;
  if (depth === 0 || chess.isGameOver()) return evaluate(chess);
  let best = -Infinity;
  for (const move of orderedMoves(chess)) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  return best;
}

function search(fen: string, depth: number, maxCandidates: number) {
  const chess = new Chess(fen);
  simulations = 0;
  const candidates: Candidate[] = [];
  for (const move of orderedMoves(chess)) {
    chess.move(move);
    const score = -negamax(chess, Math.max(0, depth - 1), -Infinity, Infinity);
    chess.undo();
    candidates.push({
      from: move.from,
      to: move.to,
      san: move.san,
      promotion: move.promotion,
      captured: move.captured,
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, maxCandidates), simulations, depth };
}

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  const { id, fen, depth, maxCandidates } = event.data;
  try {
    self.postMessage({ id, result: search(fen, depth, maxCandidates) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Engine search failed" });
  }
};

export {};
