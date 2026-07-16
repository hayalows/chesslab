"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./AuthMenu.module.css";

type Props = { triggerLabel?: string; redirectTo?: string; prominent?: boolean };

export default function AuthMenu({ triggerLabel = "Save progress", redirectTo = "/dashboard", prominent = false }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = ""; };
  }, [open]);

  async function emailSignIn() {
    if (!supabase || !email.trim()) { setNotice("Enter your email to continue."); return; }
    setSending(true);
    const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`;
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback, shouldCreateUser: true } });
    setNotice(error ? error.message : "Your sign-in link is on its way. Open it on this device to continue.");
    setSending(false);
  }

  if (user) return <div className={styles.account}><Link href="/dashboard">My training</Link><button type="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button></div>;

  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={styles.card} role="dialog" aria-modal="true" aria-labelledby="email-auth-title">
        <button className={styles.close} type="button" aria-label="Close sign in" onClick={() => setOpen(false)}>×</button>
        <span className={styles.eyebrow}>Free training profile</span>
        <h2 id="email-auth-title">Keep every lesson.</h2>
        <p>Enter your email. We’ll send one secure link—no password to remember.</p>
        <label htmlFor="rivalmind-email">Email address</label>
        <input id="rivalmind-email" autoFocus type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void emailSignIn(); }} placeholder="you@example.com" />
        <button className={styles.continueButton} type="button" disabled={sending} onClick={() => void emailSignIn()}>{sending ? "Sending link…" : "Email me a sign-in link"}</button>
        <small>{notice || "New here? This creates your account automatically."}</small>
        <div className={styles.guestLine}><span>Want to look around first?</span><Link href="/play?time=open" onClick={() => setOpen(false)}>Play as guest</Link></div>
      </section>
    </div>, document.body) : null;

  return <><button type="button" className={`${styles.trigger} ${prominent ? styles.prominent : ""}`} onClick={() => setOpen(true)}>{triggerLabel}</button>{dialog}</>;
}
