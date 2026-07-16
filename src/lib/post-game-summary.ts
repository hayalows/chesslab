import { Chess } from "chess.js";
import { explainMove } from "./engine-adapter";
import type { AssistantSnapshot, GameResult, GameTelemetry, GameTermination, MoveDecision, PlayerColor, PostGameSummary } from "./game-types";

export function describeOutcome(game: Chess, result: GameResult, endedOnTime = false) {
  const outcomeTitle = result === "win" ? "You won" : result === "loss" ? "You lost" : "Game drawn";
  const scoreline = result === "win" ? "1–0" : result === "loss" ? "0–1" : "½–½";
  let termination: GameTermination = "draw";
  let outcomeDetail = "The game ended in a draw.";

  if (endedOnTime) {
    termination = "timeout";
    outcomeDetail = result === "win" ? "Rival ran out of time." : "Your clock ran out.";
  } else if (game.isCheckmate()) {
    termination = "checkmate";
    outcomeDetail = result === "win" ? "You checkmated Rival." : "Rival checkmated you.";
  } else if (game.isStalemate()) {
    termination = "stalemate";
    outcomeDetail = "Draw by stalemate—there were no legal moves, but the king was not in check.";
  } else if (game.isThreefoldRepetition()) {
    termination = "threefold-repetition";
    outcomeDetail = "Draw by threefold repetition—the same position occurred three times.";
  } else if (game.isInsufficientMaterial()) {
    termination = "insufficient-material";
    outcomeDetail = "Draw by insufficient material—neither side had enough pieces to force checkmate.";
  } else if (game.isDrawByFiftyMoves()) {
    termination = "fifty-move-rule";
    outcomeDetail = "Draw by the fifty-move rule.";
  }

  return { termination, outcomeTitle, outcomeDetail, scoreline };
}

export function createPostGameSummary(args: {
  game: Chess;
  result: GameResult;
  endedOnTime?: boolean;
  telemetry: GameTelemetry;
  timeline: AssistantSnapshot[];
  decisions?: MoveDecision[];
  playerColor?: PlayerColor;
  newMilestones: string[];
}): PostGameSummary {
  const { game, result, telemetry, timeline, newMilestones } = args;
  const playerMoves = game.history({ verbose: true }).filter((_, index) => index % 2 === (args.playerColor === "b" ? 1 : 0));
  const castled = playerMoves.some((move) => move.san === "O-O" || move.san === "O-O-O");
  const decisions = timeline.filter((item) => item.actor === "You");
  const steadyDecisions = decisions.filter((item) => item.severity === "steady").length;
  const worst = [...decisions].sort((a, b) => a.delta - b.delta)[0];
  const topReply = worst?.result.candidates[0];
  const swing = worst ? Math.abs(worst.delta / 100).toFixed(2) : null;
  const headline = result === "win" ? "You converted the game—now keep the good habits."
    : result === "draw" ? "You held the game level and earned a draw."
      : "The result was a loss, but the turning point is clear.";
  const well = telemetry.bestMoveMatches > 0 ? `You found Stockfish’s first choice on ${telemetry.bestMoveMatches} of ${telemetry.analyzedMoves} analyzed decisions.`
    : castled ? "You gave your king a safer home before the position became sharp."
      : decisions.length ? `${steadyDecisions} of your ${decisions.length} analyzed decisions kept the evaluation nearly steady.`
        : "You completed the game and created a review you can learn from.";
  const keyMoment = worst && topReply
    ? `${worst.move} was the biggest swing. Stockfish preferred ${topReply.san} in reply. ${explainMove(topReply).replace(/^It /, "That move ")} The evaluation moved ${swing} pawns against you.`
    : worst ? `${worst.move} was the biggest swing, moving Stockfish’s evaluation ${swing} pawns against you.`
      : "Stockfish did not flag a major evaluation swing in the analyzed moves.";
  const watch = worst && worst.severity !== "steady"
    ? `Before a move like ${worst.move}, pause and compare your opponent’s checks and captures. Stockfish’s reply was ${topReply?.san ?? "forcing"}.`
    : telemetry.coachUses > 2 ? "Name your own candidate move before asking the coach, then compare the ideas."
      : "Keep checking your opponent’s forcing moves before you commit.";

  return {
    result,
    ...describeOutcome(game, result, args.endedOnTime),
    headline,
    well,
    watch,
    keyMoment,
    telemetry,
    newMilestones,
    decisions: args.decisions ?? [],
  };
}
