import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../src/lib/assistant-insights";
import type { SearchResult } from "../src/lib/game-types";

const result = (score: number) => ({
  candidates: [{ from: "e2", to: "e4", san: "e4", score, uci: "e2e4", line: ["e2e4"], lineSan: ["e4"] }],
  nodes: 100,
  depth: 10,
  timeMs: 10,
  nps: 1000,
  engine: "Stockfish",
}) as SearchResult;

test("the same white evaluation swing is good for White and bad for Black", () => {
  const white = buildSnapshot({ ply: 1, fen: "8/8/8/8/8/8/4K3/7k w - - 0 1", actor: "You", result: result(100), previousWhiteScore: 0, playerColor: "w" });
  const black = buildSnapshot({ ply: 1, fen: "8/8/8/8/8/8/4K3/7k w - - 0 1", actor: "You", result: result(100), previousWhiteScore: 0, playerColor: "b" });
  assert.equal(white.delta, 100);
  assert.equal(black.delta, -100);
  assert.equal(black.severity, "mistake");
});
