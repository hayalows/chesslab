import { confidence, explainCandidate, healthScore, outlook, phaseLabel, tacticalRadar } from "@/lib/assistant-insights";
import type { AssistantSnapshot, EngineStatus } from "@/lib/game-types";
import styles from "./RivalMindGame.module.css";

type Props = {
  enabled: boolean;
  onToggle: () => void;
  status: EngineStatus;
  thinking: boolean;
  latest: AssistantSnapshot | null;
  timeline: AssistantSnapshot[];
};

function evaluation(score: number) {
  if (Math.abs(score) > 90_000) return score > 0 ? "White has mate" : "Black has mate";
  return `${score >= 0 ? "+" : ""}${(score / 100).toFixed(2)}`;
}

export default function GameAssistant({ enabled, onToggle, status, thinking, latest, timeline }: Props) {
  const result = latest?.result ?? null;
  const main = result?.candidates[0];
  const view = result && latest ? outlook(result, latest.fen) : null;
  const radar = tacticalRadar(main);
  const certainty = result ? confidence(result) : null;
  const mistakes = timeline.filter((item) => item.actor === "You" && item.ply > 0);

  return (
    <section className={`${styles.panel} ${styles.assistantPanel}`} aria-label="RivalMind game assistant">
      <div className={styles.assistantHeader}>
        <div><span className={styles.eyebrow}>Game assistant</span><h2>Understand the game, move by move.</h2></div>
        <button className={styles.toggle} type="button" role="switch" aria-checked={enabled} onClick={onToggle}><i />{enabled ? "On" : "Off"}</button>
      </div>

      {!enabled ? <div className={styles.assistantEmpty}>Assistant is off. Rival and the optional coach still run independently.</div>
        : status === "error" ? <div className={styles.assistantEmpty}>The assistant engine could not start. Reload to try again.</div>
          : !latest || !result || thinking ? <div className={styles.assistantEmpty}><span className={styles.thinkingDot} />{status === "loading" ? "Starting the interpreter…" : "Reading Stockfish's latest lines…"}</div>
            : <>
              <div className={styles.positionHero}>
                <div className={styles.healthRing} style={{ "--health": `${healthScore(latest.whiteScore) * 3.6}deg` } as React.CSSProperties}><span>{healthScore(latest.whiteScore)}</span><small>health</small></div>
                <div><span className={styles.phasePill}>{phaseLabel(latest.fen)}</span><h3>{latest.explanation}</h3><p>White evaluation {evaluation(latest.whiteScore)} · {result.nodes.toLocaleString()} positions considered</p></div>
              </div>

              {view && <div className={styles.outlook} aria-label="Position outlook">
                <span><b>{view.win}%</b> win</span><span><b>{view.draw}%</b> draw</span><span><b>{view.loss}%</b> loss</span>
                <small>{view.native ? "Stockfish WDL" : "RivalMind outlook calculated only from the shown Stockfish score"}</small>
              </div>}

              <details className={styles.insightCard} open>
                <summary><span><b>Why did the position change?</b></span><em>{latest.delta > 20 ? "Better for you" : latest.delta < -20 ? "Worse for you" : "About the same"}</em></summary>
                <p>{latest.explanation}</p>
                <div className={styles.evidenceLine}>Stockfish expects <b>{main?.lineSan.slice(0, 5).join(" ") || "Still checking…"}</b></div>
              </details>

              <details className={styles.insightCard}>
                <summary><span><b>Other moves to consider</b></span><em>{result.candidates.length} ideas</em></summary>
                <div className={styles.alternatives}>{result.candidates.slice(0, 3).map((move, index) => <div key={move.uci}><span>{index + 1}</span><p><b>{move.san}</b>{explainCandidate(move, main?.score ?? move.score, index)}</p><em>{evaluation(latest.fen.split(" ")[1] === "w" ? move.score : -move.score)}</em></div>)}</div>
              </details>

              <details className={styles.insightCard}>
                <summary><span><b>Checks, captures and threats</b></span><em>{radar.label}</em></summary>
                <p>{radar.text}</p>
                <p className={styles.guardrail}>RivalMind does not label a fork, pin, or skewer unless it can verify it in the displayed engine line.</p>
              </details>

              <details className={styles.insightCard}>
                <summary><span><b>Stockfish details</b></span><em>{certainty?.label} confidence</em></summary>
                <p>{certainty?.detail}</p>
                <div className={styles.advancedGrid}><span>Depth<b>{result.depth}</b></span><span>Nodes<b>{result.nodes.toLocaleString()}</b></span><span>Speed<b>{result.nps.toLocaleString()}/s</b></span><span>Time<b>{(result.timeMs / 1000).toFixed(2)}s</b></span></div>
              </details>

              <div className={styles.timelineBlock}>
                <div className={styles.timelineHeading}><b>Mistake severity</b><span>{mistakes.length ? "Your decisions" : "Starts after your first move"}</span></div>
                <div className={styles.timeline}>{mistakes.length ? mistakes.slice(-8).map((item) => <span key={item.id} data-severity={item.severity} title={`${item.move}: ${item.explanation}`}><i />{item.move}</span>) : <i className={styles.timelineEmpty} />}</div>
              </div>
            </>}
    </section>
  );
}
