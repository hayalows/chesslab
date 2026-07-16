import type { PlayerColor } from "./game-types";

export function isPlayerTurn(turn: PlayerColor, playerColor: PlayerColor) {
  return turn === playerColor;
}
