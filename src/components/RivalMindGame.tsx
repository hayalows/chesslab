"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Color, type Square } from "chess.js";
import { Chessboard, type Arrow } from "react-chessboard";
import { Navii } from "@usenavii/react";
import Link from "next/link";
import {
  DIFFICULTY_PRESETS,
  explainMove,
  opponentStrengthLabel,
  RivalEngine,
  RivalAssistant,
} from "@/lib/engine-adapter";
import { buildSnapshot, immediateCheckmates, type ImmediateMate } from "@/lib/assistant-insights";
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
  type MoveDecision,
  type PlayerColor,
  type PlayerSide,
  type PostGameSummary,
  type TimeControl,
  type SessionMode,
  type CustomTimeSettings,
} from "@/lib/game-types";
import { canRevealCoachStep, coachCacheMode, isPlayerTurn } from "@/lib/game-session";
import GameAssistant from "./GameAssistant";
import AuthMenu from "./AuthMenu";
import { loadCloudProfile, syncCompletedGame } from "@/lib/cloud-sync";
import { adaptiveExplanation, adaptiveProgress, advanceProfile, coachRecommendation, formatClock, formatDuration, learningScore, TIME_CONTROLS } from "@/lib/training-analytics";
import { useGameClock } from "@/lib/use-game-clock";
import { createPostGameSummary } from "@/lib/post-game-summary";
import { currentTimeMs, randomPlayerColor, uniqueAvatarSeed } from "@/lib/runtime-values";
import { collectReviewPositions, comparePlayerIdea, confidenceCalibration, mergeReviewPositions, REVIEW_POSITIONS_KEY, weeklyPlan } from "@/lib/learning-loop";
import { recordPersonalMove } from "@/lib/human-plan-model";
import styles from "./RivalMindGame.module.css";

const PROFILE_KEY = "rivalmind-player-profile-v1";
const DIFFICULTIES: Difficulty[] = ["beginner", "easy", "medium", "hard", "expert", "master", "adaptive"];
const TIME_OPTIONS: TimeControl[] = ["open", "blitz5", "rapid10", "steady15", "custom"];
const RATED_DIFFICULTIES: Exclude<Difficulty, "adaptive">[] = ["beginner", "easy", "medium", "hard", "expert", "master"];
const SIDE_OPTIONS: { value: PlayerSide; label: string; detail: string }[] = [
  { value: "white", label: "White", detail: "You make the first move" },
  { value: "black", label: "Black", detail: "Practice responding" },
  { value: "random", label: "Surprise me", detail: "RivalMind chooses" },
];
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

function coachPositionGuidance(result: SearchResult, immediateMateCount = 0) {
  const best = result.candidates[0];
  const score = best?.score;
  if (score === undefined) return "Stockfish is still forming its view of the position.";
  if (best?.mate !== undefined && best.mate < 0) return `Stockfish sees a forced mate against you in ${Math.abs(best.mate)}. The coach can show the longest defense, but no move guarantees recovery.`;
  if (immediateMateCount > 1) return `Checkmate is available now. There are ${immediateMateCount} legal ways to finish immediately, and Stockfish is showing one of them.`;
  if (best?.mate === 1) return "Checkmate is available now. Stockfish has verified that the shown move ends the game immediately.";
  if (best?.mate !== undefined && best.mate > 0) return `Stockfish has verified mate in ${best.mate}. Follow the shown line carefully. Only the first move is guaranteed to keep that mate.`;
  if (score <= -300) return "Recovery mode: you are clearly worse, so the coach is finding the move that preserves the best practical chances.";
  if (score <= -100) return "You are under pressure, but the game is still playable. The top move limits further damage.";
  if (score >= 300) return "You have a winning advantage. The priority now is converting it without giving counterplay.";
  return "The game is still competitive. This move gives Stockfish’s best balance of safety and activity.";
}

function MateAlternatives({ mates, stockfishUci }: { mates: ImmediateMate[]; stockfishUci?: string }) {
  if (mates.length < 2) return null;
  const ordered = [...mates].sort((a, b) => Number(b.uci === stockfishUci) - Number(a.uci === stockfishUci));
  return (
    <details className={styles.mateAlternatives}>
      <summary>See all {mates.length} immediate checkmates</summary>
      <div>
        {ordered.map((move) => <span key={move.uci} data-stockfish={move.uci === stockfishUci}><b>{move.san}</b>{move.uci === stockfishUci ? "Stockfish choice" : "Also checkmate"}</span>)}
      </div>
      <p>Every move listed is legal and ends the game now. Stockfish chooses one first, but the others are equally final.</p>
    </details>
  );
}

