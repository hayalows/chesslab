import assert from "node:assert/strict";
import test from "node:test";
import { opponentSettings } from "../src/lib/engine-adapter";
import { DEFAULT_PROFILE } from "../src/lib/game-types";

test("Master removes Stockfish's Elo limiter", () => {
  const settings = opponentSettings("master", DEFAULT_PROFILE);
  assert.equal(settings.elo, null);
  assert.equal(settings.multiPv, 1);
});

test("Rival search becomes faster as its clock gets low", () => {
  const comfortable = opponentSettings("master", DEFAULT_PROFILE, {
    clock: { whiteMs: 120_000, blackMs: 120_000, whiteIncrementMs: 0, blackIncrementMs: 0 },
  });
  const timePressure = opponentSettings("master", DEFAULT_PROFILE, {
    clock: { whiteMs: 12_000, blackMs: 12_000, whiteIncrementMs: 0, blackIncrementMs: 0 },
  });
  assert.equal(comfortable.movetimeMs, 2600);
  assert.equal(timePressure.movetimeMs, 300);
});

test("the Rival budgets from its own clock, not the player's clock", () => {
  const settings = opponentSettings("master", DEFAULT_PROFILE, {
    movingColor: "b",
    clock: { whiteMs: 5_000, blackMs: 120_000, whiteIncrementMs: 0, blackIncrementMs: 0 },
  });
  assert.equal(settings.movetimeMs, 2600);
});
