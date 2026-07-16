import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE, type AssistantSnapshot, type GameTelemetry, type MoveDecision, type PlayerProfile, type SearchResult } from "../src/lib/game-types";
import { advanceProfile, formatClock, learningScore } from "../src/lib/training-analytics";

function telemetry(profile: PlayerProfile, overrides: Partial<GameTelemetry> = {}) {
  return {
    timeControl: "open" as const,
    totalTimeMs: 10 * 60_000,
    playerThinkMs: 5 * 60_000,
    rivalThinkMs: 5_000,
    coachUses: 0,
    coachTimeMs: 0,
    accuracy: 80,
    bestMoveMatches: 3,
    analyzedMoves: 5,
    independentMoves: 5,
    independentAccuracy: 80,
    coachFollowedMoves: 0,
    coachDivergedMoves: 0,
    coachGuidedMoves: 0,
    adaptiveBefore: profile.adaptiveLevel,
    ...overrides,
  };
}

test("one loss never drops adaptive strength", () => {
  const next = advanceProfile(DEFAULT_PROFILE, "loss", telemetry(DEFAULT_PROFILE));
  assert.equal(next.profile.adaptiveLevel, DEFAULT_PROFILE.adaptiveLevel);
  assert.ok(next.profile.trainingPoints > 0);
});

test("clear form over four games raises the challenge once", () => {
  let profile = { ...DEFAULT_PROFILE };
  for (let game = 0; game < 4; game += 1) profile = advanceProfile(profile, "win", telemetry(profile)).profile;
  assert.equal(profile.adaptiveLevel, 5);
  assert.equal(profile.lastLevelChangeGame, 4);
  assert.equal(profile.bestStreak, 4);
});

test("milestones unlock at real thresholds", () => {
  const first = advanceProfile(DEFAULT_PROFILE, "draw", telemetry(DEFAULT_PROFILE));
  assert.ok(first.profile.milestones.includes("first_game"));
  const hour = advanceProfile(DEFAULT_PROFILE, "draw", telemetry(DEFAULT_PROFILE, { totalTimeMs: 60 * 60_000 }));
  assert.ok(hour.profile.milestones.includes("hour_trained"));
});

test("learning score recognizes an exact Stockfish first choice", () => {
  const result = { candidates: [{ san: "e4" }] } as SearchResult;
  const timeline = [
    { ply: 0, actor: "Start", result },
    { ply: 1, actor: "You", move: "e4", delta: -10, severity: "steady", result },
  ] as AssistantSnapshot[];
  const score = learningScore(timeline);
  assert.equal(score.bestMoveMatches, 1);
  assert.equal(score.analyzedMoves, 1);
  assert.ok(score.accuracy >= 90);
});

test("real-strength score excludes moves made after opening the coach", () => {
  const result = { candidates: [{ san: "e4" }] } as SearchResult;
  const timeline = [
    { ply: 0, actor: "Start", result },
    { ply: 1, actor: "You", move: "e4", delta: -10, severity: "steady", result },
    { ply: 3, actor: "You", move: "Nf3", delta: -240, severity: "blunder", result },
  ] as AssistantSnapshot[];
  const decisions = [
    { ply: 1, move: "e4", uci: "e2e4", source: "independent", suggestedMoves: [] },
    { ply: 3, move: "Nf3", uci: "g1f3", source: "coach-diverged", suggestedMoves: ["Bc4"] },
  ] as MoveDecision[];
  const score = learningScore(timeline, decisions);
  assert.equal(score.independentMoves, 1);
  assert.ok(score.independentAccuracy >= 90);
  assert.equal(score.coachDivergedMoves, 1);
  assert.ok(score.accuracy < score.independentAccuracy);
});

test("clock wording is stable at boundaries", () => {
  assert.equal(formatClock(null), "No clock");
  assert.equal(formatClock(60_000), "1:00");
  assert.equal(formatClock(1), "0:01");
  assert.equal(formatClock(0), "0:00");
});
