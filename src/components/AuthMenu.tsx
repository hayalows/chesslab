"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./AuthMenu.module.css";

type Props = { triggerLabel?: string; redirectTo?: string; prominent?: boolean };
type AuthMode = "sign-in" | "sign-up";

export default function AuthMenu({ triggerLabel = "Save progress", redirectTo = "/dashboard", prominent = false }: Props) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

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

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setNotice("");
  }

  function callback(next = redirectTo) {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }

  async function submit() {
    if (!supabase || !email.trim()) { setNotice("Enter your email address."); return; }
    if (password.length < 8) { setNotice("Use at least 8 characters for your password."); return; }
    if (mode === "sign-up" && password !== confirmPassword) { setNotice("Those passwords do not match yet."); return; }

    setSending(true);
    setNotice("");
    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setNotice(error.message === "Invalid login credentials" ? "That email or password is not correct." : error.message);
      else window.location.assign(redirectTo);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: callback() },
      });
      if (error) setNotice(error.message);
      else if (data.session) window.location.assign(redirectTo);
      else setNotice("Check your email once to confirm your account. After that, sign in with your password.");
    }
    setSending(false);
  }

  async function recoverPassword() {
    if (!supabase || !email.trim()) { setNotice("Enter your email first, then choose Forgot password."); return; }
    setSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: callback("/reset-password"),
    });
    setNotice(error ? error.message : "Password reset email sent. Use that link to choose a new password.");
    setSending(false);
  }

  if (user) return <div className={styles.account}><Link href="/dashboard">My training</Link><button type="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button></div>;

  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={styles.card} role="dialog" aria-modal="true" aria-labelledby="email-auth-title">
        <button className={styles.close} type="button" aria-label="Close sign in" onClick={() => setOpen(false)}>×</button>
        <span className={styles.eyebrow}>Free training profile</span>
        <h2 id="email-auth-title">{mode === "sign-in" ? "Welcome back." : "Keep every lesson."}</h2>
        <p>{mode === "sign-in" ? "Sign in to continue your training journey." : "Create your profile and watch your chess improve over time."}</p>

        <div className={styles.modeSwitch} aria-label="Account action">
          <button type="button" aria-pressed={mode === "sign-in"} onClick={() => changeMode("sign-in")}>Sign in</button>
          <button type="button" aria-pressed={mode === "sign-up"} onClick={() => changeMode("sign-up")}>Create account</button>
        </div>

        <label htmlFor="rivalmind-email">Email address</label>
        <input id="rivalmind-email" autoFocus type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        <label htmlFor="rivalmind-password">Password</label>
        <input id="rivalmind-password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && mode === "sign-in") void submit(); }} placeholder="At least 8 characters" />
        {mode === "sign-up" && <><label htmlFor="rivalmind-confirm-password">Confirm password</label><input id="rivalmind-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="Type it again" /></>}

        {mode === "sign-in" && <button className={styles.forgotButton} type="button" disabled={sending} onClick={() => void recoverPassword()}>Forgot password?</button>}
        <button className={styles.continueButton} type="button" disabled={sending} onClick={() => void submit()}>{sending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create my profile"}</button>
        <small className={notice ? styles.notice : ""} aria-live="polite">{notice || (mode === "sign-up" ? "You’ll confirm your email once. Your password handles future sign-ins." : "Existing magic-link user? Use Forgot password to create your password.")}</small>
        <div className={styles.guestLine}><span>Want to play without an account?</span><Link href="/play?time=open" onClick={() => setOpen(false)}>Continue as guest</Link></div>
      </section>
    </div>, document.body) : null;

  return <><button type="button" className={`${styles.trigger} ${prominent ? styles.prominent : ""}`} onClick={() => setOpen(true)}>{triggerLabel}</button>{dialog}</>;
}
