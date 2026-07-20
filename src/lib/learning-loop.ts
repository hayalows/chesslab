import type { AssistantSnapshot, MoveDecision, PlayerColor, PlayerProfile, ReviewPosition, SearchResult } from "./game-types";

export const REVIEW_POSITIONS_KEY = "rivalmind-review-positions-v1";

function normalizeMove(value: string) {
  return value.toLowerCase().replace(/[\s+#=!?-]/g, "");
}

export function comparePlayerIdea(idea: string, result: SearchResult, immediateMates: { san: string; uci: string }[] = []) {
  const clean = normalizeMove(idea);
  if (!clean) return null;
  const matchIndex = result.candidates.findIndex((move) => normalizeMove(move.san) === clean || normalizeMove(move.uci) === clean);
  const matchingMate = immediateMates.find((move) => normalizeMove(move.san) === clean || normalizeMove(move.uci) === clean);
  const best = result.candidates[0];
  if (matchIndex === 0) return { tone: "strong" as const, text: `${idea} matches Stockfish's first choice.` };
  if (matchingMate) return { tone: "strong" as const, text: `${idea} is also a legal checkmate in one. It ends the game immediately, even though Stockfish listed another checkmate first.` };
  if (matchIndex > 0) {
    const move = result.candidates[matchIndex];
    const gap = Math.max(0, (best.score - move.score) / 100);
    return { tone: "close" as const, text: `${idea} is candidate ${matchIndex + 1}, about ${gap.toFixed(2)} pawns behind ${best.san}.` };
  }
  return { tone: "watch" as const, text: `Stockfish did not include ${idea} in its four leading lines. Its first choice is ${best?.san ?? "still forming"}.` };
}

export function collectReviewPositions(timeline: AssistantSnapshot[], decisions: MoveDecision[], playerColor: PlayerColor) {
  return decisions.flatMap<ReviewPosition>((decision) => {
    const reviewed = timeline.find((item) => item.ply === decision.ply);
    const before = timeline.find((item) => item.ply === decision.ply - 1);
    const best = before?.result.candidates[0];
    const reason = reviewed?.severity === "blunder" ? "blunder"
      : reviewed?.severity === "mistake" ? "mistake"
        : decision.source === "coach-diverged" && (reviewed?.delta ?? 0) < -50 ? "coach-diverged" : null;
    if (!before || !best || !reason) return [];
    return [{
      id: `${before.fen}|${best.uci}`,
      fen: before.fen,
      bestMoveUci: best.uci,
      bestMoveSan: best.san,
      playedMove: decision.move,
      reason,
      playerColor,
      createdAt: new Date().toISOString(),
      attempts: 0,
      solved: false,
    }];
  }).slice(0, 3);
}

export function mergeReviewPositions(existing: ReviewPosition[], incoming: ReviewPosition[]) {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) if (!merged.has(item.id)) merged.set(item.id, item);
  return [...merged.values()].slice(-30);
}

export function weeklyPlan(profile: PlayerProfile, duePositions: number) {
  const independentTarget = profile.independentMoves < 40 ? 12 : 20;
  return [
    `${independentTarget} moves without revealing the best move`,
    duePositions ? `Revisit ${Math.min(3, duePositions)} saved position${duePositions === 1 ? "" : "s"}` : "Finish one game and save its key position",
    `Play one game as ${profile.games % 2 ? "White" : "Black"}`,
  ];
}

export function confidenceCalibration(decisions: MoveDecision[]) {
  const rated = decisions.filter((item) => item.confidence && item.delta !== undefined);
  if (!rated.length) return { label: "Not measured yet", detail: "Mark how sure you feel before moving to calibrate your chess judgment." };
  const confident = rated.filter((item) => item.confidence === "confident");
  const sound = confident.filter((item) => (item.delta ?? -999) >= -50).length;
  const rate = confident.length ? Math.round(sound / confident.length * 100) : 0;
  return confident.length
    ? { label: `${rate}% calibrated`, detail: `${sound} of ${confident.length} confident moves kept the position within half a pawn.` }
    : { label: "Careful thinker", detail: "You did not mark any move as confident in this game." };
}
