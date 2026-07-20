import RivalMindGame from "@/components/RivalMindGame";
import type { SessionMode, TimeControl } from "@/lib/game-types";
import { normalizeCustomTime } from "@/lib/game-session";

export const metadata = { title: "Training board · RivalMind" };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ time?: string; mode?: string; minutes?: string; increment?: string }> }) {
  const params = await searchParams;
  const timeControl: TimeControl = params.time === "blitz5" || params.time === "rapid10" || params.time === "steady15" || params.time === "custom" ? params.time : "open";
  const sessionMode: SessionMode = params.mode === "game" || params.mode === "cup" ? params.mode : "training";
  const customTime = normalizeCustomTime(params.minutes, params.increment);
  return <RivalMindGame timeControl={timeControl} sessionMode={sessionMode} customTime={customTime} />;
}
