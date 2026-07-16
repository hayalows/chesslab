"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard, type Arrow } from "react-chessboard";
import {
  DIFFICULTY_PRESETS,
  explainMove,
  opponentStrengthLabel,
  RivalCoach,
  RivalEngine,
} from "@/lib/engine-adapter";
import {
  DEFAULT_PROFILE,
  type CoachLevel,
  type Difficulty,
  type EngineStatus,
  type GameResult,
  type PlayerProfile,
  type SearchResult,
} from "@/lib/game-types";
import styles from "./RivalMindGame.module.css";

const PROFILE_KEY = "rivalmind-player-profile-v1";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "adaptive"];
const COACH_LEVELS: { value: CoachLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "gentle", label: "Gentle" },
  { value: "candidates", label: "Candidates" },
  { value: "best", label: "Best move" },
];

type GameSummary = { result: GameResult; well: string; watch: string };

function resultLabel(result: GameResult) {
  return result === "win" ? "You won" : result === "loss" ? "Rival won" : "Draw";
}

function createSummary(game: Chess, result: GameResult, hintsThisGame: number): GameSummary {
  const playerMoves = game.history({ verbose: true }).filter((_, index) => index % 2 === 0);
  const castled = playerMoves.some((move) => move.san === "O-O" || move.san === "O-O-O");
  const captured = playerMoves.some((move) => Boolean(move.captured));
  const well = result === "win"
    ? "You converted the position and found the finish."
    : castled
      ? "You gave your king a safer home before taking risks."
      : captured
        ? "You stayed alert to tactical chances."
        : "You kept the game moving with legal, purposeful play.";
  const watch = result === "loss"
    ? "Before committing, scan every check, capture, and threat."
    : hintsThisGame > 3
      ? "Try naming your own candidate move before opening the coach."
      : "Keep asking what your opponent wants on the next move.";
  return { result, well, watch };
}

function gentleHint(result: SearchResult) {
  const move = result.candidates[0];
  if (!move) return "Take a breath and scan every check, capture, and threat.";
  if (move.captured) return "There is a forcing capture worth calculating before you make a quiet move.";
  if (move.san.includes("+")) return "A check can improve your position with tempo here.";
  if (["d4", "d5", "e4", "e5"].includes(move.to)) return "The center is asking for more attention. Look for a move that increases your influence there.";
  return "One of your pieces can become more active without creating a new weakness.";
}

