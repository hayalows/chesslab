import assert from "node:assert/strict";
import test from "node:test";
import { canRevealCoachStep, coachCacheMode, isPlayerTurn } from "../src/lib/game-session";

test("coach turn ownership follows the selected player color", () => {
  assert.equal(isPlayerTurn("w", "w"), true);
  assert.equal(isPlayerTurn("b", "b"), true);
  assert.equal(isPlayerTurn("w", "b"), false);
  assert.equal(isPlayerTurn("b", "w"), false);
});

test("visible move recommendations only reuse completed deep searches", () => {
  assert.equal(coachCacheMode("best"), "deep");
  assert.equal(coachCacheMode("candidates"), "deep");
  assert.equal(coachCacheMode("gentle"), "quick");
});

test("gentle coach does not reveal a move while deep analysis is refining", () => {
  assert.equal(canRevealCoachStep(1, true), true);
  assert.equal(canRevealCoachStep(2, true), true);
  assert.equal(canRevealCoachStep(3, true), false);
  assert.equal(canRevealCoachStep(3, false), true);
});
