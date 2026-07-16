import assert from "node:assert/strict";
import test from "node:test";
import { isPlayerTurn } from "../src/lib/game-session";

test("coach turn ownership follows the selected player color", () => {
  assert.equal(isPlayerTurn("w", "w"), true);
  assert.equal(isPlayerTurn("b", "b"), true);
  assert.equal(isPlayerTurn("w", "b"), false);
  assert.equal(isPlayerTurn("b", "w"), false);
});
