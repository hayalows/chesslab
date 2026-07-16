import assert from "node:assert/strict";
import test from "node:test";
import { collectReviewPositions, comparePlayerIdea, confidenceCalibration, mergeReviewPositions } from "../src/lib/learning-loop";
import type { AssistantSnapshot, MoveDecision, SearchResult } from "../src/lib/game-types";

const move = (san: string, uci: string, score: number) => ({ san, uci, score, from: uci.slice(0,2), to: uci.slice(2,4), line: [uci], lineSan: [san] });

test("player ideas are compared only with searched Stockfish candidates", () => {
  const result = { candidates: [move("Nf3", "g1f3", 30), move("Bc4", "f1c4", 15)] } as SearchResult;
  assert.equal(comparePlayerIdea("Nf3", result)?.tone, "strong");
  assert.match(comparePlayerIdea("Bc4", result)?.text ?? "", /0.15 pawns/);
  assert.match(comparePlayerIdea("a3", result)?.text ?? "", /did not include/);
});

test("verified mistakes become deduplicated review positions", () => {
  const result = { candidates: [move("Nf3", "g1f3", 30)] } as SearchResult;
  const timeline = [
    { ply: 0, fen: "start", actor: "Start", result },
    { ply: 1, fen: "after", actor: "You", move: "f3", severity: "blunder", result },
  ] as AssistantSnapshot[];
  const decisions = [{ ply: 1, move: "f3", uci: "f2f3", source: "independent", suggestedMoves: [] }] as MoveDecision[];
  const saved = collectReviewPositions(timeline, decisions, "w");
  assert.equal(saved[0].bestMoveUci, "g1f3");
  assert.equal(mergeReviewPositions(saved, saved).length, 1);
});

test("confidence calibration rewards sound confident decisions", () => {
  const decisions = [
    { confidence: "confident", delta: -20 },
    { confidence: "confident", delta: -120 },
  ] as MoveDecision[];
  assert.equal(confidenceCalibration(decisions).label, "50% calibrated");
});
