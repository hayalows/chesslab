/* RivalMind UCI bridge for lichess-org/stockfish-web Stockfish 18 (AGPL-3.0-or-later). */
import StockfishFactory from "./sf_18_smallnet.js";

let engine = null;
let commandQueue = [];

function send(command) {
  if (engine) engine.uci(command);
  else commandQueue.push(command);
}

self.onmessage = (event) => {
  if (typeof event.data === "string") send(event.data);
};

StockfishFactory({
  locateFile: (file) => new URL(file, self.location.href).href,
  listen: (line) => self.postMessage({ type: "line", line }),
  onError: (message) => self.postMessage({ type: "bridge-error", message }),
})
  .then((instance) => {
    engine = instance;
    const nnue = engine.getRecommendedNnue();
    if (!nnue) throw new Error("Stockfish did not identify its NNUE network.");
    return fetch(new URL(nnue, self.location.href))
      .then((response) => {
        if (!response.ok) throw new Error(`NNUE network failed to load (${response.status}).`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        engine.setNnueBuffer(new Uint8Array(buffer));
        for (const command of commandQueue) engine.uci(command);
        commandQueue = [];
        self.postMessage({ type: "bridge-ready" });
      });
  })
  .catch((error) => {
    self.postMessage({
      type: "bridge-error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
