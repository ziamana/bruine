"use client";

import { useEffect, useRef, useState } from "react";
import { asset, DICTS, type Lang } from "@/lib/i18n";
import { loadTape, NARROW, Screen, type Tape } from "@/lib/tape";
import { setWeather } from "@/lib/weather";
import { TermWindow, type TermHandle } from "./TermWindow";

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const clock = (s: number): string => `0:${s.toFixed(1).padStart(4, "0")}`;

/**
 * A real bruine session pinned beside its chapters, scrubbed by the scroll: each chapter owns a
 * stretch of the recording. While the recorded session waits for an approval, the rain holds still.
 */
export function Session({ lang }: { lang: Lang }) {
  const t = DICTS[lang].session;
  const windowRef = useRef<TermHandle>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [stamp, setStamp] = useState("0:00.0");
  const [cols, setCols] = useState(104);

  useEffect(() => {
    let cancelled = false;
    let screen: Screen | undefined;
    let tape: Tape | undefined;
    let queued = 0;
    let lastActive = -1;
    let lastStill: boolean | undefined;
    const narrow = window.matchMedia(NARROW);

    const update = (): void => {
      queued = 0;
      if (!screen || !tape) return;
      // On a phone the terminal covers the top of the screen: a chapter starts just below it.
      const pinBottom = pinRef.current?.getBoundingClientRect().bottom ?? 0;
      const anchor = narrow.matches ? pinBottom + 24 : window.innerHeight * 0.55;
      const items = chapterRefs.current;
      let index = 0;
      let progress = 0;
      for (let i = 0; i < items.length; i += 1) {
        const box = items[i]?.getBoundingClientRect();
        if (!box) continue;
        if (box.top <= anchor) {
          index = i;
          progress = clamp((anchor - box.top) / box.height);
        }
      }
      const first = items[0]?.getBoundingClientRect();
      const last = items.at(-1)?.getBoundingClientRect();
      const inside = first !== undefined && last !== undefined && first.top <= anchor && last.bottom >= anchor;
      const [from, to] = t.chapters[index]!.tape;
      const seconds = from + (to - from) * clamp(progress / 0.82);
      screen.draw(screen.frameAt(seconds));
      setStamp(clock(seconds));
      if (index !== lastActive) {
        lastActive = index;
        setActive(index);
      }
      const m = tape.markers;
      const still = inside && ((seconds >= m.approval1! && seconds < m.approve1!) || (seconds >= m.approval2! && seconds < m.approve2!));
      if (still !== lastStill) {
        lastStill = still;
        setWeather("session", still ? { intensity: 0, still: true } : null);
      }
    };
    const schedule = (): void => {
      if (!queued) queued = requestAnimationFrame(update);
    };
    const load = (): void => {
      void loadTape(asset(narrow.matches ? "/tape/session-narrow.json" : "/tape/session.json")).then((loaded) => {
        const host = windowRef.current?.host;
        if (cancelled || !host) return;
        tape = loaded;
        screen = new Screen(host, loaded);
        lastActive = -1;
        setCols(loaded.cols);
        update();
      });
    };
    // The pin's height, for the chapter text that sits under it on a phone.
    const measure = new ResizeObserver(() => {
      const pin = pinRef.current;
      if (pin) stageRef.current?.style.setProperty("--pin-h", `${pin.offsetHeight}px`);
      schedule();
    });
    if (pinRef.current) measure.observe(pinRef.current);

    load();
    narrow.addEventListener("change", load);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelled = true;
      cancelAnimationFrame(queued);
      measure.disconnect();
      narrow.removeEventListener("change", load);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      setWeather("session", null);
    };
  }, [t]);

  return (
    <section className="session" aria-labelledby="session-title">
      <div ref={stageRef} className="session-stage">
        <header className="section-head session-head">
          <h2 id="session-title">{t.title}</h2>
          <p>{t.lead}</p>
        </header>
        <div ref={pinRef} className="session-pin">
          <TermWindow ref={windowRef} cols={cols} title="bruine · ~/code/api" stamp={stamp}>
            <noscript>
              <p className="window-noscript">{t.noscript}</p>
            </noscript>
          </TermWindow>
        </div>
        <ol className="chapters">
          {t.chapters.map((chapter, i) => (
            <li
              key={chapter.id}
              id={`see-${chapter.id}`}
              ref={(el) => {
                chapterRefs.current[i] = el;
              }}
              className="chapter"
              data-active={i === active}
            >
              <div className="chapter-text">
                <h3>{chapter.title}</h3>
                <p>{chapter.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
