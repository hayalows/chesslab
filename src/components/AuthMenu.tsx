"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isGoogleAuthEnabled } from "@/lib/supabase/config";
import styles from "./RivalMindGame.module.css";

export default function AuthMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const supabase = createClient();

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  async function emailSignIn() {
    if (!supabase || !email) return;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard` } });
    setNotice(error ? error.message : "Check your email for a secure sign-in link.");
  }

  async function googleSignIn() {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` } });
    if (error) setNotice(error.message);
  }

  if (user) return <div className={styles.accountGroup}><Link href="/dashboard">My journey</Link><button type="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button></div>;
  return <>
    <button type="button" className={styles.accountButton} onClick={() => setOpen(true)}>Save progress</button>
    {open && <div className={styles.authBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={styles.authCard} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className={styles.authClose} type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        <span className={styles.eyebrow}>Cloud profile</span><h2 id="auth-title">Take your chess journey with you.</h2><p>Your guest games stay private on this device until you sign in. Signing in upgrades your profile for cloud sync.</p>
        <button className={styles.googleButton} type="button" disabled={!isGoogleAuthEnabled} onClick={() => void googleSignIn()}>{isGoogleAuthEnabled ? "Continue with Google" : "Google sign-in · setup needed"}</button>
        <span className={styles.authDivider}>or use email</span>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <button className={styles.emailButton} type="button" onClick={() => void emailSignIn()}>Email me a sign-in link</button>
        {notice && <small className={styles.authNotice}>{notice}</small>}
      </section>
    </div>}
  </>;
}
