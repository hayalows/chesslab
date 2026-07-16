"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { Navii } from "@usenavii/react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { MILESTONES } from "@/lib/training-analytics";
import styles from "./Dashboard.module.css";

type Profile = { display_name: string; avatar_seed: string; rating: number; estimated_strength: number; independent_moves: number; independent_accuracy: number; total_games: number; wins: number; losses: number; draws: number; adaptive_level: number; training_points: number; training_minutes: number; current_streak: number; best_streak: number };
type Game = { id: string; result: string; difficulty: string; opening_name: string | null; completed_at: string; total_time_ms: number; player_think_ms: number; coach_uses: number; coach_time_ms: number; accuracy: number | null; training_points_earned: number };
type Rating = { rating: number; recorded_at: string };
type Stats = { favorite_openings: { name: string; games: number }[]; style_label: string | null; analyzed_games: number; average_accuracy: number | null };
type Achievement = { id: number; name: string; description: string; unlocked_at: string | null };

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setUser(auth.user);
      if (!auth.user) { setLoading(false); return; }
      let guest: Record<string, unknown> = {};
      try { guest = JSON.parse(window.localStorage.getItem("rivalmind-player-profile-v1") || "{}"); } catch { /* Keep a clean cloud profile if guest data is malformed. */ }
      const { data: existing } = await supabase.from("profiles").select("total_games").maybeSingle();
      const guestGames = Number(guest.games) || 0;
      if (!existing || guestGames > existing.total_games) {
        await supabase.from("profiles").upsert({
          user_id: auth.user.id,
          display_name: String(guest.displayName || auth.user.user_metadata?.display_name || auth.user.email?.split("@")[0] || "Chess learner"),
          avatar_seed: String(guest.avatarSeed || auth.user.id),
          total_games: guestGames,
          wins: Number(guest.wins) || 0,
          losses: Number(guest.losses) || 0,
          draws: Number(guest.draws) || 0,
          hint_usage: Number(guest.hintUsage) || 0,
          adaptive_level: Number(guest.adaptiveLevel) || 4,
          training_points: Number(guest.trainingPoints) || 0,
          training_minutes: Number(guest.trainingMinutes) || 0,
          current_streak: Number(guest.currentStreak) || 0,
          best_streak: Number(guest.bestStreak) || 0,
          last_level_change_game: Number(guest.lastLevelChangeGame) || 0,
          milestones: Array.isArray(guest.milestones) ? guest.milestones : [],
          independent_moves: Number(guest.independentMoves) || 0,
          independent_accuracy: Number(guest.independentAccuracy) || 0,
          estimated_strength: Number(guest.estimatedStrength) || 900,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        const guestMilestones = Array.isArray(guest.milestones) ? guest.milestones : [];
        const unlocked = MILESTONES.filter((milestone) => guestMilestones.includes(milestone.code));
        if (unlocked.length) await supabase.from("achievements").upsert(unlocked.map((milestone) => ({ user_id: auth.user!.id, code: milestone.code, name: milestone.title, description: milestone.detail, unlocked_at: new Date().toISOString() })), { onConflict: "user_id,code" });
      }
      const [profileResult, gamesResult, ratingsResult, statsResult, achievementsResult] = await Promise.all([
        supabase.from("profiles").select("display_name,avatar_seed,rating,estimated_strength,independent_moves,independent_accuracy,total_games,wins,losses,draws,adaptive_level,training_points,training_minutes,current_streak,best_streak").single(),
        supabase.from("games").select("id,result,difficulty,opening_name,completed_at,total_time_ms,player_think_ms,coach_uses,coach_time_ms,accuracy,training_points_earned").eq("status", "complete").order("completed_at", { ascending: false }).limit(20),
        supabase.from("rating_history").select("rating,recorded_at").order("recorded_at", { ascending: true }).limit(30),
        supabase.from("player_stats").select("favorite_openings,style_label,analyzed_games,average_accuracy").maybeSingle(),
        supabase.from("achievements").select("id,name,description,unlocked_at").order("unlocked_at", { ascending: false }),
      ]);
      setProfile(profileResult.data as Profile | null);
      setGames((gamesResult.data ?? []) as Game[]);
      setRatings((ratingsResult.data ?? []) as Rating[]);
      setStats(statsResult.data as Stats | null);
      setAchievements((achievementsResult.data ?? []) as Achievement[]);
      setLoading(false);
    })();
  }, []);

  async function saveName() {
    const nextName = nameDraft.trim();
    if (!nextName || !profile) return;
    const supabase = createClient();
    const { error } = await supabase!.from("profiles").update({ display_name: nextName, updated_at: new Date().toISOString() }).eq("user_id", user!.id);
    if (!error) {
      setProfile({ ...profile, display_name: nextName });
      try {
        const saved = JSON.parse(localStorage.getItem("rivalmind-player-profile-v1") || "{}");
        localStorage.setItem("rivalmind-player-profile-v1", JSON.stringify({ ...saved, displayName: nextName }));
      } catch { /* The cloud profile remains the source of truth. */ }
      setEditingName(false);
    }
  }

  if (loading) return <main className={styles.center}>Loading your journey…</main>;
  if (!user) return <main className={styles.center}><h1>Your training lives here.</h1><p>Sign in from the home page to keep games, milestones and learning analytics across devices.</p><Link href="/">Go to RivalMind</Link></main>;
  const maxRating = Math.max(1000, ...ratings.map((point) => point.rating));
  const averageThinkMs = games.length ? games.reduce((sum, game) => sum + Number(game.player_think_ms || 0), 0) / games.length : 0;
  const totalCoachUses = games.reduce((sum, game) => sum + Number(game.coach_uses || 0), 0);
  const noCoachGames = games.filter((game) => Number(game.coach_uses || 0) === 0).length;
  const adaptiveElo = 1350 + ((profile?.adaptive_level ?? 4) - 1) * 120;
  return <main className={styles.shell}>
    <header><Link href="/">← Home</Link><span>My profile</span><nav aria-label="Profile actions"><Link href="/play?mode=game&time=rapid10">Play</Link><Link href="/play?mode=training&time=open">Train</Link><Link href="/play?mode=cup&time=rapid10">Tournament</Link><button type="button" onClick={() => void createClient()?.auth.signOut().then(() => location.assign("/"))}>Sign out</button></nav></header>
    <section className={styles.hero}><div className={styles.profileAvatar}>{profile && <Navii seed={!profile.avatar_seed || profile.avatar_seed === "rivalmind-player" ? user.id : profile.avatar_seed} size={78} title={profile.display_name} animated background="ring" />}</div><div><span>YOUR CHESS JOURNEY</span>{editingName ? <div className={styles.nameEditor}><input autoFocus maxLength={60} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveName(); }} /><button type="button" onClick={() => void saveName()}>Save name</button><button type="button" onClick={() => setEditingName(false)}>Cancel</button></div> : <div className={styles.profileName}><h1>{profile?.display_name || "Chess learner"}</h1><button type="button" onClick={() => { setNameDraft(profile?.display_name || ""); setEditingName(true); }}>Edit name</button></div>}<p>Patterns over pressure. Every game adds one more useful signal.</p></div></section>
    <section className={styles.metrics}><article><span>Estimated strength</span><b>{profile?.estimated_strength ?? 900}</b><small>From {profile?.independent_moves ?? 0} unassisted moves</small></article><article><span>Independent quality</span><b>{profile?.independent_moves ? `${Math.round(profile.independent_accuracy)}%` : "Not measured"}</b><small>Coach-aided moves excluded</small></article><article><span>Adaptive rival</span><b>{profile?.adaptive_level ?? 4}<i>/10</i></b><small>About {adaptiveElo} Stockfish Elo</small></article><article><span>Playing style</span><b className={styles.styleValue}>{stats?.analyzed_games && stats.analyzed_games >= 20 ? stats.style_label || "Balanced builder" : "Still learning"}</b><small>{Math.max(0, 20 - (stats?.analyzed_games ?? games.length))} games until style insight</small></article></section>
    <section className={styles.adaptivePath}><div><span>YOUR CURRENT CHALLENGE</span><h2>Level {profile?.adaptive_level ?? 4} · about {adaptiveElo} Elo</h2><p>RivalMind changes the challenge only when recent results and independent move quality agree. One difficult game never drops your level.</p></div><div className={styles.levelDots}>{Array.from({length:10},(_,index)=><i key={index} data-reached={index < (profile?.adaptive_level ?? 4)} />)}</div></section>
    <section className={styles.grid}>
      <article className={styles.card}><div className={styles.cardTitle}><div><span>Rating trend</span><h2>Progress, not perfection</h2></div><em>{ratings.length || 0} points</em></div>{ratings.length > 1 ? <div className={styles.chart}>{ratings.map((point, index) => <i key={`${point.recorded_at}-${index}`} style={{ height: `${Math.max(12, point.rating / maxRating * 100)}%` }} title={`${point.rating}`} />)}</div> : <div className={styles.empty}>Your rating line appears after synced rated games.</div>}</article>
      <article className={styles.card}><div className={styles.cardTitle}><div><span>Opening intelligence</span><h2>Favorite starting plans</h2></div></div>{stats?.favorite_openings?.length ? <ul>{stats.favorite_openings.slice(0, 4).map((opening) => <li key={opening.name}><b>{opening.name}</b><span>{opening.games} games</span></li>)}</ul> : <div className={styles.empty}>Opening patterns will appear as your library grows.</div>}</article>
      <article className={`${styles.card} ${styles.journey}`}><div className={styles.cardTitle}><div><span>Game story</span><h2>Recent journey</h2></div></div>{games.length ? <ol>{games.map((game) => <li key={game.id}><i data-result={game.result} /><div><b>{game.result === "win" ? "A win" : game.result === "loss" ? "A lesson" : "A balanced draw"}</b><span>{game.opening_name || `${game.difficulty} Rival`} · {new Date(game.completed_at).toLocaleDateString()}</span></div></li>)}</ol> : <div className={styles.empty}>Finish a signed-in game to begin your cloud timeline.</div>}</article>
      <article className={styles.card}><div className={styles.cardTitle}><div><span>Learning engine</span><h2>Your next useful repetition</h2></div></div><div className={styles.learning}><b>Saved-position practice</b><p>Your verified mistakes return as short board exercises instead of disappearing after review.</p><Link href="/practice">Open practice queue →</Link><b>Playing style detector</b><p>After 20 analyzed games, RivalMind describes preferences such as tactical play or late castling. It never guesses early.</p></div></article>
      <article className={`${styles.card} ${styles.analyticsCard}`}><div className={styles.cardTitle}><div><span>Learning analytics</span><h2>How you train</h2></div></div><div className={styles.analyticsGrid}><span>Independent quality<b>{stats?.average_accuracy == null ? "Not measured" : `${Math.round(stats.average_accuracy)}%`}</b><small>Only moves made without the coach</small></span><span>Thinking per game<b>{averageThinkMs ? `${Math.round(averageThinkMs / 60000)} min` : "No games yet"}</b><small>Your active decision time</small></span><span>Coach requests<b>{totalCoachUses}</b><small>{noCoachGames} independent games</small></span><span>Best streak<b>{profile?.best_streak ?? 0}</b><small>Current: {profile?.current_streak ?? 0}</small></span></div></article>
      <article className={`${styles.card} ${styles.milestoneCard}`}><div className={styles.cardTitle}><div><span>Milestones</span><h2>Progress worth noticing</h2></div><em>{achievements.length} earned</em></div>{achievements.length ? <ul>{achievements.slice(0,5).map((item)=><li key={item.id}><div><b>{item.name}</b><span>{item.description}</span></div><em>✓</em></li>)}</ul> : <div className={styles.empty}>Complete your first training game to earn “First step”.</div>}</article>
    </section>
  </main>;
}
