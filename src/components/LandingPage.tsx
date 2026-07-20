"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import AuthMenu from "./AuthMenu";
import styles from "./LandingPage.module.css";

function Brand() {
  return <Link className={styles.brand} href="/" aria-label="RivalMind home"><span><i /><i /><i /></span>RivalMind</Link>;
}

function InteractiveBoard() {
  const gameRef = useRef(new Chess());
  const replyTimer = useRef<number | null>(null);
  const [fen, setFen] = useState(() => new Chess().fen());
  const [status, setStatus] = useState("Your move. Try any legal move.");
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => () => { if (replyTimer.current) window.clearTimeout(replyTimer.current); }, []);

  function reset() {
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    gameRef.current = new Chess();
    setFen(gameRef.current.fen());
    setLastMove(null);
    setStatus("Your move. Try any legal move.");
  }

  function move(from: string, to: string) {
    if (gameRef.current.turn() !== "w" || gameRef.current.isGameOver()) return false;
    try {
      const played = gameRef.current.move({ from, to, promotion: "q" });
      if (!played) return false;
      setFen(gameRef.current.fen());
      setLastMove({ from, to });
      setStatus("Rival is replying...");
      replyTimer.current = window.setTimeout(() => {
        const legal = gameRef.current.moves({ verbose: true });
        const reply = legal.find((candidate) => candidate.san.includes("+"))
          ?? legal.find((candidate) => candidate.captured)
          ?? legal[Math.min(4, legal.length - 1)];
        if (reply) {
          gameRef.current.move(reply);
          setFen(gameRef.current.fen());
          setLastMove({ from: reply.from, to: reply.to });
          setStatus(gameRef.current.isGameOver() ? "That mini game is complete." : "Your move. Every move is checked for legality.");
        }
      }, 520);
      return true;
    } catch { return false; }
  }

  const squareStyles = useMemo(() => lastMove ? {
    [lastMove.from]: { background: "rgba(219, 176, 76, .36)" },
    [lastMove.to]: { background: "rgba(219, 176, 76, .48)" },
  } : {}, [lastMove]);
  const renderGame = useMemo(() => new Chess(fen), [fen]);

  return <div className={styles.boardDemo}>
    <div className={styles.boardTop}><span>Interactive board</span><button type="button" onClick={reset}>Reset</button></div>
    <div className={styles.boardCanvas}>
      <Chessboard options={{
        id: "rivalmind-home-board",
        position: fen,
        showNotation: true,
        animationDurationInMs: 220,
        allowDragging: renderGame.turn() === "w" && !renderGame.isGameOver(),
        canDragPiece: ({ square }) => Boolean(square && renderGame.get(square as Square)?.color === "w"),
        onPieceDrop: ({ sourceSquare, targetSquare }) => Boolean(targetSquare && move(sourceSquare, targetSquare)),
        squareStyles,
        lightSquareStyle: { backgroundColor: "#eef1f4" },
        darkSquareStyle: { backgroundColor: "#7787a3" },
        boardStyle: { borderRadius: "12px" },
      }} />
    </div>
    <div className={styles.boardStatus}><span aria-hidden="true">SF</span><p><b>{status}</b><small>Stockfish powers the full game. This preview uses legal moves only.</small></p></div>
  </div>;
}

