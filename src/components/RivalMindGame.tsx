"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard, type Arrow } from "react-chessboard";
import Link from "next/link";
import {
  DIFFICULTY_PRESETS,
  explainMove,
  opponentStrengthLabel,
  RivalCoach,
  RivalEngine,
  RivalAssistant,
} from "@/lib/engine-adapter";
import { buildSnapshot } from "@/lib/assistant-insights";
import {
  DEFAULT_PROFILE,
  type CoachLevel,
  type Difficulty,
  type EngineStatus,
  type GameResult,
  type PlayerProfile,
  type SearchResult,
  type AssistantSnapshot,
  type GameTelemetry,
  type PostGameSummary,
  type TimeControl,
} from "@/lib/game-types";
import GameAssistant from "./GameAssistant";
import AuthMenu from "./AuthMenu";
import { loadCloudProfile, syncCompletedGame } from "@/lib/cloud-sync";
import { adaptiveProgress, advanceProfile, formatClock, formatDuration, learningScore, TIME_CONTROLS } from "@/lib/training-analytics";
import { useGameClock } from "@/lib/use-game-clock";
import { createPostGameSummary } from "@/lib/post-game-summary";
import styles from "./RivalMindGame.module.css";

const PROFILE_KEY = "rivalmind-player-profile-v1";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "adaptive"];
const COACH_LEVELS: { value: CoachLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "gentle", label: "Small hint" },
  { value: "candidates", label: "3 ideas" },
  { value: "best", label: "Show move" },
];

function resultLabel(result: GameResult) {
  return result === "win" ? "You won" : result === "loss" ? "Rival won" : "Draw";
}

function gentleHint(result: SearchResult) {
  const move = result.candidates[0];
  if (!move) return "Take a breath and scan every check, capture, and threat.";
  if (move.captured) return "There is a forcing capture worth calculating before you make a quiet move.";
  if (move.san.includes("+")) return "A check can improve your position with tempo here.";
  if (["d4", "d5", "e4", "e5"].includes(move.to)) return "The center is asking for more attention. Look for a move that increases your influence there.";
  return "One of your pieces can become more active without creating a new weakness.";
}

function coachPositionGuidance(result: SearchResult) {
  const score = result.candidates[0]?.score;
  if (score === undefined) return "Stockfish is still forming its view of the position.";
  if (score < -90_000) return "Stockfish sees a forced mate against you. The coach can explain the line, but no move guarantees recovery.";
  if (score <= -300) return "Recovery mode: you are clearly worse, so the coach is finding the move that preserves the best practical chances.";
  if (score <= -100) return "You are under pressure, but the game is still playable. The top move limits further damage.";
  if (score >= 300) return "You have a winning advantage. The priority now is converting it without giving counterplay.";
  return "The game is still competitive. This move gives Stockfish’s best balance of safety and activity.";
}