function evaluationLabel(score: number | undefined, mate?: number) {
  if (score === undefined) return "Not ready";
  if (mate !== undefined) return mate > 0 ? `Mate in ${Math.abs(mate)}` : `Mate against you in ${Math.abs(mate)}`;
  if (Math.abs(score) > 90_000) return score > 0 ? "Forced mate found" : "Forced mate against you";
  const pawns = score / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function decisionLabel(source: MoveDecision["source"]) {
  if (source === "independent") return "Your own move";
  if (source === "coach-followed") return "Used a coach move";
  if (source === "coach-diverged") return "Asked, then chose differently";
  return "Used a gentle hint";
}

function decisionEffect(delta?: number) {
  if (delta === undefined) return "Analysis still completing";
  if (delta >= -20) return "Kept your position steady";
  if (delta <= -5_000) return "Changed the game decisively";
  return `Cost about ${Math.abs(delta / 100).toFixed(2)} pawns`;
}

function coachUsageLabel(uses: number, timeMs: number) {
  if (!uses) return "Not used";
  return timeMs >= 1_000 ? `${uses} request${uses === 1 ? "" : "s"} · ${formatDuration(timeMs)}` : `${uses} request${uses === 1 ? "" : "s"}`;
}

function nextTournamentDifficulty(difficulty: Difficulty) {
  if (difficulty === "adaptive") return difficulty;
  return RATED_DIFFICULTIES[Math.min(RATED_DIFFICULTIES.length - 1, RATED_DIFFICULTIES.indexOf(difficulty) + 1)];
}

export default function RivalMindGame({ timeControl: initialTimeControl = "open", sessionMode: initialSessionMode = "training", customTime: initialCustomTime = { minutes: 20, incrementSeconds: 5 } }: { timeControl?: TimeControl; sessionMode?: SessionMode; customTime?: CustomTimeSettings }) {
  const gameRef = useRef(new Chess());
  const opponentRef = useRef<RivalEngine | null>(null);
  const assistantRef = useRef<RivalAssistant | null>(null);
  const assistantRequestRef = useRef(0);
  const coachRequestRef = useRef(0);
  const lastAssistantScoreRef = useRef<number | undefined>(undefined);
  const gameVersionRef = useRef(0);
  const gameFinishedRef = useRef(false);
  const gameStartedAtRef = useRef(0);
  const playerTurnStartedAtRef = useRef(0);
  const playerThinkMsRef = useRef(0);
  const rivalThinkMsRef = useRef(0);
  const coachTimeMsRef = useRef(0);
  const sessionStartedRef = useRef(false);
  const setupPausedAtRef = useRef<number | null>(null);
  const setupOriginRef = useRef<{
    sessionMode: SessionMode;
    timeControl: TimeControl;
    difficulty: Difficulty;
    sideChoice: PlayerSide;
    customMinutes: number;
    customIncrement: number;
  } | null>(null);
  const assistantTimelineRef = useRef<AssistantSnapshot[]>([]);
  const decisionsRef = useRef<MoveDecision[]>([]);
  const consultationRef = useRef<{ ply: number; coachLevel: CoachLevel; shownMoves: string[]; shownSans: string[]; playerIdea?: string } | null>(null);
  const [fen, setFen] = useState(() => new Chess().fen());
  const [timeControl, setTimeControl] = useState<TimeControl>(initialTimeControl);
  const [customMinutes, setCustomMinutes] = useState(initialCustomTime.minutes);
  const [customIncrement, setCustomIncrement] = useState(initialCustomTime.incrementSeconds);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [sideChoice, setSideChoice] = useState<PlayerSide>("white");
  const [playerColor, setPlayerColor] = useState<PlayerColor>("w");
  const [gameActive, setGameActive] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [sessionMode, setSessionMode] = useState<SessionMode>(initialSessionMode);
  const [cupRound, setCupRound] = useState(1);
  const [cupScore, setCupScore] = useState(0);
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
  const [decisions, setDecisions] = useState<MoveDecision[]>([]);
  const [promotionChoice, setPromotionChoice] = useState<{ from: string; to: string } | null>(null);
  const [hintsThisGame, setHintsThisGame] = useState(0);
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0);
  const [coachElapsedMs, setCoachElapsedMs] = useState(0);
  const [coachRevealStep, setCoachRevealStep] = useState(1);
  const [playerIdea, setPlayerIdea] = useState("");
  const [moveConfidence, setMoveConfidence] = useState<"unsure" | "considered" | "confident">("considered");
  const [reviewPositionCount, setReviewPositionCount] = useState(0);

  useEffect(() => {
    opponentRef.current = new RivalEngine((status, name) => {
      setRivalEngineStatus(status);
      setEngineName(name);
    });
    const assistant = new RivalAssistant((status) => { setAssistantEngineStatus(status); setCoachEngineStatus(status); });
    assistantRef.current = assistant;
    const startFen = new Chess().fen();
    void assistant.analyze(startFen).then((result) => {
      const snapshot = buildSnapshot({ ply: 0, fen: startFen, actor: "Start", result });
      lastAssistantScoreRef.current = snapshot.whiteScore;
      setLatestAssistant(snapshot);
      setAssistantTimeline([snapshot]);
      assistantTimelineRef.current = [snapshot];
    }).catch(() => undefined);
    let savedProfile: PlayerProfile | null = null;
    let savedReviewCount = 0;
    try {
      const saved = window.localStorage.getItem(PROFILE_KEY);
      if (saved) savedProfile = { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
      const reviews = JSON.parse(window.localStorage.getItem(REVIEW_POSITIONS_KEY) || "[]");
      savedReviewCount = Array.isArray(reviews) ? reviews.filter((item: { solved?: boolean }) => !item.solved).length : 0;
    } catch {
      // A blocked or malformed local profile should never stop a game.
    }
    const profileToRestore = savedProfile;
    queueMicrotask(() => {
      if (profileToRestore) setProfile(profileToRestore);
      else setProfile({ ...DEFAULT_PROFILE, avatarSeed: uniqueAvatarSeed() });
      setReviewPositionCount(savedReviewCount);
      setProfileReady(true);
    });
    void loadCloudProfile().then((cloudProfile) => {
      if (cloudProfile) setProfile((current) => cloudProfile.games >= current.games ? cloudProfile : { ...current, displayName: cloudProfile.displayName, avatarSeed: cloudProfile.avatarSeed });
    });
    return () => {
      opponentRef.current?.dispose();
      assistantRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile, profileReady]);

  useEffect(() => {
    if (summary || !gameActive || setupOpen) return;
    const interval = window.setInterval(() => setSessionElapsedMs(currentTimeMs() - gameStartedAtRef.current), 1000);
    return () => window.clearInterval(interval);
  }, [gameActive, setupOpen, summary]);

  const accountForSetupPause = useCallback(() => {
    const pausedAt = setupPausedAtRef.current;
    if (pausedAt === null) return;
    const now = currentTimeMs();
    gameStartedAtRef.current += Math.max(0, now - pausedAt);
    if (gameRef.current.turn() === playerColor) {
      const pausedPlayerTime = Math.max(0, now - Math.max(pausedAt, playerTurnStartedAtRef.current));
      playerTurnStartedAtRef.current += pausedPlayerTime;
    }
    setupPausedAtRef.current = null;
  }, [playerColor]);

  function finishGame(forcedResult?: GameResult) {
    if (gameFinishedRef.current) return;
    accountForSetupPause();
    setupOriginRef.current = null;
    setSetupOpen(false);
    gameFinishedRef.current = true;
    setGameFinished(true);
    const game = gameRef.current;
    if (forcedResult && game.turn() === playerColor) playerThinkMsRef.current += currentTimeMs() - playerTurnStartedAtRef.current;
    const result: GameResult = forcedResult ?? (game.isCheckmate() ? (game.turn() === playerColor ? "loss" : "win") : "draw");
    const gameDecisions = decisionsRef.current;
    const timeline = assistantTimelineRef.current;
    const reviewedDecisions = gameDecisions.map((decision) => {
      const snapshot = timeline.find((item) => item.ply === decision.ply);
      return { ...decision, delta: snapshot?.delta, severity: snapshot?.severity };
    });
    const learning = learningScore(timeline, gameDecisions);
    const baseTelemetry = {
      timeControl,
      totalTimeMs: currentTimeMs() - gameStartedAtRef.current,
      playerThinkMs: playerThinkMsRef.current,
      rivalThinkMs: rivalThinkMsRef.current,
      coachUses: hintsThisGame,
      coachTimeMs: coachTimeMsRef.current,
      ...learning,
      adaptiveBefore: profile.adaptiveLevel,
    };
    const advanced = advanceProfile(profile, result, baseTelemetry);
    const telemetry: GameTelemetry = { ...baseTelemetry, adaptiveAfter: advanced.profile.adaptiveLevel, trainingPointsEarned: advanced.points };
    const gameSummary = createPostGameSummary({ game, result, endedOnTime: Boolean(forcedResult), telemetry, timeline, decisions: reviewedDecisions, playerColor, newMilestones: advanced.newMilestones });
    try {
      const existing = JSON.parse(window.localStorage.getItem(REVIEW_POSITIONS_KEY) || "[]");
      const saved = mergeReviewPositions(Array.isArray(existing) ? existing : [], collectReviewPositions(timeline, reviewedDecisions, playerColor));
      window.localStorage.setItem(REVIEW_POSITIONS_KEY, JSON.stringify(saved));
      setReviewPositionCount(saved.filter((item) => !item.solved).length);
    } catch { /* A blocked local store must never prevent the result screen. */ }
    setProfile(advanced.profile);
    if (sessionMode === "cup") setCupScore((score) => score + (result === "win" ? 3 : result === "draw" ? 1 : 0));
    setSummary(gameSummary);
    setMessage(forcedResult ? `${resultLabel(result)} on time` : resultLabel(result));
    void syncCompletedGame({ game, difficulty, profile: advanced.profile, summary: gameSummary, timeline, assistantEnabled, playerColor }).catch(() => setMessage(`${resultLabel(result)} · Saved on this device; cloud sync will retry later.`));
  }

  const renderGame = useMemo(() => new Chess(fen), [fen]);
  const gameOver = renderGame.isGameOver() || gameFinished;
  const playerTurn = isPlayerTurn(renderGame.turn(), playerColor);
  const customTime = useMemo(() => ({ minutes: customMinutes, incrementSeconds: customIncrement }), [customMinutes, customIncrement]);
  const activeTimeLabel = timeControl === "custom" ? `${customMinutes} + ${customIncrement}` : TIME_CONTROLS[timeControl].label;
  const clock = useGameClock(timeControl, renderGame.turn(), gameActive && !setupOpen && rivalEngineStatus === "ready" && profileReady && !gameOver, (color) => finishGame(color === playerColor ? "loss" : "win"), customTime);
  const resetClock = clock.reset;
  const rivalColor: Color = playerColor === "w" ? "b" : "w";
  const playerClock = playerColor === "w" ? clock.whiteMs : clock.blackMs;
  const rivalClock = rivalColor === "w" ? clock.whiteMs : clock.blackMs;
  const statusTone = thinking || coachThinking ? styles.thinkingDot : gameOver ? styles.doneDot : styles.readyDot;

  useEffect(() => {
    if (!gameActive || sessionStartedRef.current || rivalEngineStatus !== "ready" || !profileReady) return;
    sessionStartedRef.current = true;
    const now = currentTimeMs();
    gameStartedAtRef.current = now;
    playerTurnStartedAtRef.current = now;
    resetClock();
  }, [gameActive, profileReady, resetClock, rivalEngineStatus]);

  const legalTargets = useMemo(() => {
    if (!selectedSquare) return [];
    try {
      return renderGame.moves({ square: selectedSquare as Square, verbose: true }).map((move) => move.to);
    } catch {
      return [];
    }
  }, [renderGame, selectedSquare]);

  const arrows = useMemo<Arrow[]>(() => {
    if (!coachResult || coachLevel === "off" || (coachLevel === "gentle" && coachRevealStep < 4)) return [];
    const moves = coachLevel === "best" || (coachLevel === "gentle" && coachRevealStep >= 5) ? coachResult.candidates.slice(0, 1) : coachResult.candidates.slice(0, 3);
    return moves.map((move, index) => ({
      startSquare: move.from,
      endSquare: move.to,
      color: index === 0 ? "rgba(66, 86, 143, .84)" : "rgba(66, 86, 143, .42)",
    }));
  }, [coachLevel, coachResult, coachRevealStep]);

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

  async function updateAssistant(position: string, actor: AssistantSnapshot["actor"], move: string | undefined, ply: number, force = false, analysisPlayerColor = playerColor) {
    if (!assistantEnabled && !force) return;
    const version = gameVersionRef.current;
    const request = ++assistantRequestRef.current;
    setAssistantThinking(true);
    try {
      const result = await assistantRef.current?.analyze(position);
      if (!result || version !== gameVersionRef.current) return;
      const snapshot = buildSnapshot({ ply, fen: position, actor, move, result, previousWhiteScore: lastAssistantScoreRef.current, playerColor: analysisPlayerColor });
      lastAssistantScoreRef.current = snapshot.whiteScore;
      const nextTimeline = [...assistantTimelineRef.current.filter((item) => item.ply !== ply), snapshot].sort((a, b) => a.ply - b.ply);
      assistantTimelineRef.current = nextTimeline;
      setAssistantTimeline(nextTimeline);
      if (request === assistantRequestRef.current && gameRef.current.fen() === position) setLatestAssistant(snapshot);
    } finally {
      if (version === gameVersionRef.current && request === assistantRequestRef.current) setAssistantThinking(false);
    }
  }

  async function requestRivalMove(position: string, activePlayerColor = playerColor, activeDifficulty = difficulty, liveAssistant = assistantEnabled) {
    const version = gameVersionRef.current;
    const rivalStartedAt = currentTimeMs();
    setThinking(true);
    setMessage("Rival is choosing a move…");
    try {
      const engine = opponentRef.current;
      if (!engine) throw new Error("Engine is still starting");
      const result = await engine.chooseMove(position, activeDifficulty, profile);
      if (version !== gameVersionRef.current || gameFinishedRef.current) return;
      rivalThinkMsRef.current += currentTimeMs() - rivalStartedAt;
      const rivalColor = activePlayerColor === "w" ? "b" : "w";
      gameRef.current.move({ from: result.move.from, to: result.move.to, promotion: result.move.promotion ?? "q" });
      clock.addIncrement(rivalColor);
      const rivalSan = gameRef.current.history().at(-1);
      setFen(gameRef.current.fen());
      setMoveHistory(gameRef.current.history());
      setLastMove({ from: result.move.from, to: result.move.to });
      setLastSearch({ actor: "Rival", nodes: result.nodes, depth: result.depth, timeMs: result.timeMs, engine: result.engine });
      setMessage(gameRef.current.isCheck() ? "Your king is in check." : "Your move.");
      playerTurnStartedAtRef.current = currentTimeMs();
      const finalPosition = gameRef.current.fen();
      const analysis = updateAssistant(finalPosition, "Rival", rivalSan, gameRef.current.history().length, gameRef.current.isGameOver() || liveAssistant, activePlayerColor);
      if (gameRef.current.isGameOver()) void analysis.finally(() => finishGame());
    } catch {
      if (version === gameVersionRef.current) setMessage("Stockfish could not finish that search. Reload the page to restart the engine.");
    } finally {
      if (version === gameVersionRef.current) setThinking(false);
    }
  }

  function makePlayerMove(from: string, to: string, promotion?: "q" | "r" | "b" | "n") {
    if (thinking || coachThinking || gameRef.current.turn() !== playerColor || gameRef.current.isGameOver()) return false;
    const piece = gameRef.current.get(from as Square);
    const promotionRank = playerColor === "w" ? "8" : "1";
    if (piece?.type === "p" && to.endsWith(promotionRank) && !promotion) {
      setPromotionChoice({ from, to });
      setMessage("Choose the piece for your pawn promotion.");
      return false;
    }
    const positionBeforeMove = gameRef.current.fen();
    try {
      const move = gameRef.current.move({ from, to, promotion });
      if (!move) return false;
      playerThinkMsRef.current += currentTimeMs() - playerTurnStartedAtRef.current;
      clock.addIncrement(playerColor);
      const consultation = consultationRef.current?.ply === gameRef.current.history().length ? consultationRef.current : null;
      const uci = `${from}${to}${move.promotion ?? ""}`;
      recordPersonalMove(positionBeforeMove, uci);
      const source = !consultation ? "independent"
        : consultation.coachLevel === "gentle" ? "coach-guided"
          : consultation.shownMoves.includes(uci) ? "coach-followed" : "coach-diverged";
      const decision: MoveDecision = {
        ply: gameRef.current.history().length,
        move: move.san,
        uci,
        source,
        coachLevel: consultation?.coachLevel,
        suggestedMoves: consultation?.shownSans ?? [],
        playerIdea: consultation?.playerIdea,
        confidence: moveConfidence,
      };
      decisionsRef.current = [...decisionsRef.current, decision];
      setDecisions(decisionsRef.current);
      consultationRef.current = null;
      const nextFen = gameRef.current.fen();
      setFen(nextFen);
      setMoveHistory(gameRef.current.history());
      setLastMove({ from, to });
      setSelectedSquare(null);
      setPromotionChoice(null);
      setCoachResult(null);
      setCoachRevealStep(1);
      setPlayerIdea("");
      setMoveConfidence("considered");
      const analysis = updateAssistant(nextFen, "You", move.san, gameRef.current.history().length, gameRef.current.isGameOver());
      if (gameRef.current.isGameOver()) void analysis.finally(() => finishGame());
      else { void analysis; void requestRivalMove(nextFen); }
      return true;
    } catch {
      setMessage("That move is not legal in this position.");
      return false;
    }
  }

  function handleSquareClick(square: string) {
    if (selectedSquare === square) {
      setSelectedSquare(null);
      setMessage(`Selection cleared. Choose one of your ${playerColor === "w" ? "White" : "Black"} pieces.`);
      return;
    }
    if (selectedSquare && makePlayerMove(selectedSquare, square)) return;
    const piece = gameRef.current.get(square as Square);
    if (piece?.color === playerColor) {
      setSelectedSquare(square);
      setMessage(`Selected ${square}. Choose a highlighted square.`);
    } else {
      setSelectedSquare(null);
      setMessage(`Choose one of your ${playerColor === "w" ? "White" : "Black"} pieces first.`);
    }
  }

  async function askCoach() {
    if (coachLevel === "off" || thinking || coachThinking || !isPlayerTurn(gameRef.current.turn(), playerColor) || gameRef.current.isGameOver()) return;
    const version = gameVersionRef.current;
    const request = ++coachRequestRef.current;
    const position = gameRef.current.fen();
    const idea = playerIdea.trim() || undefined;
    const cached = assistantRef.current?.peek(position, coachCacheMode(coachLevel));
    const registerConsultation = (result: SearchResult) => {
      const visibleCandidates = coachLevel === "gentle" ? [] : result.candidates.slice(0, coachLevel === "best" ? 1 : 3);
      const mates = coachLevel === "gentle" ? [] : immediateCheckmates(position);
      const shownMoves = mates.length > 1 ? mates : visibleCandidates;
      consultationRef.current = {
        ply: gameRef.current.history().length + 1,
        coachLevel,
        shownMoves: shownMoves.map((move) => move.uci),
        shownSans: shownMoves.map((move) => move.san),
        playerIdea: idea,
      };
    };
    setCoachThinking(true);
    setCoachRevealStep(1);
    if (cached) { setCoachResult(cached); registerConsultation(cached); }
    else setCoachResult(null);
    setHintsThisGame((count) => count + 1);
    setProfile((current) => ({ ...current, hintUsage: current.hintUsage + 1 }));
    try {
      const result = await assistantRef.current?.analyze(position, "deep");
      if (!result || version !== gameVersionRef.current || request !== coachRequestRef.current || gameRef.current.fen() !== position) return;
      setCoachResult(result);
      registerConsultation(result);
      setLastSearch({ actor: "Coach", nodes: result.nodes, depth: result.depth, timeMs: result.timeMs, engine: result.engine });
      coachTimeMsRef.current += result.cached ? 0 : result.timeMs;
      setCoachElapsedMs(coachTimeMsRef.current);
    } catch {
      setMessage("The Stockfish coach is unavailable. Reload the page to restart it.");
    } finally {
      if (request === coachRequestRef.current) setCoachThinking(false);
    }
  }

  function revealNextCoachStep() {
    if (!coachResult || coachLevel !== "gentle" || !canRevealCoachStep(coachRevealStep, coachThinking)) return;
    const next = Math.min(5, coachRevealStep + 1);
    setCoachRevealStep(next);
    if (next >= 4 && consultationRef.current) {
      const mates = next >= 5 ? immediateCheckmates(gameRef.current.fen()) : [];
      const shownMoves = mates.length > 1 ? mates : coachResult.candidates.slice(0, 3);
      consultationRef.current = {
        ...consultationRef.current,
        shownMoves: shownMoves.map((move) => move.uci),
        shownSans: shownMoves.map((move) => move.san),
      };
    }
  }

  function resetGameState(activePlayerColor: PlayerColor) {
    gameVersionRef.current += 1;
    gameFinishedRef.current = false;
    setGameFinished(false);
    gameRef.current = new Chess();
    setFen(gameRef.current.fen());
    setThinking(false);
    setCoachThinking(false);
    setCoachResult(null);
    setCoachRevealStep(1);
    setPlayerIdea("");
    setMoveConfidence("considered");
    assistantRequestRef.current += 1;
    coachRequestRef.current += 1;
    setLastSearch(null);
    setLastMove(null);
    setMoveHistory([]);
    setSelectedSquare(null);
    setHintsThisGame(0);
    setSummary(null);
    decisionsRef.current = [];
    setDecisions([]);
    consultationRef.current = null;
    setPromotionChoice(null);
    setSessionElapsedMs(0);
    gameStartedAtRef.current = currentTimeMs();
    playerTurnStartedAtRef.current = currentTimeMs();
    playerThinkMsRef.current = 0;
    rivalThinkMsRef.current = 0;
    coachTimeMsRef.current = 0;
    setCoachElapsedMs(0);
    sessionStartedRef.current = false;
    clock.reset();
    lastAssistantScoreRef.current = undefined;
    setLatestAssistant(null);
    setAssistantTimeline([]);
    assistantTimelineRef.current = [];
    setMessage(activePlayerColor === "w" ? "Your move. You are playing White." : "Rival opens. You are playing Black.");
  }

  function beginConfiguredGame(activeDifficulty = difficulty, liveHelp = assistantEnabled) {
    const activePlayerColor: PlayerColor = sideChoice === "random" ? randomPlayerColor() : sideChoice === "white" ? "w" : "b";
    setPlayerColor(activePlayerColor);
    resetGameState(activePlayerColor);
    setupOriginRef.current = null;
    setupPausedAtRef.current = null;
    setSetupOpen(false);
    setGameActive(true);
    if (liveHelp) void updateAssistant(gameRef.current.fen(), "Start", undefined, 0, true, activePlayerColor);
    if (activePlayerColor === "b") {
      window.setTimeout(() => void requestRivalMove(gameRef.current.fen(), activePlayerColor, activeDifficulty, liveHelp), 0);
    }
  }

  function startConfiguredGame() {
    if (sessionMode === "cup") { setCupRound(1); setCupScore(0); }
    const liveHelp = sessionMode === "training";
    setAssistantEnabled(true);
    setCoachLevel(liveHelp ? "gentle" : "off");
    beginConfiguredGame(difficulty, true);
  }

  function continueTournament() {
    const nextDifficulty = nextTournamentDifficulty(difficulty);
    setCupRound((round) => Math.min(3, round + 1));
    setDifficulty(nextDifficulty);
    beginConfiguredGame(nextDifficulty, true);
  }

  function startTournamentFromSummary() {
    setSessionMode("cup");
    setCupRound(1);
    setCupScore(0);
    setCoachLevel("off");
    setAssistantEnabled(true);
    beginConfiguredGame(difficulty, true);
  }

  function openGameSetup() {
    if (summary) {
      setSummary(null);
      setGameActive(false);
      setupOriginRef.current = null;
      setupPausedAtRef.current = null;
      setSetupOpen(true);
      return;
    }
    if (gameActive && !gameOver && !setupOriginRef.current) {
      setupOriginRef.current = { sessionMode, timeControl, difficulty, sideChoice, customMinutes, customIncrement };
      setupPausedAtRef.current = currentTimeMs();
    }
    setSetupOpen(true);
  }

  const closeGameSetup = useCallback(() => {
    if (!gameActive || gameOver) return;
    const origin = setupOriginRef.current;
    if (origin) {
      setSessionMode(origin.sessionMode);
      setTimeControl(origin.timeControl);
      setDifficulty(origin.difficulty);
      setSideChoice(origin.sideChoice);
      setCustomMinutes(origin.customMinutes);
      setCustomIncrement(origin.customIncrement);
    }
    accountForSetupPause();
    setupOriginRef.current = null;
    setSetupOpen(false);
  }, [accountForSetupPause, gameActive, gameOver]);

  useEffect(() => {
    if (!setupOpen || !gameActive || gameOver) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGameSetup();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeGameSetup, gameActive, gameOver, setupOpen]);

  const coachBest = coachResult?.candidates[0];
  const immediateMates = useMemo(() => coachResult ? immediateCheckmates(fen) : [], [coachResult, fen]);
  const ideaComparison = coachResult ? comparePlayerIdea(playerIdea, coachResult, immediateMates) : null;
  const coachPiece = coachBest ? renderGame.get(coachBest.from as Square)?.type : undefined;
  const coachPieceName = coachPiece ? ({ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" } as const)[coachPiece] : "piece";
  const trainingPlan = weeklyPlan(profile, reviewPositionCount);
  const summaryCalibration = summary ? confidenceCalibration(summary.decisions) : null;
  const hasResumableGame = gameActive && !gameOver && !summary;

  return (
    <main className={`${styles.shell} ${sessionMode === "training" ? "" : styles.focusedMode}`}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="RivalMind home">
          <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
          RivalMind
        </Link>
        <p>{gameActive ? `${activeTimeLabel} · You play ${playerColor === "w" ? "White" : "Black"}` : "Choose how you want to play"}</p>
        <div className={styles.headerActions}>
          <nav aria-label="Game navigation">
            <Link href="/">Home</Link>
            <Link href="/dashboard">My training</Link>
            <button type="button" onClick={openGameSetup}>New game</button>
          </nav>
          <AuthMenu />
        </div>
      </header>

      <section className={styles.workspace} id="top">
        <aside className={styles.leftRail}>
          <div className={styles.panel}>
            <span className={styles.eyebrow}>Opponent</span>
            <div className={styles.opponentRow}>
              <span className={styles.naviiAvatar}><Navii seed="rivalmind-stockfish" size={40} title="Rival" mood="serious" background="ring" /></span>
              <div><h2>Rival</h2><p>Powered by Stockfish</p></div>
              <span className={rivalEngineStatus === "ready" ? styles.onlineDot : rivalEngineStatus === "error" ? styles.engineErrorDot : styles.thinkingDot} aria-label={`Engine ${rivalEngineStatus}`} />
            </div>
            <div className={styles.engineStatus} data-status={rivalEngineStatus}>
              <span className={styles.engineGlyph}>SF</span>
              <span><b>{engineName}</b><small>{rivalEngineStatus === "ready" ? "Engine online · every reply verified" : rivalEngineStatus === "error" ? "Engine unavailable · reload to retry" : "Loading the chess engine…"}</small></span>
            </div>
            <label className={styles.fieldLabel} htmlFor="difficulty">Difficulty</label>
            <select id="difficulty" value={difficulty} disabled={gameActive} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
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
              <select id="mobile-difficulty" value={difficulty} disabled={gameActive} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
                {DIFFICULTIES.map((level) => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
              </select>
            </label>
            <button type="button" disabled={coachLevel === "off" || coachEngineStatus !== "ready" || thinking || coachThinking || !playerTurn || gameOver} onClick={() => void askCoach()}>
              {coachThinking ? "Thinking…" : "Ask coach"}
            </button>
          </div>
          <div className={styles.playerStrip}>
            <div><span className={styles.miniAvatar}>SF</span><span><b>Rival</b><small>{rivalColor === "w" ? "White" : "Black"} · Stockfish {difficulty}</small></span></div>
            <div className={styles.stripActions}>
              <span className={`${styles.clock} ${!playerTurn && !gameOver ? styles.activeClock : ""}`}>{formatClock(rivalClock)}</span>
              <button className={styles.inlineNewGame} type="button" onClick={openGameSetup} aria-label="Set up a new game" title="Set up a new game">↻</button>
            </div>
          </div>
          <div className={styles.boardFrame}>
            {moveHistory.length === 0 && !thinking && (
              <div className={styles.startGuide} aria-hidden="true">
                <b>You are {playerColor === "w" ? "White" : "Black"}</b>
                <span>Drag a piece, or tap it then tap a highlighted square.</span>
              </div>
            )}
            <Chessboard options={{
              id: "rivalmind-board",
              position: fen,
              boardOrientation: playerColor === "w" ? "white" : "black",
              showNotation: true,
              animationDurationInMs: 180,
              allowDragging: !thinking && !coachThinking && playerTurn && !gameOver,
              canDragPiece: ({ square }) => Boolean(square && renderGame.get(square as Square)?.color === playerColor),
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
            <div><span className={styles.naviiMini}><Navii seed={profile.avatarSeed} size={29} title={profile.displayName} background="ring" /></span><span><b>{profile.displayName}</b><small>{playerColor === "w" ? "White" : "Black"}</small></span></div>
            <span className={`${styles.clock} ${playerTurn && !gameOver ? styles.activeClock : ""}`}>{formatClock(playerClock)}</span>
          </div>
          <div className={styles.thinkingLine} aria-live="polite">
            <span className={statusTone} />
            <b>{message}</b>
            <span>{formatDuration(sessionElapsedMs)} in this game{lastSearch ? ` · ${lastSearch.actor} checked ${lastSearch.nodes.toLocaleString()} positions` : ""}</span>
          </div>
          <div className={styles.confidenceBar} aria-label="Move confidence">
            <span>Before you move, how sure are you?</span>
            <div>{([['unsure','Unsure'],['considered','Thinking it through'],['confident','Confident']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={moveConfidence === value} onClick={() => setMoveConfidence(value)} disabled={!playerTurn || gameOver}>{label}</button>)}</div>
          </div>
        </section>

        <aside className={styles.rightRail}>
          {sessionMode !== "training" && <div className={`${styles.panel} ${styles.focusedNotice}`}><span className={styles.eyebrow}>{sessionMode === "cup" ? `Tournament · Round ${cupRound}` : "Focused game"}</span><h2>Live help is off.</h2><p>Play from your own ideas. RivalMind is quietly recording the game so your review is ready when it ends.</p><button type="button" onClick={openGameSetup}>Change mode</button></div>}
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
            {coachLevel !== "off" && !coachResult && <label className={styles.thinkFirst}><span>Your idea first <i>optional</i></span><input value={playerIdea} onChange={(event) => setPlayerIdea(event.target.value)} placeholder="For example, Nf3" maxLength={12} /><small>RivalMind compares your idea with Stockfish instead of replacing your thinking.</small></label>}
            <div className={styles.coachBody} aria-live="polite">
              {coachLevel === "off" ? (
                <div className={styles.emptyCoach}><span>○</span><p>No hints. You are solving the position on your own.</p></div>
              ) : coachThinking && !coachResult ? (
                <div className={styles.emptyCoach}><span className={styles.pulse}>···</span><p>Checking the best plans in this position…</p></div>
              ) : !coachResult ? (
                <div className={styles.emptyCoach}><span>↗</span><p>Ask for help only when you want it. Your opponent stays separate.</p></div>
              ) : coachLevel === "gentle" ? (
                <div className={styles.coachAdvice}>
                  <p className={styles.coachPosition}>{coachPositionGuidance(coachResult, immediateMates.length)}</p>
                  <span className={styles.adviceLabel}>Clue {coachRevealStep} of 5</span>
                  {coachRevealStep === 1 && <p>Start by naming what changed on the last move and which side has the more urgent problem.</p>}
                  {coachRevealStep === 2 && <p>{gentleHint(coachResult)}</p>}
                  {coachRevealStep === 3 && <p>Look closely at your <b>{coachPieceName}</b>. Stockfish’s leading line starts by improving or using that piece.</p>}
                  {coachRevealStep === 4 && <div className={styles.candidateList}>{coachResult.candidates.slice(0, 3).map((move,index)=><span key={move.uci}><i>{index + 1}</i>{move.san}</span>)}</div>}
                  {coachRevealStep === 5 && <><p><b>{coachBest?.san}</b>{immediateMates.length > 1 ? " is one of the legal moves that ends the game now." : `. ${coachBest ? explainMove(coachBest) : ""}`}</p><MateAlternatives mates={immediateMates} stockfishUci={coachBest?.uci} /><div className={styles.coachTelemetry}><span>Your outlook <b>{evaluationLabel(coachBest?.score, coachBest?.mate)}</b></span><span>Search depth <b>{coachResult.depth} half-moves</b></span></div></>}
                  {coachRevealStep < 5 && <button type="button" className={styles.revealButton} disabled={!canRevealCoachStep(coachRevealStep, coachThinking)} onClick={revealNextCoachStep}>{coachThinking && coachRevealStep >= 3 ? "Finishing Stockfish search…" : coachRevealStep === 4 ? "Reveal Stockfish’s choice" : "Show the next clue"}</button>}
                </div>
              ) : (
                <div className={styles.coachAdvice}>
                  <p className={styles.coachPosition}>{coachPositionGuidance(coachResult, immediateMates.length)}</p>
                  <span className={styles.adviceLabel}>{immediateMates.length > 1 ? `${immediateMates.length} checkmates` : coachLevel === "best" ? "Best move" : "Candidate moves"}</span>
                  <div className={styles.candidateList}>
                    {coachResult.candidates.slice(0, coachLevel === "best" ? 1 : 3).map((move, index) => (
                      <span key={`${move.from}-${move.to}`}><i>{index + 1}</i>{move.san}</span>
                    ))}
                  </div>
                  <p><b>{coachResult.candidates[0]?.san}</b>{immediateMates.length > 1 ? " is Stockfish's choice, but it is not the only checkmate." : `. ${coachResult.candidates[0] ? explainMove(coachResult.candidates[0]) : ""}`}</p>
                  <MateAlternatives mates={immediateMates} stockfishUci={coachBest?.uci} />
                  <div className={styles.coachTelemetry}><span>Your outlook <b>{evaluationLabel(coachResult.candidates[0]?.score, coachResult.candidates[0]?.mate)}</b></span><span>Search depth <b>{coachResult.depth} half-moves</b></span></div>
                  <details className={styles.coachExplainer}><summary>What do these numbers mean?</summary><p><b>+1.00</b> is roughly a one-pawn advantage for you. <b>Depth 16</b> means the engine completed a main search about 16 half-moves ahead, while also checking many deeper tactical branches. A mate count is shown only when Stockfish returns a forced mate line.</p></details>
                </div>
              )}
              {ideaComparison && <div className={styles.ideaComparison} data-tone={ideaComparison.tone}><span>Why not my move?</span><p>{ideaComparison.text}</p></div>}
              {coachThinking && coachResult && <p className={styles.refining}>Fast answer shown · Stockfish is refining it…</p>}
            </div>
            <button type="button" className={styles.coachButton} disabled={coachLevel === "off" || coachEngineStatus !== "ready" || thinking || coachThinking || !playerTurn || gameOver} onClick={() => void askCoach()}>
              {coachEngineStatus === "loading" ? "Getting the coach ready…" : coachEngineStatus === "error" ? "Coach unavailable" : coachThinking ? "Refining the answer…" : "Help me with this position"}<span>↗</span>
            </button>
            <p className={styles.simCount}>{coachResult ? `${coachResult.nodes.toLocaleString()} positions checked · ${(coachElapsedMs / 1000).toFixed(1)}s coach time this game` : `${hintsThisGame} coach uses this game · ${profile.hintUsage} all time`}</p>
          </div>

          <div className={styles.profilePanel}>
            <div><span className={styles.eyebrow}>Training path</span><b>{profile.trainingPoints.toLocaleString()} pts</b></div>
            <div className={styles.levelTrack}><i style={{ width: `${adaptiveProgress(profile)}%` }} /></div>
            <p>Adaptive level {profile.adaptiveLevel} · {adaptiveProgress(profile)}% recent-form progress</p>
            <small>{adaptiveExplanation(profile)} Current target: {opponentStrengthLabel("adaptive", profile)}.</small>
            <p className={styles.coachGoal}><b>Coach fade-out goal</b>{coachRecommendation(profile)}</p>
            <details className={styles.weeklyPlan}><summary>This week’s plan</summary>{trainingPlan.map((item,index)=><p key={item}><b>{index + 1}</b>{item}</p>)}</details>
            <Link className={styles.practiceLink} href="/practice">Practice saved positions <span>{reviewPositionCount}</span></Link>
          </div>
          <button type="button" className={styles.newGameButton} onClick={openGameSetup}>Set up new game <span>↻</span></button>
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
          decisions={decisions}
          playerColor={playerColor}
        />
      </div>

      <footer><span>RivalMind · Guest-first with secure cloud sync.</span><span><a href="https://github.com/lichess-org/stockfish.wasm" target="_blank" rel="noreferrer">Stockfish WASM</a> engine · legal moves by chess.js</span></footer>

      {setupOpen && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (hasResumableGame && event.target === event.currentTarget) closeGameSetup(); }}>
          <section className={styles.setupCard} role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-description">
            <div className={styles.setupNav}>{hasResumableGame ? <button type="button" onClick={closeGameSetup}>Resume game</button> : <Link href="/">Back to home</Link>}<span>{hasResumableGame ? "Current game paused" : "Game setup"}</span></div>
            <div className={styles.setupScroll}>
            <div className={styles.setupHeading}><h2 id="setup-title">{hasResumableGame ? "Start a different game?" : "Choose your game"}</h2><p id="setup-description">{hasResumableGame ? "Your current position and clocks are safe. Resume it, or choose a new setup below." : "Pick a mode, your color, a clock, and Rival strength."}</p></div>
            <div className={styles.setupIdentity}><span className={styles.naviiAvatar}><Navii seed={profile.avatarSeed} size={40} title={profile.displayName} background="ring" /></span><label htmlFor="training-name"><b>Your training name</b><input id="training-name" maxLength={60} value={profile.displayName} onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))} /></label><button type="button" onClick={() => setProfile((current) => ({ ...current, avatarSeed: uniqueAvatarSeed() }))}>New icon</button></div>
            <fieldset className={styles.setupSection}><legend>Experience</legend><div className={styles.sessionChoices}>
              <button type="button" aria-pressed={sessionMode === "game"} onClick={() => setSessionMode("game")}><b>Play</b><span>No coach during play. Full review after.</span></button>
              <button type="button" aria-pressed={sessionMode === "training"} onClick={() => setSessionMode("training")}><b>Train</b><span>Optional coach and live explanations.</span></button>
              <button type="button" aria-pressed={sessionMode === "cup"} onClick={() => setSessionMode("cup")}><b>Tournament</b><span>Three games. Rival gets stronger each round.</span></button>
            </div><p className={styles.modeNote}>{sessionMode === "training" ? "Live learning is on. You decide how much help to reveal." : sessionMode === "cup" ? "Tournament games hide live assistance. Each round still receives a full review." : "This feels like a real game. The coach and live assistant stay off until your review."}</p></fieldset>
            <fieldset className={styles.setupSection}><legend>Your side</legend><div className={styles.choiceGrid}>{SIDE_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={sideChoice === option.value} onClick={() => setSideChoice(option.value)}><b>{option.label}</b><span>{option.detail}</span></button>)}</div></fieldset>
            <fieldset className={styles.setupSection}><legend>Time</legend><div className={styles.timeGrid}>{TIME_OPTIONS.map((option) => <button type="button" key={option} aria-pressed={timeControl === option} onClick={() => setTimeControl(option)}><b>{TIME_CONTROLS[option].short}</b><span>{TIME_CONTROLS[option].label}</span></button>)}</div></fieldset>
            {timeControl === "custom" && <div className={styles.customTimeFields}><label htmlFor="custom-minutes"><span>Minutes per player</span><input id="custom-minutes" type="number" min="1" max="180" value={customMinutes} onChange={(event) => setCustomMinutes(Math.max(1, Math.min(180, Number(event.target.value) || 1)))} /></label><label htmlFor="custom-increment"><span>Increment after each move</span><div><input id="custom-increment" type="number" min="0" max="60" value={customIncrement} onChange={(event) => setCustomIncrement(Math.max(0, Math.min(60, Number(event.target.value) || 0)))} /><small>seconds</small></div></label></div>}
            <label className={styles.setupField} htmlFor="setup-difficulty"><span>Rival strength</span><select id="setup-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>{DIFFICULTIES.map((level) => <option key={level} value={level}>{level === "adaptive" ? `Adaptive · current level ${profile.adaptiveLevel}` : `${level[0].toUpperCase() + level.slice(1)} · ${DIFFICULTY_PRESETS[level].elo} Elo`}</option>)}</select><small>{difficulty === "adaptive" ? "Uses your unassisted move quality and recent results to choose the next challenge." : DIFFICULTY_PRESETS[difficulty].description}</small></label>
            </div>
            <div className={styles.setupFooter}>
              <div className={styles.setupSummary}><span><small>Mode</small><b>{sessionMode === "cup" ? "Tournament" : sessionMode === "training" ? "Training" : "Play"}</b></span><span><small>Clock</small><b>{activeTimeLabel}</b></span><span><small>Side</small><b>{sideChoice === "random" ? "Random" : sideChoice}</b></span><span><small>Rival</small><b>{difficulty}</b></span></div>
              <button className={styles.startGameButton} type="button" disabled={rivalEngineStatus !== "ready" || !profileReady || !profile.displayName.trim()} onClick={startConfiguredGame}>{rivalEngineStatus !== "ready" ? "Getting Stockfish ready…" : hasResumableGame ? sessionMode === "cup" ? "Replace game and start tournament" : sessionMode === "training" ? "Replace game and start training" : "Replace game and start" : sessionMode === "cup" ? "Start tournament" : sessionMode === "training" ? "Start training" : "Start game"}</button>
            </div>
          </section>
        </div>
      )}

      {promotionChoice && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.promotionCard} role="dialog" aria-modal="true" aria-labelledby="promotion-title">
            <span className={styles.eyebrow}>Pawn promotion</span><h2 id="promotion-title">Choose your new piece.</h2><p>Queen is strongest most often, but a rook, bishop, or knight can be the precise choice.</p>
            <div>{([['q','♛','Queen'],['r','♜','Rook'],['b','♝','Bishop'],['n','♞','Knight']] as const).map(([piece, icon, label]) => <button type="button" key={piece} onClick={() => makePlayerMove(promotionChoice.from, promotionChoice.to, piece)}><span>{icon}</span><b>{label}</b></button>)}</div>
            <button className={styles.cancelPromotion} type="button" onClick={() => setPromotionChoice(null)}>Cancel</button>
          </section>
        </div>
      )}

      {summary && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.summaryCard} role="dialog" aria-modal="true" aria-labelledby="game-summary-title">
            <div className={styles.summaryTopNav}><Link href="/">Back to home</Link><span>Game review</span></div>
            <div className={`${styles.outcomeHero} ${summary.result === "win" ? styles.outcomeWin : summary.result === "loss" ? styles.outcomeLoss : styles.outcomeDraw}`}>
              <div><span className={styles.outcomeBadge}>{summary.result}</span><h2 id="game-summary-title">{summary.outcomeTitle}</h2><p>{summary.outcomeDetail}</p></div>
              <div className={styles.scoreline}><span>You</span><b>{summary.scoreline}</b><span>Rival</span></div>
            </div>
            <div className={styles.summaryIntro}><span className={styles.eyebrow}>{sessionMode === "cup" ? `Tournament round ${cupRound} complete` : sessionMode === "training" ? "Training complete" : "Game complete"} <b>+{summary.telemetry.trainingPointsEarned} points</b></span><p>{summary.headline}</p></div>
            <div className={styles.nextStepCard}>
              <div><span>Choose your next step</span><p>{sessionMode === "cup" && cupRound < 3 ? "Continue your tournament, or switch to another way to learn." : "Keep your setup, enter a tournament, or review the positions that mattered."}</p></div>
              <div className={styles.nextStepActions}>
                <button type="button" onClick={sessionMode === "cup" && cupRound < 3 ? continueTournament : startConfiguredGame}>{sessionMode === "cup" && cupRound < 3 ? `Play round ${cupRound + 1}` : sessionMode === "cup" ? "Restart tournament" : "Play again"}</button>
                {sessionMode !== "cup" && <button type="button" className={styles.secondaryAction} onClick={startTournamentFromSummary}>Start tournament</button>}
                <button type="button" className={styles.secondaryAction} onClick={openGameSetup}>Change game</button>
              </div>
              <div className={styles.nextStepLinks}><Link href="/practice">Practice key positions</Link><Link href="/dashboard">View my training</Link></div>
            </div>
            <div className={styles.reviewStats}>
              <span>Time spent<b>{formatDuration(summary.telemetry.totalTimeMs)}</b></span>
              <span>Your thinking<b>{formatDuration(summary.telemetry.playerThinkMs)}</b></span>
              <span>Coach used<b>{coachUsageLabel(summary.telemetry.coachUses, summary.telemetry.coachTimeMs)}</b></span>
              <span>Move quality<b>{summary.telemetry.analyzedMoves ? `${summary.telemetry.accuracy}%` : "Not scored"}</b></span>
            </div>
            <div className={styles.lessonHighlights}><div className={styles.reviewLesson}><span>What went well</span><p>{summary.well}</p></div><div className={styles.reviewLesson}><span>Key moment</span><p>{summary.keyMoment}</p></div><div className={styles.reviewLesson}><span>Try next game</span><p>{summary.watch}</p></div></div>
            <details className={styles.summaryDetails}>
              <summary><span><b>Full learning analysis</b><small>Strength, coach use, and every move</small></span><i>Open</i></summary>
              <div className={styles.summaryDetailsBody}>
                <div className={styles.independenceReview}>
                  <div><span>Your real-strength signal</span><b>{summary.telemetry.independentMoves ? `${summary.telemetry.independentAccuracy}%` : "Not enough moves"}</b><p>Based only on {summary.telemetry.independentMoves} moves you chose without opening the coach.</p></div>
                  <div><span>Coach relationship</span><b>{summary.telemetry.coachFollowedMoves} followed, {summary.telemetry.coachDivergedMoves} declined</b><p>Gentle hints used: {summary.telemetry.coachGuidedMoves}. These moves stay visible, but do not inflate your independent score.</p></div>
                  <div><span>Decision confidence</span><b>{summaryCalibration?.label}</b><p>{summaryCalibration?.detail}</p></div>
                  <div><span>Review queue</span><b>{reviewPositionCount} positions</b><p>Your largest verified mistakes return as short practice exercises.</p></div>
                </div>
                {sessionMode === "cup" && <div className={styles.cupReview}><span>Training Cup, round {cupRound} of 3</span><b>{cupScore} points</b><p>Win = 3, draw = 1. Each round raises Rival one strength step.</p></div>}
                {summary.decisions.length > 0 && <details className={styles.decisionReview}><summary><b>Your decision trail</b><span>{summary.decisions.length} moves</span></summary><div>{summary.decisions.map((decision) => <article key={decision.ply} data-source={decision.source}><span>{Math.ceil(decision.ply / 2)}.</span><div><b>{decision.move}</b><small>{decisionLabel(decision.source)}{decision.playerIdea ? `. Your idea: ${decision.playerIdea}` : ""}{decision.suggestedMoves.length ? `. Coach showed ${decision.suggestedMoves.join(", ")}` : ""}{decision.confidence ? `. Felt ${decision.confidence}` : ""}</small></div><em>{decisionEffect(decision.delta)}</em></article>)}</div></details>}
                <div className={styles.adaptiveReview}><span>Adaptive rival</span><b>Level {summary.telemetry.adaptiveBefore} to {summary.telemetry.adaptiveAfter}</b><p>{summary.telemetry.adaptiveAfter > summary.telemetry.adaptiveBefore ? "Your recent form earned a stronger challenge." : summary.telemetry.adaptiveAfter < summary.telemetry.adaptiveBefore ? "The next game will give you more room to learn." : "One game never changes your level. RivalMind waits for a clear recent pattern."}</p></div>
                {summary.newMilestones.length > 0 && <div className={styles.milestoneEarned}><span>Milestone unlocked</span><b>{summary.newMilestones.join(", ")}</b></div>}
              </div>
            </details>
          </section>
        </div>
      )}
    </main>
  );
}