export default function LandingPage() {
  const [minutes, setMinutes] = useState(20);
  const [increment, setIncrement] = useState(5);
  const customHref = `/play?mode=game&time=custom&minutes=${minutes}&increment=${increment}`;

  return <main className={styles.shell}>
    <nav className={styles.nav}>
      <Brand />
      <div className={styles.navLinks}><Link href="#choose">Ways to play</Link><Link href="/dashboard">My profile</Link><AuthMenu triggerLabel="Sign in" /></div>
    </nav>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.kicker}>LEARN CHESS BY PLAYING</span>
        <h1>A chess game that helps you <em>see more.</em></h1>
        <p>Play Stockfish, understand each turning point, and need less help over time.</p>
        <div className={styles.heroActions}><Link className={styles.primary} href="/play?mode=training&time=open">Start training</Link><Link className={styles.secondary} href="/play?mode=game&time=rapid10">Play a game</Link></div>
      </div>
      <InteractiveBoard />
    </section>

    <section className={styles.proofStrip} aria-label="RivalMind foundations"><span><b>Stockfish 18</b> for every engine decision</span><span><b>Legal moves only</b> with chess.js rules</span><span><b>Guest first</b> with optional cloud sync</span><span><b>Human learning</b> from plain English reviews</span></section>

    <section className={styles.pathSection} id="choose">
      <div className={styles.sectionIntro}><h2>What do you want to do?</h2><p>Choose the experience first. You can set the color, clock, and Rival strength next.</p></div>
      <div className={styles.pathGrid}>
        <Link className={styles.playPath} href="/play?mode=game&time=rapid10"><span>PLAY</span><h3>Play a focused game</h3><p>No live help. Your decisions stay yours, then RivalMind explains the game afterward.</p><b>Set up a game <i>→</i></b></Link>
        <Link className={styles.trainPath} href="/play?mode=training&time=open"><span>TRAIN</span><h3>Learn with the coach</h3><p>Use clues, candidate moves, or the best move only when you need them.</p><b>Start a lesson <i>→</i></b></Link>
        <Link className={styles.cupPath} href="/play?mode=cup&time=rapid10"><span>TOURNAMENT</span><h3>Enter a Training Cup</h3><p>Play three rounds. The Rival gets stronger as you progress.</p><b>Enter the cup <i>→</i></b></Link>
      </div>
    </section>

    <section className={styles.customSection}>
      <div><h2>Your clock, your game.</h2><p>Set a custom starting time and optional increment for each player.</p></div>
      <div className={styles.customControls}>
        <label><span>Minutes</span><input aria-label="Custom minutes per player" type="number" min="1" max="180" value={minutes} onChange={(event) => setMinutes(Math.max(1, Math.min(180, Number(event.target.value) || 1)))} /></label>
        <label><span>Increment</span><div><input aria-label="Custom increment in seconds" type="number" min="0" max="60" value={increment} onChange={(event) => setIncrement(Math.max(0, Math.min(60, Number(event.target.value) || 0)))} /><small>sec</small></div></label>
        <Link href={customHref}>Play {minutes} + {increment}</Link>
      </div>
    </section>

    <section className={styles.learningSection}>
      <div className={styles.learningCopy}><h2>Play first. Understand more when you want to.</h2><p>RivalMind keeps the board focused and puts deeper detail behind choices you control.</p><Link href="/play?mode=training&time=open">See it in a training game</Link></div>
      <div className={styles.learningList}>
        <article><span>BOARD</span><div><h3>Play naturally</h3><p>Legal moves, smooth piece motion, captured material, and a Stockfish Rival at the strength you choose.</p></div></article>
        <article><span>COACH</span><div><h3>Ask only when needed</h3><p>The time-aware coach starts with a clue and reveals verified Stockfish moves only when you request them.</p></div></article>
        <article><span>STORY</span><div><h3>Understand the swing</h3><p>Plain English explains evaluation changes, threats, candidate moves, and forced mates.</p></div></article>
        <article><span>PROFILE</span><div><h3>Become more independent</h3><p>Your unassisted decisions shape adaptive strength, practice positions, and progress.</p></div></article>
      </div>
    </section>

    <section className={styles.profileSection}>
      <div><h2>Your training becomes yours.</h2><p>Play as a guest, then create a free profile when you want progress across devices.</p></div>
      <div><Link href="/dashboard">Open my profile</Link><AuthMenu triggerLabel="Create profile" prominent /></div>
    </section>

    <footer><Brand /><p>Stockfish calculates. RivalMind teaches.</p><Link href="/play?mode=training&time=open">Play as guest</Link></footer>
  </main>;
}
