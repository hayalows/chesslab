import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { buildSnapshot, immediateCheckmates } from "../src/lib/assistant-insights";
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

test("all legal mate-in-one moves are surfaced in the reported position", () => {
  const fen = "8/8/6p1/3B4/2P1P1Pp/7P/R4Q2/1QK4k w - - 0 29";
  const mates = immediateCheckmates(fen).map((move) => move.san).sort();

  assert.deepEqual(mates, ["e5#", "Qg2#", "Qh2#", "Qf1#", "Qe1#", "Kb2#", "Kc2#", "Kd2#"].sort());
});

test("a normal opening position does not report an immediate checkmate", () => {
  assert.deepEqual(immediateCheckmates(new Chess().fen()), []);
});
