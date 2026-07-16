import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { describeOutcome } from "../src/lib/post-game-summary";

test("a player checkmate loss is stated directly", () => {
  const game = new Chess();
  for (const move of ["f3", "e5", "g4", "Qh4#"]) game.move(move);
  assert.deepEqual(describeOutcome(game, "loss"), {
    termination: "checkmate",
    outcomeTitle: "You lost",
    outcomeDetail: "Rival checkmated you.",
    scoreline: "0–1",
  });
});

test("a player win states checkmate and the score", () => {
  const game = new Chess();
  for (const move of ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]) game.move(move);
  assert.equal(describeOutcome(game, "win").outcomeDetail, "You checkmated Rival.");
  assert.equal(describeOutcome(game, "win").scoreline, "1–0");
});

test("stalemate is distinguished from checkmate", () => {
  const game = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  const outcome = describeOutcome(game, "draw");
  assert.equal(outcome.termination, "stalemate");
  assert.equal(outcome.scoreline, "½–½");
});

test("clock losses state whose time expired", () => {
  assert.equal(describeOutcome(new Chess(), "loss", true).outcomeDetail, "Your clock ran out.");
  assert.equal(describeOutcome(new Chess(), "win", true).outcomeDetail, "Rival ran out of time.");
});
