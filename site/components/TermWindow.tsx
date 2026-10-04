"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";

export interface TermHandle {
  /** The element the Screen draws its rows into. */
  host: HTMLDivElement | null;
  /** Lay the terminal out again, after the column count changed. */
  fit(): void;
}

/**
 * A terminal window: the TUI's own colours inside window chrome. The grid is laid out at a fixed
 * size and scaled to the window, so a browser that rounds glyph advances still fits every column.
 */
export const TermWindow = forwardRef<
  TermHandle,
  { cols: number; title: string; stamp?: ReactNode; mode?: "dark" | "light" | "weather"; className?: string; children?: ReactNode }
>(function TermWindow({ cols, title, stamp, mode = "dark", className, children }, ref) {
  const fitRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);

  const fit = (): void => {
    const box = fitRef.current;
    const term = termRef.current;
    if (!box || !term || !term.offsetWidth || !box.clientWidth) return;
    const scale = box.clientWidth / term.offsetWidth;
    box.style.setProperty("--scale", String(scale));
    box.style.height = `${term.offsetHeight * scale}px`;
  };
  useImperativeHandle(ref, () => ({ get host() { return termRef.current; }, fit }));

  useEffect(() => {
    const box = fitRef.current;
    if (!box) return;
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    void document.fonts.ready.then(fit);
    fit();
    return () => watch.disconnect();
  }, [cols]);

  return (
    <figure className={`window${className ? ` ${className}` : ""}`} data-mode={mode}>
      <figcaption className="window-bar">
        <span className="window-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="window-title" translate="no">
          {title}
        </span>
        <span className="window-stamp" aria-hidden="true">
          {stamp}
        </span>
      </figcaption>
      <div className="window-body">
        <div ref={fitRef} className="term-fit">
          <div ref={termRef} className="term" style={{ width: `${cols}ch` }} aria-hidden="true" translate="no" />
        </div>
        {children}
      </div>
    </figure>
  );
});
