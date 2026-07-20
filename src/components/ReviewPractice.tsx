"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { ReviewPosition } from "@/lib/game-types";
import { REVIEW_POSITIONS_KEY } from "@/lib/learning-loop";
import styles from "./ReviewPractice.module.css";

export default function ReviewPractice() {
  const [positions, setPositions] = useState<ReviewPosition[]>([]);
  const [index, setIndex] = useState(0);
  const [fen, setFen] = useState("");
  const [result, setResult] = useState<"idle" | "correct" | "wrong" | "revealed">("idle");
  const current = positions[index];

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(REVIEW_POSITIONS_KEY) || "[]");
      const due = Array.isArray(saved) ? saved.filter((item: ReviewPosition) => !item.solved) : [];
      queueMicrotask(() => { setPositions(due); setFen(due[0]?.fen ?? ""); });
    } catch { queueMicrotask(() => setPositions([])); }
  }, []);

  const progress = positions.length ? `${index + 1} of ${positions.length}` : "Queue clear";
  const reason = useMemo(() => current?.reason === "coach-diverged" ? "You asked the coach, then chose another move here." : current?.reason === "blunder" ? "This was the largest tactical swing in the game." : "This move gave away noticeable control.", [current]);

  function persist(updated: ReviewPosition) {
    try {
      const all: ReviewPosition[] = JSON.parse(localStorage.getItem(REVIEW_POSITIONS_KEY) || "[]");
      localStorage.setItem(REVIEW_POSITIONS_KEY, JSON.stringify(all.map((item) => item.id === updated.id ? updated : item)));
    } catch { /* Practice remains usable when storage is blocked. */ }
  }

  function tryMove(from: string, to: string) {
    if (!current || result !== "idle") return false;
    const game = new Chess(fen);
    const candidate = `${from}${to}`;
    try {
      const move = game.move({ from, to, promotion: current.bestMoveUci[4] || "q" });
      if (!move) return false;
      const correct = current.bestMoveUci.startsWith(candidate);
      const updated = { ...current, attempts: current.attempts + 1, solved: correct };
      setPositions((items) => items.map((item, itemIndex) => itemIndex === index ? updated : item));
      setFen(game.fen());
      setResult(correct ? "correct" : "wrong");
      persist(updated);
      return true;
    } catch { return false; }
  }

  function next() {
    const nextIndex = index + 1;
    if (nextIndex >= positions.length) { setPositions([]); setFen(""); return; }
    setIndex(nextIndex);
    setFen(positions[nextIndex].fen);
    setResult("idle");
  }

  if (!current) return <main className={styles.shell}><section className={styles.empty}><span>REVIEW QUEUE</span><h1>You’re caught up.</h1><p>Finish a game and RivalMind will save up to three important positions verified by Stockfish.</p><Link href="/play?time=open">Play a training game</Link></section></main>;

  return <main className={styles.shell}>
    <header><Link href="/">RivalMind</Link><span>{progress}</span><Link href="/play?time=open">Return to game</Link></header>
    <section className={styles.practice}>
      <div className={styles.board}><Chessboard options={{ id: "review-board", position: fen, boardOrientation: current.playerColor === "w" ? "white" : "black", allowDragging: result === "idle", onPieceDrop: ({sourceSquare,targetSquare}) => Boolean(targetSquare && tryMove(sourceSquare,targetSquare)), showNotation: true, animationDurationInMs: 160, lightSquareStyle:{backgroundColor:"#e9edf1"}, darkSquareStyle:{backgroundColor:"#7d8da8"}, boardStyle:{borderRadius:"6px",boxShadow:"0 24px 65px rgba(27,37,60,.18)"} }} /></div>
      <aside>
        <span className={styles.eyebrow}>Saved position</span><h1>Find the move you missed.</h1><p>{reason}</p>
        <div className={styles.context}><span>You played <b>{current.playedMove}</b></span><span>Play for <b>{current.playerColor === "w" ? "White" : "Black"}</b></span></div>
        {result === "idle" && <div className={styles.prompt}><b>Your turn</b><p>Move the piece on the board. Look at checks, captures, and threats before guessing.</p></div>}
        {result === "correct" && <div className={styles.success}><b>That’s it: {current.bestMoveSan}</b><p>You recovered the move Stockfish preferred in the original position.</p></div>}
        {result === "wrong" && <div className={styles.retry}><b>Not the saved solution.</b><p>Stockfish preferred {current.bestMoveSan}. Reset the position and calculate why.</p></div>}
        {result === "revealed" && <div className={styles.retry}><b>Stockfish chose {current.bestMoveSan}</b><p>Replay the position later without revealing it.</p></div>}
        <div className={styles.actions}>{result === "wrong" ? <button onClick={() => {setFen(current.fen);setResult("idle");}}>Try again</button> : result === "correct" ? <button onClick={next}>Next position</button> : result === "idle" ? <button className={styles.secondary} onClick={() => setResult("revealed")}>Show Stockfish move</button> : <button onClick={next}>Next position</button>}</div>
      </aside>
    </section>
  </main>;
}