function evaluationLabel(score: number | undefined) {
  if (score === undefined) return "—";
  if (Math.abs(score) > 90_000) return score > 0 ? "Winning mate" : "Mate threat";
  const pawns = score / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export default function RivalMindGame() {
  const gameRef = useRef(new Chess());
  const opponentRef = useRef<RivalEngine | null>(null);
  const coachRef = useRef<RivalCoach | null>(null);
  const gameVersionRef = useRef(0);
  const gameFinishedRef = useRef(false);
  const [fen, setFen] = useState(() => new Chess().fen());
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [coachLevel, setCoachLevel] = useState<CoachLevel>("gentle");
  const [profile, setProfile] = useState<PlayerProfile>(DEFAULT_PROFILE);
  const [profileReady, setProfileReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [coachThinking, setCoachThinking] = useState(false);
  const [coachResult, setCoachResult] = useState<SearchResult | null>(null);
  const [lastSearch, setLastSearch] = useState<{ actor: "Rival" | "Coach"; nodes: number; depth: number; timeMs: number; engine: string } | null>(null);
  const [rivalEngineStatus, setRivalEngineStatus] = useState<EngineStatus>("loading");
  const [coachEngineStatus, setCoachEngineStatus] = useState<EngineStatus>("loading");
  const [engineName, setEngineName] = useState("Stockfish WASM");
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [message, setMessage] = useState("Your move. You are playing White.");
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [hintsThisGame, setHintsThisGame] = useState(0);

  useEffect(() => {
    opponentRef.current = new RivalEngine((status, name) => {
      setRivalEngineStatus(status);
      setEngineName(name);
    });
    coachRef.current = new RivalCoach((status) => setCoachEngineStatus(status));
    let savedProfile: PlayerProfile | null = null;
    try {
      const saved = window.localStorage.getItem(PROFILE_KEY);
      if (saved) savedProfile = { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
    } catch {
      // A blocked or malformed local profile should never stop a game.
    }
    const profileToRestore = savedProfile;
    queueMicrotask(() => {
      if (profileToRestore) setProfile(profileToRestore);
      setProfileReady(true);
    });
    return () => {
      opponentRef.current?.dispose();
      coachRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile, profileReady]);

  const renderGame = useMemo(() => new Chess(fen), [fen]);

  const legalTargets = useMemo(() => {
    if (!selectedSquare) return [];
    try {
      return renderGame.moves({ square: selectedSquare as Square, verbose: true }).map((move) => move.to);
    } catch {
      return [];
    }
  }, [renderGame, selectedSquare]);

  const arrows = useMemo<Arrow[]>(() => {
    if (!coachResult || coachLevel === "gentle" || coachLevel === "off") return [];
    const moves = coachLevel === "best" ? coachResult.candidates.slice(0, 1) : coachResult.candidates.slice(0, 3);
    return moves.map((move, index) => ({
      startSquare: move.from,
      endSquare: move.to,
      color: index === 0 ? "rgba(66, 86, 143, .84)" : "rgba(66, 86, 143, .42)",
    }));
  }, [coachLevel, coachResult]);

  const squareStyles = useMemo(() => {
    const result: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      result[lastMove.from] = { background: "rgba(237, 196, 91, .34)" };
      result[lastMove.to] = { background: "rgba(237, 196, 91, .46)" };
    }
    if (selectedSquare) result[selectedSquare] = { background: "rgba(75, 99, 166, .42)" };
    for (const square of legalTargets) {
      result[square] = {
        background: "radial-gradient(circle, rgba(38, 52, 90, .28) 0 15%, transparent 17%)",
      };
    }
    return result;
  }, [lastMove, legalTargets, selectedSquare]);

  function recordResult(result: GameResult) {
    setProfile((current) => {
      const recentResults = [...current.recentResults, result].slice(-5);
      const levelDelta = result === "win" ? 1 : result === "loss" ? -1 : 0;
      return {
        ...current,
        games: current.games + 1,
        wins: current.wins + (result === "win" ? 1 : 0),
        losses: current.losses + (result === "loss" ? 1 : 0),
        draws: current.draws + (result === "draw" ? 1 : 0),
        adaptiveLevel: Math.max(1, Math.min(10, current.adaptiveLevel + levelDelta)),
        recentResults,
      };
    });
  }

  function finishGame() {
    if (gameFinishedRef.current) return;
    gameFinishedRef.current = true;
    const game = gameRef.current;
    const result: GameResult = game.isCheckmate() ? (game.turn() === "b" ? "win" : "loss") : "draw";
    recordResult(result);
    setSummary(createSummary(game, result, hintsThisGame));
    setMessage(resultLabel(result));
  }

  async function requestRivalMove(position: string) {
    const version = gameVersionRef.current;
    setThinking(true);
    setMessage("Rival is thinking…");
    try {
      const engine = opponentRef.current;
      if (!engine) throw new Error("Engine is still starting");
      const result = await engine.chooseMove(position, difficulty, profile);
      if (version !== gameVersionRef.current) return;
      gameRef.current.move({ from: result.move.from, to: result.move.to, promotion: result.move.promotion ?? "q" });
      setFen(gameRef.current.fen());
      setMoveHistory(gameRef.current.history());
      setLastMove({ from: result.move.from, to: result.move.to });
      setLastSearch({ actor: "Rival", nodes: result.nodes, depth: result.depth, timeMs: result.timeMs, engine: result.engine });
      setMessage(gameRef.current.isCheck() ? "Your king is in check." : "Your move.");
      if (gameRef.current.isGameOver()) finishGame();
    } catch {
      if (version === gameVersionRef.current) setMessage("Stockfish could not finish that search. Reload the page to restart the engine.");
    } finally {
      if (version === gameVersionRef.current) setThinking(false);
    }
  }

  function makePlayerMove(from: string, to: string) {
    if (thinking || coachThinking || gameRef.current.turn() !== "w" || gameRef.current.isGameOver()) return false;
    try {
      const move = gameRef.current.move({ from, to, promotion: "q" });
      if (!move) return false;
      const nextFen = gameRef.current.fen();
      setFen(nextFen);
      setMoveHistory(gameRef.current.history());
      setLastMove({ from, to });
      setSelectedSquare(null);
      setCoachResult(null);
      if (gameRef.current.isGameOver()) finishGame();
      else void requestRivalMove(nextFen);
      return true;
    } catch {
      setMessage("That move is not legal in this position.");
      return false;
    }
  }

  function handleSquareClick(square: string) {
    if (selectedSquare === square) {
      setSelectedSquare(null);
      setMessage("Selection cleared. Choose a white piece.");
      return;
    }
    if (selectedSquare && makePlayerMove(selectedSquare, square)) return;
    const piece = gameRef.current.get(square as Square);
    if (piece?.color === "w") {
      setSelectedSquare(square);
      setMessage(`Selected ${square}. Choose a highlighted square.`);
    } else {
      setSelectedSquare(null);
      setMessage("Choose one of your white pieces first.");
    }
  }

  async function askCoach() {
    if (coachLevel === "off" || thinking || coachThinking || gameRef.current.turn() !== "w" || gameRef.current.isGameOver()) return;
    setCoachThinking(true);
    setCoachResult(null);
    try {
      const result = await coachRef.current?.analyze(gameRef.current.fen());
      if (!result) return;
      setCoachResult(result);
      setLastSearch({ actor: "Coach", nodes: result.nodes, depth: result.depth, timeMs: result.timeMs, engine: result.engine });
      setHintsThisGame((count) => count + 1);
      setProfile((current) => ({ ...current, hintUsage: current.hintUsage + 1 }));
    } catch {
      setMessage("The Stockfish coach is unavailable. Reload the page to restart it.");
    } finally {
      setCoachThinking(false);
    }
  }

  function newGame() {
    gameVersionRef.current += 1;
    gameFinishedRef.current = false;
    gameRef.current = new Chess();
    setFen(gameRef.current.fen());
    setThinking(false);
    setCoachThinking(false);
    setCoachResult(null);
    setLastSearch(null);
    setLastMove(null);
    setMoveHistory([]);
    setSelectedSquare(null);
    setHintsThisGame(0);
    setSummary(null);
    setMessage("Your move. You are playing White.");
  }

  const gameOver = renderGame.isGameOver();
  const playerTurn = renderGame.turn() === "w";
  const statusTone = thinking || coachThinking ? styles.thinkingDot : gameOver ? styles.doneDot : styles.readyDot;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="RivalMind home">
          <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
          RivalMind
        </a>
        <p>Play. Think. Improve.</p>
        <div className={styles.headerStats} aria-label="Player record">
          <span><b>{profile.games}</b> games</span>
          <span><b>{profile.wins}</b> wins</span>
          <span>Level <b>{profile.adaptiveLevel}</b></span>
        </div>
      </header>

      <section className={styles.workspace} id="top">
        <aside className={styles.leftRail}>
          <div className={styles.panel}>
            <span className={styles.eyebrow}>Opponent</span>
            <div className={styles.opponentRow}>
              <span className={styles.avatar}>RM</span>
              <div><h2>Rival</h2><p>Powered by Stockfish</p></div>
              <span className={rivalEngineStatus === "ready" ? styles.onlineDot : rivalEngineStatus === "error" ? styles.engineErrorDot : styles.thinkingDot} aria-label={`Engine ${rivalEngineStatus}`} />
            </div>
            <div className={styles.engineStatus} data-status={rivalEngineStatus}>
              <span className={styles.engineGlyph}>SF</span>
              <span><b>{engineName}</b><small>{rivalEngineStatus === "ready" ? "Engine online · every reply verified" : rivalEngineStatus === "error" ? "Engine unavailable · reload to retry" : "Loading the chess engine…"}</small></span>
            </div>
            <label className={styles.fieldLabel} htmlFor="difficulty">Difficulty</label>
            <select id="difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
              {DIFFICULTIES.map((level) => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}{level === "adaptive" ? "" : ` · ${DIFFICULTY_PRESETS[level].elo}`}</option>)}
            </select>
            <p className={styles.supportingCopy}>
              {difficulty === "adaptive"
                ? `Tracks your last five results and meets you near level ${profile.adaptiveLevel}.`
                : DIFFICULTY_PRESETS[difficulty].description}
            </p>
            <div className={styles.searchSpec}><span>Current target</span><b>{opponentStrengthLabel(difficulty, profile)}</b></div>
          </div>

          <div className={`${styles.panel} ${styles.movesPanel}`}>
            <div className={styles.panelHeading}><span className={styles.eyebrow}>Moves</span><span>{Math.ceil(moveHistory.length / 2)}</span></div>
            <div className={styles.moveList}>
              {moveHistory.length === 0 ? <p>No moves yet. White begins.</p> : Array.from({ length: Math.ceil(moveHistory.length / 2) }, (_, index) => (
                <div className={styles.moveRow} key={index}>
                  <span>{index + 1}.</span><b>{moveHistory[index * 2]}</b><b>{moveHistory[index * 2 + 1] ?? ""}</b>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className={styles.boardStage} aria-label="Chess game">
          <div className={styles.mobileGameControls} aria-label="Quick game controls">
            <label htmlFor="mobile-difficulty">
              <span>Rival strength</span>
              <select id="mobile-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
                {DIFFICULTIES.map((level) => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
              </select>
            </label>
            <button type="button" disabled={coachLevel === "off" || coachEngineStatus !== "ready" || thinking || coachThinking || !playerTurn || gameOver} onClick={() => void askCoach()}>
              {coachThinking ? "Thinking…" : "Ask coach"}
            </button>
          </div>
          <div className={styles.playerStrip}>
            <div><span className={styles.miniAvatar}>SF</span><span><b>Rival</b><small>Stockfish · {difficulty}</small></span></div>
            <div className={styles.stripActions}>
              <span className={styles.turnPill}>{thinking ? "Thinking" : !playerTurn ? "To move" : "Waiting"}</span>
              <button className={styles.inlineNewGame} type="button" onClick={newGame} aria-label="Start a new game" title="Start a new game">↻</button>
            </div>
          </div>
          <div className={styles.boardFrame}>
            {moveHistory.length === 0 && !thinking && (
              <div className={styles.startGuide} aria-hidden="true">
                <b>You are White</b>
                <span>Drag a piece, or tap it then tap a highlighted square.</span>
              </div>
            )}
            <Chessboard options={{
              id: "rivalmind-board",
              position: fen,
              boardOrientation: "white",
              showNotation: true,
              animationDurationInMs: 180,
              allowDragging: !thinking && !coachThinking && playerTurn && !gameOver,
              canDragPiece: ({ square }) => Boolean(square && renderGame.get(square as Square)?.color === "w"),
              onPieceDrop: ({ sourceSquare, targetSquare }) => Boolean(targetSquare && makePlayerMove(sourceSquare, targetSquare)),
              onSquareClick: ({ square }) => handleSquareClick(square),
              arrows,
              squareStyles,
              lightSquareStyle: { backgroundColor: "#e9edf1" },
              darkSquareStyle: { backgroundColor: "#7d8da8" },
              boardStyle: { borderRadius: "5px", boxShadow: "0 18px 45px rgba(27, 37, 60, .18)" },
              darkSquareNotationStyle: { color: "rgba(255,255,255,.72)", fontSize: 11, fontWeight: 700 },
              lightSquareNotationStyle: { color: "rgba(34,45,68,.56)", fontSize: 11, fontWeight: 700 },
            }} />
          </div>
          <div className={styles.playerStrip}>
            <div><span className={`${styles.miniAvatar} ${styles.youAvatar}`}>Y</span><span><b>You</b><small>White</small></span></div>
            <span className={styles.turnPill}>{!thinking && playerTurn && !gameOver ? "Your turn" : "Waiting"}</span>
          </div>
          <div className={styles.thinkingLine} aria-live="polite">
            <span className={statusTone} />
            <b>{message}</b>
            {lastSearch && <span>{lastSearch.actor} searched {lastSearch.nodes.toLocaleString()} nodes · depth {lastSearch.depth} · {(lastSearch.timeMs / 1000).toFixed(2)}s</span>}
          </div>
        </section>

        <aside className={styles.rightRail}>
          <div className={`${styles.panel} ${styles.coachPanel}`}>
            <div className={styles.coachHeading}>
              <div><span className={styles.eyebrow}>Stockfish coach</span><h2>A second mind, on your side.</h2></div>
              <span className={styles.coachIcon}>SF</span>
            </div>
            <div className={styles.segmented} aria-label="Coach detail level">
              {COACH_LEVELS.map((level) => (
                <button type="button" aria-pressed={coachLevel === level.value} key={level.value} className={coachLevel === level.value ? styles.activeSegment : ""} onClick={() => { setCoachLevel(level.value); setCoachResult(null); }}>
                  {level.label}
                </button>
              ))}
            </div>
            <div className={styles.coachBody} aria-live="polite">
              {coachLevel === "off" ? (
                <div className={styles.emptyCoach}><span>○</span><p>Coach is off. You are reading the board on your own.</p></div>
              ) : coachThinking ? (
                <div className={styles.emptyCoach}><span className={styles.pulse}>···</span><p>Coach is studying the position.</p></div>
              ) : !coachResult ? (
                <div className={styles.emptyCoach}><span>↗</span><p>Ask when you want a nudge. The coach never changes Rival’s move.</p></div>
              ) : coachLevel === "gentle" ? (
                <div className={styles.coachAdvice}><span className={styles.adviceLabel}>A gentle nudge</span><p>{gentleHint(coachResult)}</p></div>
              ) : (
                <div className={styles.coachAdvice}>
                  <span className={styles.adviceLabel}>{coachLevel === "best" ? "Best move" : "Candidate moves"}</span>
                  <div className={styles.candidateList}>
                    {coachResult.candidates.slice(0, coachLevel === "best" ? 1 : 3).map((move, index) => (
                      <span key={`${move.from}-${move.to}`}><i>{index + 1}</i>{move.san}</span>
                    ))}
                  </div>
                  <p><b>{coachResult.candidates[0]?.san}</b> — {coachResult.candidates[0] && explainMove(coachResult.candidates[0])}</p>
                  <div className={styles.coachTelemetry}><span>Evaluation <b>{evaluationLabel(coachResult.candidates[0]?.score)}</b></span><span>Depth <b>{coachResult.depth}</b></span></div>
                </div>
              )}
            </div>
            <button type="button" className={styles.coachButton} disabled={coachLevel === "off" || coachEngineStatus !== "ready" || thinking || coachThinking || !playerTurn || gameOver} onClick={() => void askCoach()}>
              {coachEngineStatus === "loading" ? "Starting Stockfish…" : coachEngineStatus === "error" ? "Coach unavailable" : coachThinking ? "Analyzing…" : "Analyze with Stockfish"}<span>↗</span>
            </button>
            <p className={styles.simCount}>{coachResult ? `${coachResult.nodes.toLocaleString()} nodes · ${coachResult.nps.toLocaleString()} nodes/sec` : `${profile.hintUsage} lifetime hints used`}</p>
          </div>

          <div className={styles.profilePanel}>
            <div><span className={styles.eyebrow}>Your practice</span><b>{profile.wins}–{profile.losses}–{profile.draws}</b></div>
            <div className={styles.levelTrack}><i style={{ width: `${profile.adaptiveLevel * 10}%` }} /></div>
            <p>Adaptive level {profile.adaptiveLevel} of 10</p>
          </div>
          <button type="button" className={styles.newGameButton} onClick={newGame}>New game <span>↻</span></button>
        </aside>
      </section>

      <footer><span>RivalMind · Private practice, stored on this device.</span><span><a href="https://github.com/lichess-org/stockfish.wasm" target="_blank" rel="noreferrer">Stockfish WASM</a> engine · legal moves by chess.js</span></footer>

      {summary && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.summaryCard} role="dialog" aria-modal="true" aria-labelledby="game-summary-title">
            <span className={styles.summaryMark}>{summary.result === "win" ? "✓" : summary.result === "loss" ? "×" : "½"}</span>
            <span className={styles.eyebrow}>Game complete</span>
            <h2 id="game-summary-title">{resultLabel(summary.result)}</h2>
            <div><span>What went well</span><p>{summary.well}</p></div>
            <div><span>Watch next time</span><p>{summary.watch}</p></div>
            <button type="button" onClick={newGame}>Play another game</button>
          </section>
        </div>
      )}
    </main>
  );
}
