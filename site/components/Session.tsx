"use client";

import { useEffect, useRef, useState } from "react";
import { asset, DICTS, type Lang } from "@/lib/i18n";
import { Screen, type Tape } from "@/lib/tape";
import { BASE_INTENSITY, setWeather } from "@/lib/weather";

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const clock = (s: number): string => `0:${s.toFixed(1).padStart(4, "0")}`;

/**
 * The signature of the page: a real bruine session pinned beside its chapters, scrubbed by the
 * scroll. Each chapter owns a stretch of the recording, or one still from the same recorder.
 */
export function Session({ lang }: { lang: Lang }) {
  const t = DICTS[lang].session;
  const termRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [stamp, setStamp] = useState("0:00.0");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let screen: Screen | undefined;
    let tape: Tape | undefined;
    let queued = 0;
    let lastActive = -1;
    let lastWeather = "";

    const update = (): void => {
      queued = 0;
      if (!screen || !tape) return;
      const anchor = window.innerHeight * 0.55;
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
      // Past the last chapter, the session is over: the sky goes back to its drizzle.
      const lastBox = items.at(-1)?.getBoundingClientRect();
      const over = lastBox !== undefined && lastBox.bottom < anchor;
      const chapter = t.chapters[index]!;
      const screenOf = chapter.screen;
      let still = false;
      if ("tape" in screenOf) {
        const [from, to] = screenOf.tape;
        const seconds = from + (to - from) * clamp(progress / 0.82);
        screen.draw(screen.frameAt(seconds));
        setStamp(clock(seconds));
        const m = tape.markers;
        still = (seconds >= m.approval1! && seconds < m.approve1!) || (seconds >= m.approval2! && seconds < m.approve2!);
      } else if ("still" in screenOf) {
        screen.draw(tape.stills[screenOf.still]);
        setStamp(t.still);
      } else {
        setStamp("ctrl+e");
      }
      if (index !== lastActive) {
        lastActive = index;
        setActive(index);
      }
      const weather =
        "weather" in screenOf && !over
          ? { intensity: 0.3 + 0.7 * clamp(progress / 0.7), lightning: progress > 0.62 }
          : { intensity: BASE_INTENSITY, still: still && !over };
      const key = JSON.stringify(weather);
      if (key !== lastWeather) {
        lastWeather = key;
        setWeather(weather);
      }
    };
    const schedule = (): void => {
      if (!queued) queued = requestAnimationFrame(update);
    };

    fetch(asset("/tape/session.json"))
      .then((r) => r.json() as Promise<Tape>)
      .then((loaded) => {
        if (cancelled || !termRef.current) return;
        tape = loaded;
        screen = new Screen(termRef.current, loaded);
        setReady(true);
        update();
      })
      .catch(() => {});
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelled = true;
      cancelAnimationFrame(queued);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      setWeather({ intensity: BASE_INTENSITY });
    };
  }, [t]);

  // The terminal is laid out at a fixed size and scaled to the window, so a browser that rounds
  // glyph advances to whole pixels still fits all 104 columns.
  useEffect(() => {
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    const resize = (): void => {
      const width = fit.clientWidth;
      if (!term.offsetWidth || !width) return;
      const scale = width / term.offsetWidth;
      fit.style.setProperty("--scale", String(scale));
      fit.style.height = `${term.offsetHeight * scale}px`;
    };
    const watch = new ResizeObserver(resize);
    watch.observe(fit);
    void document.fonts.ready.then(resize);
    resize();
    return () => watch.disconnect();
  }, [ready]);

  const screenOf = t.chapters[active]!.screen;
  const mode = "weather" in screenOf ? "weather" : "still" in screenOf && screenOf.still === "light" ? "light" : "dark";

  return (
    <section className="session" aria-labelledby="session-title">
      <link rel="prefetch" href={asset("/media/effort.webp")} as="image" />
      <header className="section-head">
        <h2 id="session-title">{t.title}</h2>
        <p>{t.lead}</p>
      </header>
      <div className="session-stage">
        <div className="session-pin">
          <figure className="window" data-mode={mode} data-ready={ready}>
            <figcaption className="window-bar">
              <span className="window-lights" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="window-title">{t.window}</span>
              <span className="window-stamp" aria-hidden="true">
                {stamp}
              </span>
            </figcaption>
            <div className="window-body">
              <div ref={fitRef} className="term-fit">
                <div ref={termRef} className="term" aria-hidden="true" translate="no" />
              </div>
              {/* The weather chapter shows the prompt box from the film, effort low to max. */}
              {mode === "weather" ? <img className="window-weather" src={asset("/media/effort.webp")} alt="" decoding="async" /> : null}
              <noscript>
                <p className="window-noscript">{t.noscript}</p>
              </noscript>
            </div>
          </figure>
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
              <h3>{chapter.title}</h3>
              <p>{chapter.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
