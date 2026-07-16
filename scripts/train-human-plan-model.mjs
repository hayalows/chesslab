import fs from "node:fs";
import path from "node:path";
import { Chess } from "chess.js";

const root = process.cwd();
const csvPath = path.join(root, "data", "raw", "kaggle-chess", "games.csv");
const openingDir = path.join(root, "data", "raw", "lichess-openings");
const outputPath = path.join(root, "public", "models", "human-plan-v1.json");
const MAX_PLIES = 36;

function csvRow(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value);
  return values;
}

function positionKey(fen) {
  return fen.split(" ").slice(0, 4).join(" ");
}

function addGame(map, row) {
  const game = new Chess();
  const moves = row[12].split(" ").filter(Boolean).slice(0, MAX_PLIES);
  for (let ply = 0; ply < moves.length; ply += 1) {
    const key = positionKey(game.fen());
    try {
      const played = game.move(moves[ply]);
      if (!played) break;
      const uci = `${played.from}${played.to}${played.promotion ?? ""}`;
      const entry = map.get(key) ?? { total: 0, moves: new Map(), ply };
      entry.total += 1;
      entry.moves.set(uci, (entry.moves.get(uci) ?? 0) + 1);
      map.set(key, entry);
    } catch { break; }
  }
}

function topMoves(entry, limit = 4) {
  return [...entry.moves.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function evaluate(map, rows) {
  let seen = 0;
  let top1 = 0;
  let top3 = 0;
  for (const row of rows) {
    const game = new Chess();
    for (const san of row[12].split(" ").filter(Boolean).slice(0, MAX_PLIES)) {
      const entry = map.get(positionKey(game.fen()));
      try {
        const move = game.move(san);
        if (!move) break;
        if (entry?.total >= 2) {
          const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
          const top = topMoves(entry, 3).map(([candidate]) => candidate);
          seen += 1;
          if (top[0] === uci) top1 += 1;
          if (top.includes(uci)) top3 += 1;
        }
      } catch { break; }
    }
  }
  return { positions: seen, top1: seen ? top1 / seen : 0, top3: seen ? top3 / seen : 0 };
}

function openingIndex() {
  const result = {};
  if (!fs.existsSync(openingDir)) return result;
  for (const file of fs.readdirSync(openingDir).filter((name) => /^[a-e]\.tsv$/.test(name))) {
    const lines = fs.readFileSync(path.join(openingDir, file), "utf8").split(/\r?\n/).slice(1);
    for (const line of lines) {
      const [eco, name, pgn] = line.split("\t");
      if (!eco || !name || !pgn) continue;
      const game = new Chess();
      try {
        for (const token of pgn.replace(/\d+\.(\.\.)?/g, " ").split(/\s+/).filter((value) => value && !/^\{/.test(value))) game.move(token);
        result[positionKey(game.fen())] = [eco, name];
      } catch { /* Skip malformed or unsupported variants. */ }
    }
  }
  return result;
}

if (!fs.existsSync(csvPath)) throw new Error(`Missing ${csvPath}. Download the Kaggle datasnaek/chess dataset first.`);
const rows = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map(csvRow).filter((row) => row.length >= 16);
const split = Math.floor(rows.length * 0.8);
const train = new Map();
for (const row of rows.slice(0, split)) addGame(train, row);
const metrics = evaluate(train, rows.slice(split));
const all = new Map(train);
for (const row of rows.slice(split)) addGame(all, row);
const positions = {};
for (const [key, entry] of all) {
  if (entry.total < 3) continue;
  positions[key] = topMoves(entry).map(([uci, count]) => [uci, count]);
}
const artifact = {
  version: 1,
  trainedAt: new Date().toISOString(),
  source: "Kaggle datasnaek/chess (Lichess games) + lichess-org/chess-openings",
  games: rows.length,
  maxPlies: MAX_PLIES,
  metrics: { heldOutPositions: metrics.positions, top1: Number(metrics.top1.toFixed(4)), top3: Number(metrics.top3.toFixed(4)) },
  positions,
  openings: openingIndex(),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(artifact));
console.log(JSON.stringify({ outputPath, games: rows.length, positions: Object.keys(positions).length, openings: Object.keys(artifact.openings).length, metrics: artifact.metrics, bytes: fs.statSync(outputPath).size }, null, 2));
