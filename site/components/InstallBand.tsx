"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DICTS, INSTALL, type Installer, type Lang } from "@/lib/i18n";
import { ripple } from "@/lib/weather";

const ORDER: Installer[] = ["npm", "pnpm", "bun"];

/**
 * The install command, asked the way bruine asks: a framed amber request, a letter per answer.
 * y copies, a switches installer, n goes to the guide. The letters work while the band is on screen.
 */
export function InstallBand({ lang, id }: { lang: Lang; id: string }) {
  const t = DICTS[lang].band;
  const [installer, setInstaller] = useState<Installer>("npm");
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const bandRef = useRef<HTMLDivElement>(null);
  const laterRef = useRef<HTMLAnchorElement>(null);
  const visible = useRef(false);
  const next = ORDER[(ORDER.indexOf(installer) + 1) % ORDER.length]!;
  const command = INSTALL[installer];

  const copy = useCallback(async () => {
    setCursor(0);
    try {
      await navigator.clipboard.writeText(command);
      setStatus("copied");
      const box = bandRef.current?.getBoundingClientRect();
      if (box) ripple(box.left + box.width * 0.18, box.top + 18);
    } catch {
      setStatus("failed");
    }
  }, [command]);

  const other = useCallback(() => {
    setCursor(1);
    setInstaller(next);
    setStatus("idle");
  }, [next]);

  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    const seen = new IntersectionObserver(([entry]) => {
      visible.current = (entry?.intersectionRatio ?? 0) > 0.6;
    }, { threshold: [0, 0.6, 1] });
    seen.observe(band);
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const focused = band.contains(document.activeElement);
      if (!visible.current && !focused) return;
      const key = event.key.toLowerCase();
      if (key === "y") {
        event.preventDefault();
        void copy();
      } else if (key === "a") {
        event.preventDefault();
        other();
      } else if (key === "n" && focused) {
        event.preventDefault();
        laterRef.current?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      seen.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, [copy, other]);

  return (
    <div ref={bandRef} className="band" role="group" aria-labelledby={`${id}-title`} data-status={status}>
      <div className="band-title" id={`${id}-title`}>
        <span className="band-rule" aria-hidden="true">─</span> {t.title} <span className="sr-only">: {t.label}</span>
      </div>
      <div className="band-body">
        <code className="band-command" translate="no">
          {command}
        </code>
        <ul className="band-choices">
          <li>
            <button type="button" className="band-choice" aria-current={cursor === 0 ? "true" : undefined} onClick={() => void copy()} onFocus={() => setCursor(0)}>
              <span className="band-pointer" aria-hidden="true">›</span>
              <kbd>y</kbd>
              <span>{t.copy}</span>
            </button>
          </li>
          <li>
            <button type="button" className="band-choice" aria-current={cursor === 1 ? "true" : undefined} onClick={other} onFocus={() => setCursor(1)}>
              <span className="band-pointer" aria-hidden="true">›</span>
              <kbd>a</kbd>
              <span>{t.other(next)}</span>
            </button>
          </li>
          <li>
            <Link ref={laterRef} href={`/${lang}/docs/`} className="band-choice" aria-current={cursor === 2 ? "true" : undefined} onFocus={() => setCursor(2)}>
              <span className="band-pointer" aria-hidden="true">›</span>
              <kbd>n</kbd>
              <span>{t.later}</span>
            </Link>
          </li>
        </ul>
        <p className="band-status" role="status" aria-live="polite">
          {status === "copied" ? <><span className="band-ok" aria-hidden="true">✓</span> {t.copied}</> : status === "failed" ? t.failed : ""}
        </p>
      </div>
      <div className="band-foot" aria-hidden="true">
        {t.keys} <span className="band-rule">──</span>
      </div>
    </div>
  );
}
