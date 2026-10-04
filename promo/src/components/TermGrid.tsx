import React from "react";
import type { Span } from "../data/terminal";

/** The terminal's own colours, for the cells an application leaves to the terminal. */
export const TERM_FG = "#d5d9e4";
export const TERM_BG = "#0e1018";

/** The cell of a monospace font at `font` pixels: 0.602 em wide, 1.2 em tall. */
export const cellOf = (font: number): { w: number; h: number } => ({ w: font * 0.602, h: Math.round(font * 1.2) });

/**
 * One row of a terminal screen, cell for cell: every run of cells drawn where it was, in the
 * colours it had, so the columns line up whatever font draws a fallback glyph.
 */
export const TermRow: React.FC<{ spans: readonly Span[]; y: number; font: number }> = ({ spans, y, font }) => {
  const cell = cellOf(font);
  return (
    <>
      {spans.map(([col, text, fg, bg, flags], i) => {
        const inverse = (flags & 8) !== 0;
        const fore = inverse ? (bg ?? TERM_BG) : (fg ?? TERM_FG);
        const back = inverse ? (fg ?? TERM_FG) : bg;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: col * cell.w,
              top: y * cell.h,
              width: [...text].length * cell.w,
              height: cell.h,
              lineHeight: `${cell.h}px`,
              whiteSpace: "pre",
              background: back ?? undefined,
              color: fore,
              fontWeight: (flags & 1) !== 0 ? 700 : 400,
              fontStyle: (flags & 2) !== 0 ? "italic" : "normal",
              opacity: (flags & 4) !== 0 ? 0.6 : 1,
              textDecoration: (flags & 16) !== 0 ? "underline" : undefined,
            }}
          >
            {text}
          </div>
        );
      })}
    </>
  );
};