function evaluationLabel(score: number | undefined) {
  if (score === undefined) return "—";
  if (Math.abs(score) > 90_000) return score > 0 ? "Winning mate" : "Mate threat";
  const pawns = score / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export default function RivalMindGame({ timeControl = "open" }: { timeControl?: TimeControl }) {
  const gameRef = useRef(new Chess());
  const opponentRef = useRef<RivalEngine | null>(null);
  const coachRef = useRef<RivalCoach | null>(null);
  const assistantRef = useRef<RivalAssistant | null>(null);
  const lastAssistantScoreRef = useRef<number | undefined>(undefined);
  const gameVersionRef = useRef(0);
  const gameFinishedRef = useRef(false);
  const gameStartedAtRef = useRef(Date.now());
  const playerTurnStartedAtRef = useRef(Date.now());
  const playerThinkMsRef = useRef(0);
  const rivalThinkMsRef = useRef(0);
  const coachTimeMsRef = useRef(0);
  const sessionStartedRef = useRef(false);
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
  const [assistantEngineStatus, setAssistantEngineStatus] = useState<EngineStatus>("loading");
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [assistantTimeline, setAssistantTimeline] = useState<AssistantSnapshot[]>([]);
  const [latestAssistant, setLatestAssistant] = useState<AssistantSnapshot | null>(null);
  const [engineName, setEngineName] = useState("Stockfish WASM");
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [message, setMessage] = useState("Your move. You are playing White.");
  const [summary, setSummary] = useState<PostGameSummary | null>(null);
  const [hintsThisGame, setHintsThisGame] = useState(0);
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0);

  useEffect(() => {
    opponentRef.current = new RivalEngine((status, name) => {
      setRivalEngineStatus(status);
      setEngineName(name);
    });
    coachRef.current = new RivalCoach((status) => setCoachEngineStatus(status));
    const assistant = new RivalAssistant((status) => setAssistantEngineStatus(status));
    assistantRef.current = assistant;
    const startFen = new Chess().fen();
    void assistant.analyze(startFen).then((result) => {
      const snapshot = buildSnapshot({ ply: 0, fen: startFen, actor: "Start", result });
      lastAssistantScoreRef.current = snapshot.whiteScore;
      setLatestAssistant(snapshot);
      setAssistantTimeline([snapshot]);
    }).catch(() => undefined);
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
    void loadCloudProfile().then((cloudProfile) => {
      if (cloudProfile) setProfile((current) => cloudProfile.games > current.games ? cloudProfile : current);
    });
    return () => {
      opponentRef.current?.dispose();
      coachRef.current?.dispose();
      assistantRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile, profileReady]);

  useEffect(() => {
    if (summary) return;
    const interval = window.setInterval(() => setSessionElapsedMs(Date.now() - gameStartedAtRef.current), 1000);
    return () => window.clearInterval(interval);
  }, [summary]);

  const renderGame = useMemo(() => new Chess(fen), [fen]);
  const gameOver = renderGame.isGameOver() || gameFinishedRef.current;
  const playerTurn = renderGame.turn() === "w";
  const clock = useGameClock(timeControl, renderGame.turn(), rivalEngineStatus === "ready" && profileReady && !gameOver, (color) => finishGame(color === "w" ? "loss" : "win"));
  const resetClock = clock.reset;
  const statusTone = thinking || coachThinking ? styles.thinkingDot : gameOver ? styles.doneDot : styles.readyDot;

  useEffect(() => {
    if (sessionStartedRef.current || rivalEngineStatus !== "ready" || !profileReady) return;
    sessionStartedRef.current = true;
    const now = Date.now();
    gameStartedAtRef.current = now;
    playerTurnStartedAtRef.current = now;
    resetClock();
  }, [profileReady, resetClock, rivalEngineStatus]);

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

  function finishGame(forcedResult?: GameResult) {
    if (gameFinishedRef.current) return;
    gameFinishedRef.current = true;
    const game = gameRef.current;
    if (forcedResult && game.turn() === "w") playerThinkMsRef.current += Date.now() - playerTurnStartedAtRef.current;
    const result: GameResult = forcedResult ?? (game.isCheckmate() ? (game.turn() === "b" ? "win" : "loss") : "draw");
    const learning = learningScore(assistantTimeline);
    const baseTelemetry = {
      timeControl,
      totalTimeMs: Date.now() - gameStartedAtRef.current,
      playerThinkMs: playerThinkMsRef.current,
      rivalThinkMs: rivalThinkMsRef.current,
      coachUses: hintsThisGame,
      coachTimeMs: coachTimeMsRef.current,
      ...learning,
      adaptiveBefore: profile.adaptiveLevel,
    };
    const advanced = advanceProfile(profile, result, baseTelemetry);
    const telemetry: GameTelemetry = { ...baseTelemetry, adaptiveAfter: advanced.profile.adaptiveLevel, trainingPointsEarned: advanced.points };
    const gameSummary = createPostGameSummary({ game, result, endedOnTime: Boolean(forcedResult), telemetry, timeline: assistantTimeline, newMilestones: advanced.newMilestones });
    setProfile(advanced.profile);
    setSummary(gameSummary);
    setMessage(forcedResult ? `${resultLabel(result)} on time` : resultLabel(result));
    void syncCompletedGame({ game, difficulty, profile: advanced.profile, summary: gameSummary, timeline: assistantTimeline, assistantEnabled }).catch(() => setMessage(`${resultLabel(result)} · Saved on this device; cloud sync will retry later.`));
  }

  async function updateAssistant(position: string, actor: AssistantSnapshot["actor"], move: string | undefined, ply: number, force = false) {
    if (!assistantEnabled && !force) return;
    const version = gameVersionRef.current;
    setAssistantThinking(true);
    try {
      const result = await assistantRef.current?.analyze(position);
      if (!result || version !== gameVersionRef.current) return;
      const snapshot = buildSnapshot({ ply, fen: position, actor, move, result, previousWhiteScore: lastAssistantScoreRef.current });
      lastAssistantScoreRef.current = snapshot.whiteScore;
      setLatestAssistant(snapshot);
      setAssistantTimeline((items) => [...items.filter((item) => item.ply !== ply), snapshot].sort((a, b) => a.ply - b.ply));
    } finally {
      if (version === gameVersionRef.current) setAssistantThinking(false);
    }
  }

  async function requestRivalMove(position: string) {
    const version = gameVersionRef.current;
    const rivalStartedAt = Date.now();
    setThinking(true);
    setMessage("Rival is choosing a move…");
    try {
      const engine = opponentRef.current;
      if (!engine) throw new Error("Engine is still starting");
      const result = await engine.chooseMove(position, difficulty, profile);
      if (version !== gameVersionRef.current || gameFinishedRef.current) return;
      rivalThinkMsRef.current += Date.now() - rivalStartedAt;
      gameRef.current.move({ from: result.move.from, to: result.move.to, promotion: result.move.promotion ?? "q" });
      clock.addIncrement("b");
      const rivalSan = gameRef.current.history().at(-1);
      setFen(gameRef.current.fen());
      setMoveHistory(gameRef.current.history());
      setLastMove({ from: result.move.from, to: result.move.to });
      setLastSearch({ actor: "Rival", nodes: result.nodes, depth: result.depth, timeMs: result.timeMs, engine: result.engine });
      setMessage(gameRef.current.isCheck() ? "Your king is in check." : "Your move.");
      playerTurnStartedAtRef.current = Date.now();
      void updateAssistant(gameRef.current.fen(), "Rival", rivalSan, gameRef.current.history().length);
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
      playerThinkMsRef.current += Date.now() - playerTurnStartedAtRef.current;
      clock.addIncrement("w");
      const nextFen = gameRef.current.fen();
      setFen(nextFen);
      setMoveHistory(gameRef.current.history());
      setLastMove({ from, to });
      setSelectedSquare(null);
      setCoachResult(null);
      void updateAssistant(nextFen, "You", move.san, gameRef.current.history().length);
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
      coachTimeMsRef.current += result.timeMs;
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
    setSessionElapsedMs(0);
    gameStartedAtRef.current = Date.now();
    playerTurnStartedAtRef.current = Date.now();
    playerThinkMsRef.current = 0;
    rivalThinkMsRef.current = 0;
    coachTimeMsRef.current = 0;
    sessionStartedRef.current = true;
    clock.reset();
    lastAssistantScoreRef.current = undefined;
    setLatestAssistant(null);
    setAssistantTimeline([]);
    setMessage("Your move. You are playing White.");
    if (assistantEnabled) void updateAssistant(gameRef.current.fen(), "Start", undefined, 0);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="RivalMind home">
          <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
          RivalMind
        </Link>
        <p>{TIME_CONTROLS[timeControl].label} · Training board</p>
        <div className={styles.headerStats} aria-label="Player record">
          <span><b>{profile.games}</b> games</span>
          <span><b>{profile.wins}</b> wins</span>
          <span>Level <b>{profile.adaptiveLevel}</b></span>
          <AuthMenu />
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
                ? `Level ${profile.adaptiveLevel} changes only when your recent form is clear. ${adaptiveProgress(profile)}% toward a stronger challenge.`
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
              <span className={`${styles.clock} ${!playerTurn && !gameOver ? styles.activeClock : ""}`}>{formatClock(clock.blackMs)}</span>
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
            <span className={`${styles.clock} ${playerTurn && !gameOver ? styles.activeClock : ""}`}>{formatClock(clock.whiteMs)}</span>
          </div>
          <div className={styles.thinkingLine} aria-live="polite">
            <span className={statusTone} />
            <b>{message}</b>
            <span>{formatDuration(sessionElapsedMs)} in this game{lastSearch ? ` · ${lastSearch.actor} checked ${lastSearch.nodes.toLocaleString()} positions` : ""}</span>
          </div>
        </section>

        <aside className={styles.rightRail}>
          <div className={`${styles.panel} ${styles.coachPanel}`}>
            <div className={styles.coachHeading}>
              <div><span className={styles.eyebrow}>Optional coach</span><h2>How much help would you like?</h2></div>
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
                <div className={styles.emptyCoach}><span>○</span><p>No hints. You are solving the position on your own.</p></div>
              ) : coachThinking ? (
                <div className={styles.emptyCoach}><span className={styles.pulse}>···</span><p>Checking the best plans in this position…</p></div>
              ) : !coachResult ? (
                <div className={styles.emptyCoach}><span>↗</span><p>Ask for help only when you want it. Your opponent stays separate.</p></div>
              ) : coachLevel === "gentle" ? (
                <div className={styles.coachAdvice}><p className={styles.coachPosition}>{coachPositionGuidance(coachResult)}</p><span className={styles.adviceLabel}>A gentle nudge</span><p>{gentleHint(coachResult)}</p></div>
              ) : (
                <div className={styles.coachAdvice}>
                  <p className={styles.coachPosition}>{coachPositionGuidance(coachResult)}</p>
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
              {coachEngineStatus === "loading" ? "Getting the coach ready…" : coachEngineStatus === "error" ? "Coach unavailable" : coachThinking ? "Looking for ideas…" : "Help me with this position"}<span>↗</span>
            </button>
            <p className={styles.simCount}>{coachResult ? `${coachResult.nodes.toLocaleString()} positions checked · ${(coachTimeMsRef.current / 1000).toFixed(1)}s coach time this game` : `${hintsThisGame} coach uses this game · ${profile.hintUsage} all time`}</p>
          </div>

          <div className={styles.profilePanel}>
            <div><span className={styles.eyebrow}>Training path</span><b>{profile.trainingPoints.toLocaleString()} pts</b></div>
            <div className={styles.levelTrack}><i style={{ width: `${adaptiveProgress(profile)}%` }} /></div>
            <p>Adaptive level {profile.adaptiveLevel} · {adaptiveProgress(profile)}% recent-form progress</p>
            <small>{profile.games < 4 ? `${4 - profile.games} more games before strength can adjust` : `Current rival target: ${opponentStrengthLabel("adaptive", profile)}`}</small>
          </div>
          <button type="button" className={styles.newGameButton} onClick={newGame}>New game <span>↻</span></button>
        </aside>
      </section>

      <div className={styles.assistantDock}>
        <GameAssistant
          enabled={assistantEnabled}
          onToggle={() => {
            const next = !assistantEnabled;
            setAssistantEnabled(next);
            if (next) void updateAssistant(gameRef.current.fen(), moveHistory.length ? (gameRef.current.turn() === "w" ? "Rival" : "You") : "Start", moveHistory.at(-1), moveHistory.length, true);
          }}
          status={assistantEngineStatus}
          thinking={assistantThinking}
          latest={latestAssistant}
          timeline={assistantTimeline}
        />
      </div>

      <footer><span>RivalMind · Guest-first with secure cloud sync.</span><span><a href="https://github.com/lichess-org/stockfish.wasm" target="_blank" rel="noreferrer">Stockfish WASM</a> engine · legal moves by chess.js</span></footer>

      {summary && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.summaryCard} role="dialog" aria-modal="true" aria-labelledby="game-summary-title">
            <div className={`${styles.outcomeHero} ${summary.result === "win" ? styles.outcomeWin : summary.result === "loss" ? styles.outcomeLoss : styles.outcomeDraw}`}>
              <div><span className={styles.outcomeBadge}>{summary.result}</span><h2 id="game-summary-title">{summary.outcomeTitle}</h2><p>{summary.outcomeDetail}</p></div>
              <div className={styles.scoreline}><span>You</span><b>{summary.scoreline}</b><span>Rival</span></div>
            </div>
            <div className={styles.summaryIntro}><span className={styles.eyebrow}>Training complete · +{summary.telemetry.trainingPointsEarned} points</span><p>{summary.headline}</p></div>
            <div className={styles.reviewStats}>
              <span>Time spent<b>{formatDuration(summary.telemetry.totalTimeMs)}</b></span>
              <span>Your thinking<b>{formatDuration(summary.telemetry.playerThinkMs)}</b></span>
              <span>Coach used<b>{summary.telemetry.coachUses}× · {formatDuration(summary.telemetry.coachTimeMs)}</b></span>
              <span>Move quality<b>{summary.telemetry.analyzedMoves ? `${summary.telemetry.accuracy}%` : "Not scored"}</b></span>
            </div>
            <div className={styles.reviewLesson}><span>What went well</span><p>{summary.well}</p></div>
            <div className={styles.reviewLesson}><span>Key moment</span><p>{summary.keyMoment}</p></div>
            <div className={styles.reviewLesson}><span>Try next game</span><p>{summary.watch}</p></div>
            <div className={styles.adaptiveReview}><span>Adaptive rival</span><b>Level {summary.telemetry.adaptiveBefore} → {summary.telemetry.adaptiveAfter}</b><p>{summary.telemetry.adaptiveAfter > summary.telemetry.adaptiveBefore ? "Your recent form earned a stronger challenge." : summary.telemetry.adaptiveAfter < summary.telemetry.adaptiveBefore ? "The next game will give you more room to learn." : "One game never changes your level. RivalMind waits for a clear recent pattern."}</p></div>
            {summary.newMilestones.length > 0 && <div className={styles.milestoneEarned}><span>Milestone unlocked</span><b>{summary.newMilestones.join(" · ")}</b></div>}
            <div className={styles.reviewActions}><button type="button" onClick={newGame}>Play again</button><Link href="/dashboard">See my training</Link></div>
          </section>
        </div>
      )}
    </main>
  );
}
