import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const legacySource = join(root, "node_modules", "stockfish.wasm");
const modernSource = join(root, "node_modules", "@lichess-org", "stockfish-web");
const destination = join(root, "public", "stockfish");
const legacyAssets = ["stockfish.js", "stockfish.wasm", "stockfish.worker.js", "Copying.txt"];
const modernAssets = ["sf_18_smallnet.js", "sf_18_smallnet.wasm"];
const nnue = "nn-4ca89e4b3abf.nnue";

await mkdir(destination, { recursive: true });
await Promise.all([
  ...legacyAssets.map((asset) => copyFile(join(legacySource, asset), join(destination, asset))),
  ...modernAssets.map((asset) => copyFile(join(modernSource, asset), join(destination, asset))),
  copyFile(join(modernSource, "LICENSE"), join(destination, "Stockfish-Web-License.txt")),
]);

const nnuePath = join(destination, nnue);
try {
  await access(nnuePath);
} catch {
  const response = await fetch(`https://tests.stockfishchess.org/api/nn/${nnue}`);
  if (!response.ok) throw new Error(`Could not download Stockfish 18 NNUE (${response.status}).`);
  await writeFile(nnuePath, new Uint8Array(await response.arrayBuffer()));
}

console.log(`Synced Stockfish 18 smallnet, NNUE, and ${legacyAssets.length} fallback assets.`);
