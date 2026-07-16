import { confidence, explainCandidate, healthScore, outlook, phaseLabel, tacticalRadar } from "@/lib/assistant-insights";
import type { AssistantSnapshot, EngineStatus, MoveDecision, PlayerColor } from "@/lib/game-types";
import styles from "./RivalMindGame.module.css";

type Props = {
  enabled: boolean;
  onToggle: () => void;
  status: EngineStatus;
  thinking: boolean;
  latest: AssistantSnapshot | null;
  timeline: AssistantSnapshot[];
  decisions: MoveDecision[];
  playerColor: PlayerColor;
};

function evaluation(score: number, mate?: number) {
  if (mate !== undefined) return `${mate > 0 ? "Mate in" : "Mated in"} ${Math.abs(mate)}`;
  if (Math.abs(score) > 90_000) return score > 0 ? "White has a forced mate" : "Black has a forced mate";
  return `${score >= 0 ? "+" : ""}${(score / 100).toFixed(2)}`;
}

export default function GameAssistant({ enabled, onToggle, status, thinking, latest, timeline, decisions, playerColor }: Props) {
  const result = latest?.result ?? null;
  const main = result?.candidates[0];
  const view = result && latest ? outlook(result, latest.fen) : null;
  const radar = tacticalRadar(main);
  const certainty = result ? confidence(result) : null;
  const mistakes = timeline.filter((item) => item.actor === "You" && item.ply > 0);
  const independent = decisions.filter((item) => item.source === "independent");
  const assisted = decisions.length - independent.length;
  const independentRate = decisions.length ? Math.round(independent.length / decisions.length * 100) : 100;
  const playerMate = main?.mate === undefined ? undefined : main.mate * (latest?.fen.split(" ")[1] === playerColor ? 1 : -1);

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
                <div><span className={styles.phasePill}>{phaseLabel(latest.fen)}</span><h3>{latest.explanation}</h3><p>Your position {evaluation(playerColor === "w" ? latest.whiteScore : -latest.whiteScore, playerMate)} · {result.nodes.toLocaleString()} positions considered</p></div>
              </div>

              <div className={styles.independenceLive}>
                <div><span>Coach independence</span><b>{independentRate}%</b><small>{independent.length} own decisions · {assisted} with help</small></div>
                <i><em style={{ width: `${independentRate}%` }} /></i>
                <p>Your independent moves are the main signal used to estimate your real playing strength.</p>
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
                <div className={styles.alternatives}>{result.candidates.slice(0, 3).map((move, index) => {
                  const fromPlayerSide = latest.fen.split(" ")[1] === playerColor;
                  return <div key={move.uci}><span>{index + 1}</span><p><b>{move.san}</b>{explainCandidate(move, main?.score ?? move.score, index)}</p><em>{evaluation(fromPlayerSide ? move.score : -move.score, move.mate === undefined ? undefined : move.mate * (fromPlayerSide ? 1 : -1))}</em></div>;
                })}</div>
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
