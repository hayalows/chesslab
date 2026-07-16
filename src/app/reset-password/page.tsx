"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./reset-password.module.css";

export default function ResetPasswordPage() {
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState(() => supabase ? "" : "Cloud accounts are not configured.");
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      setReady(Boolean(data.user));
      if (!data.user) setNotice("This password link has expired. Request a new one from Sign in.");
    });
  }, [supabase]);

  async function savePassword() {
    if (!supabase || !ready) return;
    if (password.length < 8) { setNotice("Use at least 8 characters for your password."); return; }
    if (password !== confirmPassword) { setNotice("Those passwords do not match yet."); return; }
    setSaving(true);
    setNotice("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setNotice(error.message);
    else {
      setPassword("");
      setConfirmPassword("");
      setComplete(true);
      setNotice("Your password is ready. You can use it for future sign-ins.");
    }
    setSaving(false);
  }

  return <main className={styles.page}>
    <Link className={styles.brand} href="/">RivalMind</Link>
    <section className={styles.card}>
      <span>Account security</span>
      <h1>{complete ? "Password updated." : "Choose a new password."}</h1>
      <p>{complete ? "Your training profile is ready whenever you are." : "Use at least 8 characters. Pick something you don’t use on another website."}</p>
      {!complete && <>
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" disabled={!ready} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
        <label htmlFor="confirm-new-password">Confirm new password</label>
        <input id="confirm-new-password" type="password" autoComplete="new-password" disabled={!ready} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void savePassword(); }} placeholder="Type it again" />
        <button type="button" disabled={!ready || saving} onClick={() => void savePassword()}>{saving ? "Saving…" : "Save new password"}</button>
      </>}
      <small aria-live="polite">{notice}</small>
      {complete && <Link className={styles.dashboardLink} href="/dashboard">Continue to my training</Link>}
      {!complete && !ready && <Link className={styles.backLink} href="/">Back to sign in</Link>}
    </section>
  </main>;
}
