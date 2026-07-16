import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "stockfish.wasm");
const destination = join(root, "public", "stockfish");
const assets = ["stockfish.js", "stockfish.wasm", "stockfish.worker.js", "Copying.txt"];

await mkdir(destination, { recursive: true });
await Promise.all(assets.map((asset) => copyFile(join(source, asset), join(destination, asset))));
console.log(`Synced ${assets.length} Stockfish WASM assets.`);
