"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import styles from "./Dashboard.module.css";

type Profile = { display_name: string; rating: number; total_games: number; wins: number; losses: number; draws: number; adaptive_level: number };
type Game = { id: string; result: string; difficulty: string; opening_name: string | null; completed_at: string };
type Rating = { rating: number; recorded_at: string };
type Stats = { favorite_openings: { name: string; games: number }[]; style_label: string | null; analyzed_games: number; average_accuracy: number | null };

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

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
          display_name: auth.user.user_metadata?.full_name || auth.user.email?.split("@")[0] || "Chess learner",
          total_games: guestGames,
          wins: Number(guest.wins) || 0,
          losses: Number(guest.losses) || 0,
          draws: Number(guest.draws) || 0,
          hint_usage: Number(guest.hintUsage) || 0,
          adaptive_level: Number(guest.adaptiveLevel) || 4,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      }
      const [profileResult, gamesResult, ratingsResult, statsResult] = await Promise.all([
        supabase.from("profiles").select("display_name,rating,total_games,wins,losses,draws,adaptive_level").single(),
        supabase.from("games").select("id,result,difficulty,opening_name,completed_at").eq("status", "complete").order("completed_at", { ascending: false }).limit(12),
        supabase.from("rating_history").select("rating,recorded_at").order("recorded_at", { ascending: true }).limit(30),
        supabase.from("player_stats").select("favorite_openings,style_label,analyzed_games,average_accuracy").maybeSingle(),
      ]);
      setProfile(profileResult.data as Profile | null);
      setGames((gamesResult.data ?? []) as Game[]);
      setRatings((ratingsResult.data ?? []) as Rating[]);
      setStats(statsResult.data as Stats | null);
      setLoading(false);
    })();
  }, []);

  if (loading) return <main className={styles.center}>Loading your journey…</main>;
  if (!user) return <main className={styles.center}><h1>Your journey is ready.</h1><p>Sign in from the game to sync progress across devices.</p><Link href="/">Back to the board</Link></main>;
  const maxRating = Math.max(1000, ...ratings.map((point) => point.rating));
  return <main className={styles.shell}>
    <header><Link href="/">← Board</Link><span>RivalMind</span><button type="button" onClick={() => void createClient()?.auth.signOut().then(() => location.assign("/"))}>Sign out</button></header>
    <section className={styles.hero}><span>YOUR CHESS JOURNEY</span><h1>{profile?.display_name || "Chess learner"}</h1><p>Patterns over pressure. Every game adds one more useful signal.</p></section>
    <section className={styles.metrics}><article><span>Cloud rating</span><b>{profile?.rating ?? 800}</b><small>Starting point</small></article><article><span>Games synced</span><b>{profile?.total_games ?? games.length}</b><small>{profile?.wins ?? 0} wins · {profile?.draws ?? 0} draws</small></article><article><span>Adaptive level</span><b>{profile?.adaptive_level ?? 4}<i>/10</i></b><small>Changes with recent results</small></article><article><span>Playing style</span><b className={styles.styleValue}>{stats?.analyzed_games && stats.analyzed_games >= 20 ? stats.style_label || "Balanced" : "Still learning"}</b><small>{Math.max(0, 20 - (stats?.analyzed_games ?? games.length))} games until style insight</small></article></section>
    <section className={styles.grid}>
      <article className={styles.card}><div className={styles.cardTitle}><div><span>Rating trend</span><h2>Progress, not perfection</h2></div><em>{ratings.length || 0} points</em></div>{ratings.length > 1 ? <div className={styles.chart}>{ratings.map((point, index) => <i key={`${point.recorded_at}-${index}`} style={{ height: `${Math.max(12, point.rating / maxRating * 100)}%` }} title={`${point.rating}`} />)}</div> : <div className={styles.empty}>Your rating line appears after synced rated games.</div>}</article>
      <article className={styles.card}><div className={styles.cardTitle}><div><span>Opening intelligence</span><h2>Favorite starting plans</h2></div></div>{stats?.favorite_openings?.length ? <ul>{stats.favorite_openings.slice(0, 4).map((opening) => <li key={opening.name}><b>{opening.name}</b><span>{opening.games} games</span></li>)}</ul> : <div className={styles.empty}>Opening patterns will appear as your library grows.</div>}</article>
      <article className={`${styles.card} ${styles.journey}`}><div className={styles.cardTitle}><div><span>Game story</span><h2>Recent journey</h2></div></div>{games.length ? <ol>{games.map((game) => <li key={game.id}><i data-result={game.result} /><div><b>{game.result === "win" ? "A win" : game.result === "loss" ? "A lesson" : "A balanced draw"}</b><span>{game.opening_name || `${game.difficulty} Rival`} · {new Date(game.completed_at).toLocaleDateString()}</span></div></li>)}</ol> : <div className={styles.empty}>Finish a signed-in game to begin your cloud timeline.</div>}</article>
      <article className={styles.card}><div className={styles.cardTitle}><div><span>Learning engine</span><h2>What unlocks next</h2></div></div><div className={styles.learning}><b>Playing style detector</b><p>After 20 analyzed games, RivalMind can describe preferences such as tactical play or late castling. It never guesses early.</p><b>Endgame patterns</b><p>Upcoming reviews will group recurring endings and show the Stockfish line behind each lesson.</p></div></article>
    </section>
  </main>;
}
