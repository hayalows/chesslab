"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Color } from "chess.js";
import type { TimeControl } from "./game-types";
import { TIME_CONTROLS } from "./training-analytics";

export function useGameClock(timeControl: TimeControl, active: Color, running: boolean, onFlag: (color: Color) => void) {
  const settings = TIME_CONTROLS[timeControl];
  const [whiteMs, setWhiteMs] = useState<number | null>(settings.initialMs);
  const [blackMs, setBlackMs] = useState<number | null>(settings.initialMs);
  const lastTickRef = useRef(0);
  const flaggedRef = useRef(false);
  const onFlagRef = useRef(onFlag);
  useEffect(() => { onFlagRef.current = onFlag; }, [onFlag]);

  useEffect(() => {
    lastTickRef.current = Date.now();
    if (!running || settings.initialMs === null) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;
      const update = active === "w" ? setWhiteMs : setBlackMs;
      update((current) => {
        if (current === null) return null;
        const next = Math.max(0, current - elapsed);
        if (next === 0 && !flaggedRef.current) {
          flaggedRef.current = true;
          queueMicrotask(() => onFlagRef.current(active));
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [active, running, settings.initialMs]);

  const addIncrement = useCallback((color: Color) => {
    if (!settings.incrementMs) return;
    (color === "w" ? setWhiteMs : setBlackMs)((current) => current === null ? null : current + settings.incrementMs);
  }, [settings.incrementMs]);

  const reset = useCallback(() => {
    flaggedRef.current = false;
    lastTickRef.current = Date.now();
    setWhiteMs(settings.initialMs);
    setBlackMs(settings.initialMs);
  }, [settings.initialMs]);

  return { whiteMs, blackMs, addIncrement, reset };
}
