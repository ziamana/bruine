---
name: bruine
description: Night ground, pastel rain, amber only for asking; the terminal app's own world at page scale.
colors:
  lavender: "#b4a7ff"
  violet-light: "#d9d0ff"
  sky: "#7dcfff"
  amber: "#f2cf73"
  mint: "#8fe3a3"
  pink: "#ff9ed2"
  night: "#0b0d14"
  night-glow: "#1a1830"
  window: "#11141e"
  surface: "#1c2030"
  edge: "#262c3f"
  text: "#e6e9f2"
  muted: "#9aa0b8"
  faint: "#858ba6"
  term-light-bg: "#fafafa"
  term-light-fg: "#1f2330"
  term-light-edge: "#d5d8e2"
typography:
  display:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "clamp(2rem, min(4vw, 5.8vh), 3.1rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "clamp(1.75rem, 3.6vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  command:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "clamp(1.05rem, 2.6vw, 1.5rem)"
    fontWeight: 400
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
  body-lead:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
  terminal:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.32
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 4vw, 48px)"
  column: "1180px"
  measure: "68ch"
  step: "clamp(5.5rem, 12vw, 10rem)"
components:
  install-band:
    backgroundColor: "{colors.night}"
    textColor: "{colors.text}"
    typography: "{typography.command}"
    rounded: "{rounded.lg}"
    padding: "1.25rem clamp(1rem, 2.4vw, 1.6rem) 1.1rem"
    width: "100%"
  install-band-choice:
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "0.2rem 0.65rem 0.2rem 0.25rem"
    height: "40px"
  install-band-choice-active:
    backgroundColor: "rgba(242, 207, 115, 0.08)"
    textColor: "{colors.text}"
  install-band-choice-pressed:
    backgroundColor: "rgba(242, 207, 115, 0.16)"
  terminal-window:
    backgroundColor: "{colors.window}"
    textColor: "{colors.text}"
    typography: "{typography.terminal}"
    rounded: "{rounded.xl}"
  terminal-window-light:
    backgroundColor: "{colors.term-light-bg}"
    textColor: "{colors.term-light-fg}"
  reading:
    backgroundColor: "{colors.window}"
    textColor: "{colors.sky}"
    rounded: "{rounded.xs}"
    padding: "0.15rem 0.5rem"
  link:
    textColor: "{colors.sky}"
  link-hover:
    textColor: "{colors.violet-light}"
  nav-link:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    height: "44px"
  nav-link-current:
    textColor: "{colors.text}"
  inline-code:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.violet-light}"
    rounded: "{rounded.xs}"
    padding: "0.05em 0.35em"
  code-block:
    backgroundColor: "{colors.window}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "1rem 1.15rem"
  release-tag:
    textColor: "{colors.mint}"
    rounded: "{rounded.pill}"
    padding: "0.05rem 0.6rem"
  skip-link:
    backgroundColor: "{colors.lavender}"
    textColor: "{colors.night}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.9rem"
---

# Design System: bruine

## Overview

**Creative North Star: "A Terminal Under Fine Rain"**

The site is the terminal app's own world brought to page scale. A night ground holds a faint pastel rain that falls behind everything and never takes a click; on top of it sit the TUI's own framed boxes, set in JetBrains Mono, with Inter carrying the prose between them. The page does not describe bruine from outside: it frames the real thing (a recorded session, the stills, the film) and asks the visitor in the same amber frame bruine uses when it asks before acting.

Density is calm and columnar. One centred column (1180px plus gutters) carries everything; content groups are divided by 1px hairlines rather than boxed into cards; the only framed objects are the approval band, the terminal window, and small terminal readings. Colour is rationed by job: each pastel means one thing, and amber means only "this asks you". Motion is the weather: the scroll scrubs the recording, the rain follows how hard the model is thinking, and a copied command lands as a ring in the rain.

The theme is dark only, deliberately: the readers are terminal developers, often at night, and the brand is night rain. Light appears only inside the terminal window, when the session shows the TUI's light theme.

**Key Characteristics:**
- Night ground with a violet glow at the top and pastel rain drawn on a fixed canvas behind the page.
- JetBrains Mono for every heading, label, command and terminal; Inter only for running prose.
- Rounded 1px frames with their title set into the border, as the TUI draws them.
- Hairline-divided lists instead of card grids.
- Amber reserved for asking; mint for done; pink for what bruine refuses.
- Motion that is weather: scrub, rain intensity, one ripple.

