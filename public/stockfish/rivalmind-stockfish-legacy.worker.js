/* Compatibility UCI bridge for lichess-org/stockfish.wasm (GPL-3.0). */
let StockfishFactory = null;

try {
  importScripts("./stockfish.js");
  StockfishFactory = self.Stockfish;
} catch (error) {
  self.postMessage({ type: "bridge-error", message: `Stockfish script failed: ${String(error)}` });
}

let engine = null;
let commandQueue = [];

function send(command) {
  if (engine) engine.postMessage(command);
  else commandQueue.push(command);
}

self.onmessage = (event) => {
  if (typeof event.data === "string") send(event.data);
};

if (StockfishFactory) StockfishFactory({
  mainScriptUrlOrBlob: new URL("./stockfish.js", self.location.href).href,
})
  .then((instance) => {
    engine = instance;
    engine.addMessageListener((line) => self.postMessage({ type: "line", line }));
    for (const command of commandQueue) engine.postMessage(command);
    commandQueue = [];
    self.postMessage({ type: "bridge-ready" });
  })
  .catch((error) => {
    self.postMessage({ type: "bridge-error", message: error instanceof Error ? error.message : String(error) });
  });
else self.postMessage({ type: "bridge-error", message: "Stockfish factory was not exposed by stockfish.js." });
