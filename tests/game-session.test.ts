import assert from "node:assert/strict";
import test from "node:test";
import { canRevealCoachStep, coachCacheMode, coachSearchPlan, isPlayerTurn, normalizeCustomTime } from "../src/lib/game-session";

test("coach turn ownership follows the selected player color", () => {
  assert.equal(isPlayerTurn("w", "w"), true);
  assert.equal(isPlayerTurn("b", "b"), true);
  assert.equal(isPlayerTurn("w", "b"), false);
  assert.equal(isPlayerTurn("b", "w"), false);
});

test("coach detail levels choose the expected default search class", () => {
  assert.equal(coachCacheMode("best"), "deep");
  assert.equal(coachCacheMode("candidates"), "deep");
  assert.equal(coachCacheMode("gentle"), "quick");
});

test("the coach shortens search without reducing candidate coverage under time pressure", () => {
  const twoMinutePlan = coachSearchPlan("best", 120_000);
  const criticalPlan = coachSearchPlan("candidates", 18_000);
  assert.equal(twoMinutePlan.mode, "quick");
  assert.equal(twoMinutePlan.options.movetimeMs, 480);
  assert.equal(twoMinutePlan.options.multiPv, 3);
  assert.equal(criticalPlan.options.movetimeMs, 220);
  assert.equal(criticalPlan.pressure, "critical");
});

test("open practice keeps deep move analysis available", () => {
  const plan = coachSearchPlan("best", null);
  assert.equal(plan.mode, "deep");
  assert.equal(plan.options.multiPv, 4);
  assert.equal(plan.pressure, "none");
});

test("gentle coach does not reveal a move while deep analysis is refining", () => {
  assert.equal(canRevealCoachStep(1, true), true);
  assert.equal(canRevealCoachStep(2, true), true);
  assert.equal(canRevealCoachStep(3, true), false);
  assert.equal(canRevealCoachStep(3, false), true);
});

test("custom clocks stay inside playable limits", () => {
  assert.deepEqual(normalizeCustomTime("25", "10"), { minutes: 25, incrementSeconds: 10 });
  assert.deepEqual(normalizeCustomTime("0", "-4"), { minutes: 20, incrementSeconds: 0 });
  assert.deepEqual(normalizeCustomTime("999", "99"), { minutes: 180, incrementSeconds: 60 });
});
