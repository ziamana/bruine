"use client";

import { useEffect, useRef } from "react";
import { asset, DICTS, type Lang } from "@/lib/i18n";
import { loadTape, Screen } from "@/lib/tape";
import { setWeather } from "@/lib/weather";
import { TermWindow, type TermHandle } from "./TermWindow";

type Still = "retry" | "image" | "light";

/** Every card shows 16 rows: the part of each still that carries its point, so the demos line up. */
const ROWS = 16;
const SLICE: Record<Still, number> = { retry: 9, image: 1, light: 4 };

/** One capability, shown by a still of the real terminal (56 columns, recorded for small windows). */
function StillWindow({ still }: { still: Still }) {
  const ref = useRef<TermHandle>(null);
  useEffect(() => {
    let cancelled = false;
    void loadTape(asset("/tape/session-narrow.json")).then((tape) => {
      const host = ref.current?.host;
      if (cancelled || !host) return;
      new Screen(host, tape, ROWS).draw(tape.stills[still].slice(SLICE[still], SLICE[still] + ROWS));
      ref.current?.fit();
    });
    return () => {
      cancelled = true;
    };
  }, [still]);
  return <TermWindow ref={ref} cols={56} rows={ROWS} title="bruine · ~/code/report" stamp={null} mode={still === "light" ? "light" : "dark"} />;
}

/**
 * The weather card: the prompt box from the film at max effort, its frame running every colour,
 * and the page's rain turning to a storm while the card is on screen.
 */
function WeatherWindow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => setWeather("weather-card", (entry?.intersectionRatio ?? 0) > 0.55 ? { intensity: 1, lightning: true } : null),
      { threshold: [0, 0.55, 1] },
    );
    seen.observe(el);
    return () => {
      seen.disconnect();
      setWeather("weather-card", null);
    };
  }, []);
  return (
    <figure ref={ref} className="window window-film">
      <figcaption className="window-bar">
        <span className="window-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="window-title" translate="no">
          ctrl+e · effort max
        </span>
        <span className="window-stamp" aria-hidden="true" />
      </figcaption>
      <div className="window-body window-clip-body">
        <img className="window-clip" src={asset("/media/effort-max.webp")} alt="" loading="lazy" decoding="async" width="760" height="299" />
      </div>
    </figure>
  );
}

export function Capabilities({ lang }: { lang: Lang }) {
  const t = DICTS[lang].capabilities;
  return (
    <section className="capabilities" aria-labelledby="capabilities-title">
      <h2 id="capabilities-title" className="centered-title">
        {t.title.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h2>
      <div className="capability-grid">
        {t.cards.map((card) => (
          <article key={card.id} className="capability" aria-labelledby={`cap-${card.id}`}>
            <div className="capability-text">
              <h3 id={`cap-${card.id}`}>{card.title}</h3>
              <p>{card.body}</p>
            </div>
            <div className="capability-demo">{card.id === "weather" ? <WeatherWindow /> : <StillWindow still={card.id} />}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
