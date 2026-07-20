import type { PlayerColor } from "./game-types";

export function currentTimeMs() {
  return Date.now();
}

export function randomPlayerColor(): PlayerColor {
  const value = new Uint8Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0] % 2 === 0 ? "w" : "b";
}

export function uniqueAvatarSeed() {
  return globalThis.crypto.randomUUID();
}
