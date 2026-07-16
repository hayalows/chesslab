import { Chess } from "chess.js";

type HumanPlanArtifact = {
  version: number;
  games: number;
  metrics: { heldOutPositions: number; top1: number; top3: number };
  positions: Record<string, [string, number][]>;
  openings: Record<string, [string, string]>;
};

export type HumanPlan = { moves: string[]; probability: number };
export type HumanPlanView = { plans: HumanPlan[]; opening?: string; games: number; top3Accuracy: number };
const PERSONAL_KEY = "rivalmind-personal-move-model-v1";
let artifactPromise: Promise<HumanPlanArtifact> | null = null;

function key(fen: string) { return fen.split(" ").slice(0, 4).join(" "); }

function loadArtifact() {
  artifactPromise ??= fetch("/models/human-plan-v1.json").then((response) => {
    if (!response.ok) throw new Error("Human plan model unavailable");
    return response.json() as Promise<HumanPlanArtifact>;
  });
  return artifactPromise;
}

function personalCounts(): Record<string, Record<string, number>> {
  if (typeof window === "undefined") return {} as Record<string, Record<string, number>>;
  try { return JSON.parse(localStorage.getItem(PERSONAL_KEY) || "{}"); } catch { return {}; }
}

export function recordPersonalMove(fen: string, uci: string) {
  if (typeof window === "undefined") return;
  try {
    const counts = personalCounts();
    const position = key(fen);
    counts[position] ??= {};
    counts[position][uci] = (counts[position][uci] ?? 0) + 1;
    const trimmed = Object.fromEntries(Object.entries(counts).slice(-160));
    localStorage.setItem(PERSONAL_KEY, JSON.stringify(trimmed));
  } catch { /* Personal learning is optional when storage is blocked. */ }
}

export async function predictHumanPlans(fen: string, depth = 4): Promise<HumanPlanView> {
  const artifact = await loadArtifact();
  const personal = personalCounts();
  let beams = [{ fen, moves: [] as string[], probability: 1 }];
  for (let ply = 0; ply < depth; ply += 1) {
    const expanded: typeof beams = [];
    for (const beam of beams) {
      const position = key(beam.fen);
      const combined = new Map(artifact.positions[position] ?? []);
      for (const [move, count] of Object.entries(personal[position] ?? {})) combined.set(move, (combined.get(move) ?? 0) + count * 6);
      const choices = [...combined.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const total = choices.reduce((sum, [, count]) => sum + count, 0);
      if (!choices.length || !total) { expanded.push(beam); continue; }
      for (const [uci, count] of choices) {
        const game = new Chess(beam.fen);
        try {
          const played = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
          if (played) expanded.push({ fen: game.fen(), moves: [...beam.moves, played.san], probability: beam.probability * count / total });
        } catch { /* Ignore stale or malformed training moves. */ }
      }
    }
    beams = expanded.sort((a, b) => b.probability - a.probability).slice(0, 6);
  }
  const opening = artifact.openings[key(fen)]?.[1];
  return { plans: beams.filter((beam) => beam.moves.length).slice(0, 3), opening, games: artifact.games, top3Accuracy: artifact.metrics.top3 };
}
