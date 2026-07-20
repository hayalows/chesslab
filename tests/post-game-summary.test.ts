import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { createPostGameSummary, describeOutcome } from "../src/lib/post-game-summary";
import type { AssistantSnapshot, GameTelemetry, SearchResult } from "../src/lib/game-types";

test("a player checkmate loss is stated directly", () => {
  const game = new Chess();
  for (const move of ["f3", "e5", "g4", "Qh4#"]) game.move(move);
  assert.deepEqual(describeOutcome(game, "loss"), {
    termination: "checkmate",
    outcomeTitle: "You lost",
    outcomeDetail: "Rival checkmated you.",
    scoreline: "0-1",
  });
});

test("a player win states checkmate and the score", () => {
  const game = new Chess();
  for (const move of ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]) game.move(move);
  assert.equal(describeOutcome(game, "win").outcomeDetail, "You checkmated Rival.");
  assert.equal(describeOutcome(game, "win").scoreline, "1-0");
});

test("stalemate is distinguished from checkmate", () => {
  const game = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  const outcome = describeOutcome(game, "draw");
  assert.equal(outcome.termination, "stalemate");
  assert.equal(outcome.scoreline, "½-½");
});

test("clock losses state whose time expired", () => {
  assert.equal(describeOutcome(new Chess(), "loss", true).outcomeDetail, "Your clock ran out.");
  assert.equal(describeOutcome(new Chess(), "win", true).outcomeDetail, "Rival ran out of time.");
});

test("forced mate swings are explained without fake pawn precision", () => {
  const result = {
    candidates: [{ from: "b2", to: "b7", san: "Rxb7", uci: "b2b7", score: 99_999, mate: 1, line: ["b2b7"], lineSan: ["Rxb7#"] }],
    nodes: 500,
    depth: 12,
    timeMs: 20,
    nps: 25_000,
    engine: "Stockfish",
  } as SearchResult;
  const timeline = [{ id: "1", ply: 1, fen: new Chess().fen(), actor: "You", move: "Na7", whiteScore: -99_999, delta: -96_724, severity: "blunder", result, explanation: "" }] as AssistantSnapshot[];
  const telemetry = { totalTimeMs: 1_000, playerThinkMs: 500, rivalThinkMs: 300, coachUses: 0, coachTimeMs: 0, accuracy: 0, bestMoveMatches: 0, analyzedMoves: 1, independentMoves: 1, independentAccuracy: 0, coachFollowedMoves: 0, coachDivergedMoves: 0, coachGuidedMoves: 0, adaptiveBefore: 4, adaptiveAfter: 4, trainingPointsEarned: 10, timeControl: "open" } as GameTelemetry;
  const summary = createPostGameSummary({ game: new Chess(), result: "loss", telemetry, timeline, playerColor: "w", newMilestones: [] });

  assert.match(summary.keyMoment, /forced checkmate sequence/);
  assert.doesNotMatch(summary.keyMoment, /967\.24 pawns/);
});
