import RivalMindGame from "@/components/RivalMindGame";
import type { TimeControl } from "@/lib/game-types";

export const metadata = { title: "Training board · RivalMind" };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ time?: string }> }) {
  const requested = (await searchParams).time;
  const timeControl: TimeControl = requested === "rapid10" || requested === "steady15" ? requested : "open";
  return <RivalMindGame timeControl={timeControl} />;
}
