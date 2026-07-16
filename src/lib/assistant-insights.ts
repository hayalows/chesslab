import { Chess } from "chess.js";
import type { AssistantSnapshot, SearchMove, SearchResult } from "./game-types";

export function whiteScore(fen: string, score: number) {
  return fen.split(" ")[1] === "w" ? score : -score;
}

export function healthScore(score: number) {
  if (Math.abs(score) > 90_000) return score > 0 ? 100 : 0;
  return Math.round(Math.max(0, Math.min(100, 50 + score / 8)));
}

export function outlook(result: SearchResult, fen: string) {
  if (result.wdl) {
    const sideToMoveIsWhite = fen.split(" ")[1] === "w";
    const raw = sideToMoveIsWhite ? result.wdl : { win: result.wdl.loss, draw: result.wdl.draw, loss: result.wdl.win };
    const total = raw.win + raw.draw + raw.loss || 1;
    return { win: Math.round(raw.win / total * 100), draw: Math.round(raw.draw / total * 100), loss: Math.round(raw.loss / total * 100), native: true };
  }
  const score = whiteScore(fen, result.candidates[0]?.score ?? 0) / 100;
  const decisive = 1 / (1 + Math.exp(-1.18 * score));
  const draw = Math.round(46 * Math.exp(-Math.abs(score) / 1.7));
  const remaining = 100 - draw;
  const win = Math.round(remaining * decisive);
  return { win, draw, loss: 100 - draw - win, native: false };
}

export function phaseLabel(fen: string) {
  const board = new Chess(fen).board().flat().filter(Boolean);
  const nonPawns = board.filter((piece) => piece && !["p", "k"].includes(piece.type)).length;
  if (nonPawns <= 4) return "Endgame teacher";
  const fullmove = Number(fen.split(" ")[5]) || 1;
  if (fullmove <= 10) return "Opening intelligence";
  return "Middlegame guide";
}

export function confidence(result: SearchResult) {
  const depth = result.depth;
  const gap = Math.abs((result.candidates[0]?.score ?? 0) - (result.candidates[1]?.score ?? 0));
  if (depth >= 14 && gap >= 25) return { label: "High", detail: "The search is deep and its leading move is clearly ahead." };
  if (depth >= 10) return { label: "Good", detail: "Stockfish has a stable working view of this position." };
  return { label: "Building", detail: "Useful early guidance; the line may still change with more search." };
}

export function tacticalRadar(move?: SearchMove) {
  if (!move) return { label: "Quiet", text: "No forcing move is visible in Stockfish's leading line yet." };
  const firstThree = move.lineSan.slice(0, 3);
  if (firstThree.some((san) => san.includes("#"))) return { label: "Mate net", text: `Stockfish's line reaches mate: ${firstThree.join(" ")}.` };
  if (firstThree.some((san) => san.includes("+"))) return { label: "King pressure", text: `A check appears in the main line: ${firstThree.join(" ")}.` };
  if (firstThree.some((san) => san.includes("x"))) return { label: "Forcing capture", text: `The main line includes a capture: ${firstThree.join(" ")}.` };
  return { label: "No forcing line", text: `Stockfish prefers a quieter sequence: ${firstThree.join(" ") || move.san}. Forks, pins, and skewers are only named when verified in its shown line.` };
}

export function explainCandidate(move: SearchMove, bestScore: number, index: number) {
  const difference = Math.max(0, bestScore - move.score) / 100;
  const action = move.san.includes("#") ? "ends the game by force"
    : move.san.includes("+") ? "starts with check"
      : move.captured ? "starts with a capture"
        : move.san === "O-O" || move.san === "O-O-O" ? "castles immediately"
          : "keeps a quieter plan";
  if (index === 0) return `${move.san} is Stockfish's first choice and ${action}.`;
  return `${move.san} ${action}; Stockfish rates it ${difference.toFixed(2)} pawns behind the top line.`;
}

function severityFromDelta(delta: number): AssistantSnapshot["severity"] {
  const lost = Math.max(0, -delta) / 100;
  if (lost >= 1.5) return "blunder";
  if (lost >= 0.75) return "mistake";
  if (lost >= 0.3) return "inaccuracy";
  return "steady";
}

export function buildSnapshot(args: {
  ply: number;
  fen: string;
  actor: AssistantSnapshot["actor"];
  move?: string;
  result: SearchResult;
  previousWhiteScore?: number;
}): AssistantSnapshot {
  const score = whiteScore(args.fen, args.result.candidates[0]?.score ?? 0);
  const delta = args.previousWhiteScore === undefined ? 0 : score - args.previousWhiteScore;
  const severity = args.actor === "You" ? severityFromDelta(delta) : "steady";
  const main = args.result.candidates[0];
  const amount = Math.abs(delta / 100).toFixed(2);
  const direction = delta > 20 ? "improved" : delta < -20 ? "fell" : "stayed nearly level";
  const evidence = main?.lineSan.slice(0, 3).join(" ");
  const explanation = args.previousWhiteScore === undefined
    ? `Stockfish starts with ${main?.san ?? "a balanced choice"}. Its current line is ${evidence || "still forming"}.`
    : `The evaluation ${direction}${direction === "stayed nearly level" ? "" : ` by ${amount} pawns`}. Stockfish now begins with ${main?.san ?? "its top move"}${evidence ? ` and shows ${evidence}` : ""}.`;
  return { id: `${args.ply}-${args.actor}-${args.move ?? "position"}`, ply: args.ply, fen: args.fen, actor: args.actor, move: args.move, whiteScore: score, delta, severity, result: args.result, explanation };
}