## Colors

A deep blue-black night carries five pastels from the terminal app, each with exactly one job.

### Primary
- **Rain Lavender** (`lavender`): the interactive accent. Text caret, native `accent-color`, list markers in prose, the FAQ chevron, the film's play ring, the hover edge of the table of contents, the bruine column header in the compare table, the skip link fill, and the rings of the copy ripple.
- **Pale Violet** (`violet-light`): emphasis on dark. Link hover, the active chapter title in the session, the long line of providers, inline code, the dictionary line under the hero, and the right-hand values in fit tables.

### Secondary
- **Night Sky Blue** (`sky`): links and focus. Every link at rest (with a 40% underline that becomes solid on hover), the 2px focus outline, and the tok/s reading.

### Tertiary
- **Approval Amber** (`amber`): asking, and nothing else. The install band's border, title, keys, pointer and choice highlight; the `ask` mode reading. It is the TUI's approval frame colour.
- **Done Mint** (`mint`): something finished or kept. The band after a copy (border, title, glow, the ✓ status line), the cache reading, the release tag.
- **Refusal Pink** (`pink`): what bruine does not do. The × before each item in that list. Also one of the rain inks.

### Neutral
- **Night** (`night`): the page ground, the band's fill, and the patch behind a title set into a border.
- **Night Glow** (`night-glow`): a radial wash at the top of the page (120% × 60% ellipse at 50% −10%, fading by 60%), fixed to the viewport.
- **Terminal Window** (`window`): the terminal's own background; also code blocks, table headers, readings, the film screen.
- **Raised Surface** (`surface`): inline code only.
- **Edge** (`edge`): every 1px border and hairline, the scrollbar thumb.
- **Text** (`text`): headings, active content, the command line.
- **Muted** (`muted`): secondary prose, leads, nav links at rest, inactive chapters (7.5:1 on night).
- **Faint** (`faint`): the dimmest readable text: the `$ ` prompt, provider separators, window bar text, inactive chapter titles (5.8:1 on night). Nothing goes dimmer.
- **Light terminal** (`term-light-bg`, `term-light-fg`, `term-light-edge`): the window's colours while the session shows the TUI's light theme. Never used outside the window.

### Named Rules
**The Amber Asks Rule.** Amber appears only where something asks for a decision: the install band and the Ask permission mode. A heading, a highlight or a warning that does not ask is never amber.

**The One Job Rule.** Each pastel keeps its job across every page: sky is a link or focus, lavender is the interactive accent, mint is done, pink is refusal. A new element takes the colour of its job, not a colour for variety.

**The Night Only Rule.** The page is dark only (`color-scheme: dark`, theme colour night). Light exists only inside the terminal window when the recording shows the light theme.

## Typography

