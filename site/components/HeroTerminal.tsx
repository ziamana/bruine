"use client";

import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/i18n";
import { loadTape, NARROW, Screen } from "@/lib/tape";
import { TermWindow, type TermHandle } from "./TermWindow";

const HOLD_MS = 2600;

/**
 * The session playing on its own in the first screen, the way it ran: from the prompt to the
 * queued one going out, then again. It rests on its last frame for a visitor who asked for less motion.
 */
export function HeroTerminal() {
  const windowRef = useRef<TermHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(104);
  const [stamp, setStamp] = useState("0:00.0");

  useEffect(() => {
    const narrow = window.matchMedia(NARROW);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let screen: Screen | undefined;
    let start = 0;
    let frame = 0;
    let visible = true;
    let cancelled = false;
    let length = 14;

    const tick = (now: number): void => {
      if (!screen) return;
      const t = (now - start) / 1000;
      const seconds = Math.min(length, 0.2 + t);
      screen.draw(screen.frameAt(seconds));
      setStamp(`0:${seconds.toFixed(1).padStart(4, "0")}`);
      if (t * 1000 > length * 1000 + HOLD_MS) start = now;
      if (visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const play = (): void => {
      cancelAnimationFrame(frame);
      if (!screen) return;
      if (reduced) {
        screen.draw(screen.frameAt(length));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const load = (): void => {
      void loadTape(asset(narrow.matches ? "/tape/session-narrow.json" : "/tape/session.json")).then((tape) => {
        const host = windowRef.current?.host;
        if (cancelled || !host) return;
        length = tape.markers.end ?? tape.frames.length / tape.fps;
        screen = new Screen(host, tape);
        setCols(tape.cols);
        start = performance.now();
        play();
      });
    };
    const seen = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry?.isIntersecting ?? true;
      if (visible && !was) {
        const offset = performance.now();
        start = offset - 200;
        play();
      }
    });
    if (wrapRef.current) seen.observe(wrapRef.current);
    const onVisibility = (): void => {
      if (!document.hidden) play();
    };
    load();
    narrow.addEventListener("change", load);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      seen.disconnect();
      narrow.removeEventListener("change", load);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={wrapRef} className="hero-window">
      <TermWindow ref={windowRef} cols={cols} title="bruine · ~/code/api" stamp={stamp} />
    </div>
  );
}