**Display Font:** JetBrains Mono NL (with ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)
**Body Font:** Inter, variable 100–900 (with system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Label/Mono Font:** JetBrains Mono NL, the same face as display

**Character:** The terminal speaks in mono, bold and tightly tracked at display sizes, so every heading reads like a line bruine printed; Inter sits between in a comfortable 1.65 leading for the human explanation. Both are self-hosted, OFL, the faces of the film.

### Hierarchy
- **Display** (700, `display`, 1.12, −0.035em): the one-line offer in the hero, capped at 22ch. The closing line uses the same voice at its largest (clamp(2.25rem, 5.5vw, 4.5rem), −0.04em); a document title uses clamp(2rem, 4.4vw, 3.25rem).
- **Headline** (700, `headline`, 1.12, −0.02em): section titles, balanced. Inside the session stage and documents it steps down (clamp(1.6rem, 2.6vw, 2.25rem); clamp(1.4rem, 2.6vw, 1.85rem)).
- **Title** (700, 1.25rem, −0.01em): chapter titles, promise titles, FAQ questions (1.0625rem), document subsections (1.1rem).
- **Command** (400, `command`): the install command inside the band, prefixed by a faint `$ `.
- **Body** (400, 1.0625rem, 1.65): prose, capped at the 68ch measure; chapter text at 40ch.
- **Body Lead** (400, 1.125rem, muted): the paragraph under a section title.
- **Label** (mono, 0.75–0.875rem): nav, hero facts, band title and keys, readings, table headers, window bar, table of contents.
- **Terminal** (400, 16px, 1.32): the recorded screen, laid out at 104 cells (56 on phones) and scaled to its window as a whole, ligatures off.

### Named Rules
**The Mono Speaks Rule.** Every heading, label, key, command and reading is set in JetBrains Mono; Inter is for paragraphs a person reads. No heading is ever set in Inter.

**The Real Grid Rule.** The terminal is never reflowed or re-set at a smaller font: it is laid out at 16px on its own cell grid and scaled as one block, so every column of the recording lands where the app drew it.

## Layout

One centred column: content max 1180px (`column`) plus a fluid gutter (`gutter`, 16px on phones up to 48px), shared by nav, page and footer. Sections are separated by the large vertical `step` (5.5rem to 10rem) rather than by rules or bands of colour. Running text stops at the 68ch `measure`; section heads at 46rem; the hero and close at 56rem; the "does not do" and FAQ sections at 50rem.

The session is a two-column stage (1.7fr terminal, 1fr chapters, gap up to 4rem). The terminal pins in place at `max(2rem, 50vh − 15rem)` from the top while chapters scroll past it; each chapter is at least 78vh tall with 22vh above its text, and the chapter crossing 55% of the viewport owns the screen. Reading pages use a 13rem sticky table of contents beside a 46rem prose column.

Breakpoints: at 860px the session stacks (head, terminal, chapters), the terminal pins to the very top with a night fade beneath it, a 56-column recording replaces the 104-column one, each chapter's text sticks just under the terminal, promise rows and the reading layout collapse to one column, and the table of contents becomes a bordered two-column box. At 520px the nav drops its third link, band choices grow to 44px, the window title hides, and the contents list goes to one column. Interactive targets are at least 44px tall in the nav, the "more" links and phone band choices.

**The Hairline List Rule.** Grouped facts (promises, FAQ, fit tables, releases) are rows divided by 1px `edge` hairlines, top and bottom, never a grid of equal bordered cards.

## Elevation & Depth

The page is flat. Depth comes from three layers in fixed order: the night ground with its glow, the rain canvas and lightning wash (fixed, behind, `pointer-events: none`), and the content. Only two objects lift: the install band and the terminal window. Each carries a long, soft glow that sits low beneath it, tinted by what the object is (amber for the band, violet for the window), plus a short dark contact shadow. Everything else separates by a 1px `edge` line or the `window` fill, never by shadow.

### Shadow Vocabulary
- **Band glow** (`box-shadow: 0 14px 30px -18px rgba(242, 207, 115, 0.32), 0 2px 6px rgba(0, 0, 0, 0.35)`): the approval band at rest.
- **Band glow, done** (`box-shadow: 0 14px 30px -18px rgba(143, 227, 163, 0.34), 0 2px 6px rgba(0, 0, 0, 0.35)`): the band after the command is copied.
- **Window lift** (`box-shadow: 0 26px 40px -22px rgba(0, 0, 0, 0.85), 0 18px 36px -26px rgba(111, 95, 214, 0.45)`): the terminal window, for the session and the film.

### Named Rules
**The Two Frames Rule.** Only the approval band and the terminal window cast a shadow. Lists, tables, code blocks, readings and the table of contents stay flat on hairlines.

## Shapes

Soft rounded rectangles drawn with a 1px line, as the TUI draws its frames with rounded box-drawing corners. Radius grows with the object: 4px (`xs`) for readings, inline code and the focus ring; 6px (`sm`) for band choices, the language switch, the skip link; 8px (`md`) for code blocks, table frames and the phone table of contents; 10px (`lg`) for the install band and figure images; 12px (`xl`) for the terminal window. Full round is kept for the release tag pill and the film's play ring. The nav mark is a single raindrop (9 × 14px, sky to lavender).

**The Border Title Rule.** A frame that asks names itself in its top border: the title (`─ Allow bash`) sits on a night patch cut into the top-left edge, and the key hint (`y · a · n ──`) into the bottom-right edge, exactly as the TUI's approval box.

## Components

### Install Band (signature)
The command asked the way bruine asks: a framed amber request with a letter per answer.
- **Frame:** full column width, 1px amber border, 10px radius, night fill under a faint amber wash (7% to 2%), band glow. Title in bold amber and key hint in muted text are set into the top and bottom borders.
- **Body:** the command in `command` type after a faint `$ `; below it three choices, each a pointer (`›`), a bold amber key and a label: y copies, a switches installer (npm, pnpm, bun), n opens the guide.
- **States:** the current or hovered choice shows the pointer (fades in, slides 4px), turns text-coloured and gets an 8% amber fill; pressed is 16%. The letters answer from the keyboard while the band is at least 60% visible or focused.
- **Done:** on copy, border, title and glow turn mint over 300ms, a mint `✓` status line appears, and three lavender rings ripple in the rain at the band's left. The band appears twice on the home page: under the hero line and at the close.

### Terminal Window
- **Frame:** `window` fill, 1px edge, 12px radius, window lift shadow, clipped.
- **Bar:** mono 0.75rem in faint, a title centred and ellipsised (`bruine · ~/code/api`), and on the right a lavender timestamp in tabular figures that tracks the scrub.
- **Body:** the recorded screen in `terminal` type. Modes swap over 500ms: dark (default), light (the light-theme fill, fg and edge), weather (the effort still over the window fill, faded in).
- **Film:** the same window holds the film, with a lavender play ring (48–64px, 1px border at 70%) on a bottom-darkening wash; on hover the ring scales to 1.06 and fills 16% lavender.

### Readings
Small status chips copied from the TUI's status line: mono 0.875rem, `window` fill, 1px edge, 4px radius. Colour is the reading's job: sky for a measurement (tok/s), mint for something kept (cache), amber for the Ask mode.

### Links
- **Inline:** sky, 1px underline at 40% sky offset 0.22em; hover turns violet-light with a solid underline (160ms).
- **More link:** mono 0.9375rem, at least 44px, with an arrow that moves 3px right on hover.
- **Focus:** 2px sky outline, 3px offset, 4px radius, everywhere.

### Navigation
Mono 0.875rem in one row: the raindrop and bold `bruine` at the left, links in muted at the right turning text-coloured on hover or when current, a GitHub mark (label hidden under 860px), and an `en / fr` switch in a 6px edge-bordered box with the other language in lavender. A lavender skip link drops in on focus. The footer repeats the links in muted Inter under a hairline, with the version in faint mono.

### Lists and Tables
- **Promise rows, FAQ, fit tables, releases:** hairline-divided rows (see The Hairline List Rule). FAQ questions are mono bold with a lavender `›` that rotates 90° when open; answers are muted.
- **Refusals:** a 1.5rem pink mono `×` column before each item.
- **Tables:** inside a 1px edge frame with 8px radius, mono 0.8125rem headers on the `window` fill, hairline rows, tabular figures. In the compare table the bruine column carries a 6% lavender wash and a lavender header; the first column is sticky.
- **Code:** inline code on `surface` in violet-light; blocks on `window` with a 1px edge and 8px radius, 0.875rem, 1.6 leading.

### Session Chapters
Text beside the pinned terminal. Inactive chapters sit in muted with faint titles; the active one turns text-coloured with a violet-light title (300ms).

## Do's and Don'ts

### Do:
- **Do** keep amber for asking: the install band and the Ask permission mode only.
- **Do** set every heading, label, command and reading in JetBrains Mono, and prose in Inter at the 68ch measure.
- **Do** draw frames as the TUI does: 1px line, rounded corners, the title cut into the top border.
- **Do** divide grouped content with 1px `edge` hairlines.
- **Do** fill every terminal window with output recorded from the running app, laid out on its own cell grid and scaled whole.
- **Do** let motion be weather: the scroll scrub, rain intensity that follows the session (drizzle at 0.16, still while bruine waits for an answer, storm and lightning in the weather chapter), and one ripple on copy, all easing on `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Do** stop all of it under reduced motion: the rain is drawn once and never moves.

### Don't:
- **Don't** add a light page theme; light lives only inside the terminal window.
- **Don't** use amber for emphasis, warnings or decoration that does not ask.
- **Don't** set a heading in Inter or a paragraph of prose in mono.
- **Don't** lay grouped facts out as a grid of equal bordered cards.
- **Don't** put a shadow on anything but the install band and the terminal window.
- **Don't** set text dimmer than `faint`.
- **Don't** let the rain take input or sit in front of content: it is fixed, behind, and `pointer-events: none`.
