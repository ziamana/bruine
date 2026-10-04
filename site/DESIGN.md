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
  cloud-blue: "#4a70aa"
  cloud-violet: "#6f5fd6"
  window: "#11141e"
  clip-ground: "#0d1019"
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
    fontSize: "clamp(2rem, min(3.6vw, 6vh), 3.1rem)"
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
  card-title:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1.15rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  command:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "clamp(1.05rem, 2.6vw, 1.5rem)"
    fontWeight: 400
  button:
    fontFamily: "JetBrains Mono NL, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.9375rem"
    fontWeight: 700
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
  card: "14px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 4vw, 48px)"
  column: "1280px"
  measure: "68ch"
  step: "clamp(5.5rem, 12vw, 10rem)"
  card-pad: "clamp(1.25rem, 2.5vw, 2rem)"
  grid-gap: "clamp(1rem, 2vw, 1.5rem)"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.night}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
    height: "44px"
  button-primary-hover:
    backgroundColor: "#ffffff"
    textColor: "{colors.night}"
  button:
    backgroundColor: "rgba(17, 20, 30, 0.7)"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
    height: "44px"
  button-hover:
    backgroundColor: "rgba(180, 167, 255, 0.1)"
    textColor: "{colors.text}"
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
  capability-card:
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "clamp(1.25rem, 2.5vw, 2rem) clamp(1.25rem, 2.5vw, 2rem) 0"
  dev-card:
    backgroundColor: "rgba(17, 20, 30, 0.5)"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
  copy-command:
    backgroundColor: "{colors.window}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.85rem 0.85rem 0.85rem 1rem"
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

The site is the terminal app's own world brought to page scale. A night ground lit by clouds from above holds a faint pastel rain that falls behind everything and never takes a click; on top of it sit the TUI's own framed windows, set in JetBrains Mono, with Inter carrying the prose between them. The page does not describe bruine from outside: it frames the real thing (a recorded session playing on its own, slices of the real terminal, the film) and asks the visitor in the same amber frame bruine uses when it asks before acting.

The composition follows the reference the user pinned (DeepSeek's Harness page): a centred offer under a lit night sky with the product window directly beneath it, then the amber install band, a scroll-scrubbed session, a 2x2 grid of capability cards each shown by the real terminal, two developer cards that each hold one command, and a centred close under a second glow. Cards are allowed, but they are earned: a card exists to hold a real terminal or a command, never icon-heading-text filler. Grouped facts (promises, FAQ, fit tables, releases) stay as rows on 1px hairlines. Colour is rationed by job: each pastel means one thing, and amber means only "this asks you". Motion is the weather: the hero window plays the recording, the scroll scrubs it, the rain follows what the page shows, and a copied command lands as a ring in the rain.

The theme is dark only, deliberately: the readers are terminal developers, often at night, and the brand is night rain. Light appears only inside a terminal window, when it shows the TUI's light theme.

**Key Characteristics:**
- Night ground with clouds lit from above at the top, a fixed violet glow, and pastel rain on a fixed canvas behind the page.
- JetBrains Mono for every heading, label, button, command and terminal; Inter only for running prose.
- Real terminal windows everywhere a product is shown, laid out on their own cell grid and scaled whole.
- Earned cards (14px, edge border, translucent night fill) that hold a real terminal demo or a command; hairline rows for everything else.
- Pill buttons: one light pill per region, the rest outlined.
- Amber reserved for asking; mint for done; pink for what bruine refuses.
- Motion that is weather: autoplay, scrub, rain intensity combined from every source, one ripple.

## Colors

A deep blue-black night carries five pastels from the terminal app, each with exactly one job, under a sky lit by two cloud tints.

### Primary
- **Rain Lavender** (`lavender`): the interactive accent. Text caret, native `accent-color`, list markers in prose, the FAQ chevron, outlined-button hover edge, the window timestamp, the film's play ring, the hover edge of the table of contents, the bruine column header in the compare table, the skip link fill, and the rings of the copy ripple.
- **Pale Violet** (`violet-light`): emphasis on dark. Link hover, the active chapter title in the session, the long line of providers, inline code, the dictionary line under the install band, and the right-hand values in fit tables.

### Secondary
- **Night Sky Blue** (`sky`): links and focus. Every link at rest (with a 40% underline that becomes solid on hover), the 2px focus outline, and the tok/s reading.

### Tertiary
- **Approval Amber** (`amber`): asking, and nothing else. The install band's border, title, keys, pointer and choice highlight; the `ask` mode reading. It is the TUI's approval frame colour.
- **Done Mint** (`mint`): something finished or kept. The band after a copy (border, title, glow, the status line), the cache reading, the release tag.
- **Refusal Pink** (`pink`): what bruine does not do. The drawn cross before each item in that list. Also one of the rain inks.

### Neutral
- **Night** (`night`): the page ground, the band's fill, the patch behind a title set into a border, the dark text on the light pill.
- **Night Glow** (`night-glow`): a radial wash at the top of the viewport (120% × 60% ellipse at 50% −10%, fading by 60%), fixed.
- **Cloud Blue** (`cloud-blue`) and **Cloud Violet** (`cloud-violet`): the lit clouds of the sky, only ever as soft radial light at low alpha. At the top of the page: a cloud-blue ellipse (780 × 460px at 24% 40px, 38%) and a cloud-violet one (720 × 420px at 74% 0, 28%) over a 820px fade of deep blue, painted on the page ground and scrolling away with it. At the close: the same pair as a radial glow behind the last line. Cloud violet also tints the window's lift shadow.
- **Terminal Window** (`window`): the terminal's own background; also code blocks, the copy-command well, table headers, readings, the film screen.
- **Clip Ground** (`clip-ground`): the ground behind a film clip shown inside a window, so the clip's own dark edges disappear into it.
- **Raised Surface** (`surface`): inline code, and the top stop of the capability card's gradient.
- **Edge** (`edge`): every 1px border and hairline, card and button outlines, the scrollbar thumb.
- **Text** (`text`): headings, active content, the command line, the fill of the primary pill.
- **Muted** (`muted`): secondary prose, leads, card bodies, nav links at rest, inactive chapters (7.5:1 on night).
- **Faint** (`faint`): the dimmest readable text: the band's `$ ` prompt, provider separators, window bar text, inactive chapter titles (5.8:1 on night). Nothing goes dimmer.
- **Light terminal** (`term-light-bg`, `term-light-fg`, `term-light-edge`): a window's colours while it shows the TUI's light theme. Never used outside a window.

### Named Rules
**The Amber Asks Rule.** Amber appears only where something asks for a decision: the install band and the Ask permission mode. A heading, a button, a highlight or a warning that does not ask is never amber.

**The One Job Rule.** Each pastel keeps its job across every page: sky is a link or focus, lavender is the interactive accent, mint is done, pink is refusal. A new element takes the colour of its job, not a colour for variety.

**The Night Only Rule.** The page is dark only (`color-scheme: dark`, theme colour night). Light exists only inside a terminal window when it shows the light theme; the light pill button is the one light surface on the page itself.

**The Lit Sky Rule.** Light comes from above, twice: the clouds at the top of the page and the glow behind the close, both in cloud blue and cloud violet at low alpha. Nothing else on the page glows except the band's and the window's own shadows.

## Typography

**Display Font:** JetBrains Mono NL (with ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)
**Body Font:** Inter, variable 100–900 (with system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Label/Mono Font:** JetBrains Mono NL, the same face as display

**Character:** The terminal speaks in mono, bold and tightly tracked at display sizes, so every heading reads like a line bruine printed; Inter sits between in a comfortable 1.65 leading for the human explanation. Both are self-hosted, OFL, the faces of the film.

### Hierarchy
- **Display** (700, `display`, 1.12, −0.035em): the one-line offer, centred in the hero, up to 30ch. The closing line uses the same voice at its largest (clamp(2.25rem, 5.5vw, 4.25rem), −0.04em); a document title uses clamp(2rem, 4.4vw, 3.25rem).
- **Headline** (700, `headline`, 1.12, −0.02em): section titles, balanced. The capability title is the same size, centred on two lines. Inside the session stage and documents it steps down (clamp(1.6rem, 2.6vw, 2.25rem); clamp(1.4rem, 2.6vw, 1.85rem)).
- **Title** (700, 1.25rem, −0.01em): promise titles, FAQ questions (1.0625rem), document subsections (1.1rem); session chapter titles at clamp(1.2rem, 1.9vw, 1.5rem).
- **Card Title** (700, 1.15rem, −0.01em): the heading of a capability or developer card.
- **Command** (400, `command`): the install command inside the band, prefixed by a faint `$ `.
- **Button** (700, 0.9375rem, mono): every pill button.
- **Body** (400, 1.0625rem, 1.65): prose, capped at the 68ch measure; chapter text at 40ch; card bodies at 0.975rem and 52ch in muted.
- **Body Lead** (400, 1.125rem, muted): the paragraph under a section title; the hero lead runs clamp(1.02rem, 1.25vw, 1.125rem) at 64ch, two lines.
- **Label** (mono, 0.75–0.875rem): nav, install facts, band title and keys, readings, copy buttons, table headers, window bar, table of contents.
- **Terminal** (400, 16px, 1.32): the recorded screen, laid out on its own cell grid (104 columns, 56 on phones and in every capability demo) and scaled to its window as a whole, ligatures off.

### Named Rules
**The Mono Speaks Rule.** Every heading, label, key, button, command and reading is set in JetBrains Mono; Inter is for paragraphs a person reads. No heading is ever set in Inter.

**The Real Grid Rule.** The terminal is never reflowed or re-set at a smaller font: it is laid out at 16px on its own cell grid and scaled as one block, so every column of the recording lands where the app drew it.

## Layout

One centred column: content max 1280px (`column`) plus a fluid gutter (`gutter`, 16px on phones up to 48px), shared by nav, page and footer. Sections are separated by the large vertical `step` (5.5rem to 10rem) rather than by rules or bands of colour. Running text stops at the 68ch `measure`; section heads at 46rem; the install band at 56rem; the "does not do" and FAQ sections at 50rem.

The home page reads top to bottom: the centred hero (offer, lead, one light pill, then the terminal window up to 1040px wide, with clamp(1.25rem, 3vh, 2.25rem) above it); the install band; the session; the capability grid; the film; models and promises; the developer cards; what bruine does not do; the FAQ; the centred close. Hero and close are centred; everything between is left-aligned in the column, except the centred capability title.

The session is a two-column stage (2.6fr terminal, 1fr for the head and chapters, gap up to 4rem). The terminal pins at `max(2rem, 50vh − 15rem)` from the top while chapters scroll past it; each chapter is at least 78vh tall with 22vh above its text, and the chapter crossing 55% of the viewport owns the screen.

The capability and developer grids are two equal columns with a `grid-gap` of 1rem to 1.5rem. Reading pages use a 13rem sticky table of contents beside a 46rem prose column.

Breakpoints: at 860px both card grids go to one column; the session stacks (head, terminal, chapters), the terminal pins to the very top with a night fade beneath it, a 56-column recording replaces the 104-column one in the hero and the session, each chapter's text sticks just under the terminal, promise rows and the reading layout collapse to one column, and the table of contents becomes a bordered two-column box. At 520px the nav drops its third link, band choices grow to 44px, the window title hides, and the contents list goes to one column. Pill buttons, nav links, "more" links and phone band choices are at least 44px tall.

**The Hairline List Rule.** Grouped facts (promises, FAQ, fit tables, releases, refusals) are rows divided by 1px `edge` hairlines or simple lists, never cards.

**The Earned Card Rule.** A card exists only to hold a real terminal demo or a command to copy. Cards come in pinned grids of equal columns (two across); a card that would hold only an icon, a heading and a sentence is a hairline row instead.

## Elevation & Depth

The page is flat. Depth comes from layers in fixed order: the night ground with its lit sky, the rain canvas and lightning wash (fixed, behind, `pointer-events: none`), and the content. Only two objects lift: the install band and the terminal window. Each carries a long, soft glow that sits low beneath it, tinted by what the object is (amber for the band, cloud violet for the window), plus a short dark contact shadow. Cards do not lift: they separate by a 1px `edge` line and a translucent night fill. Everything else separates by a hairline or the `window` fill.

### Shadow Vocabulary
- **Band glow** (`box-shadow: 0 14px 30px -18px rgba(242, 207, 115, 0.32), 0 2px 6px rgba(0, 0, 0, 0.35)`): the approval band at rest.
- **Band glow, done** (`box-shadow: 0 14px 30px -18px rgba(143, 227, 163, 0.34), 0 2px 6px rgba(0, 0, 0, 0.35)`): the band after the command is copied.
- **Window lift** (`box-shadow: 0 26px 40px -22px rgba(0, 0, 0, 0.85), 0 18px 36px -26px rgba(111, 95, 214, 0.45)`): every terminal window: the hero, the session, the capability demos and the film.

### Named Rules
**The Two Frames Rule.** Only the approval band and the terminal window cast a shadow. Cards, buttons, lists, tables, code blocks, readings and the table of contents stay flat.

## Shapes

Soft rounded rectangles drawn with a 1px line, as the TUI draws its frames with rounded box-drawing corners. Radius grows with the object: 4px (`xs`) for readings, inline code and the focus ring; 6px (`sm`) for band choices, copy buttons, the language switch, the skip link; 8px (`md`) for code blocks, the copy-command well, table frames and the phone table of contents; 10px (`lg`) for the install band and figure images; 12px (`xl`) for the terminal window; 14px (`card`) for cards, the largest frame on the page. Full round (`pill`) is kept for buttons, the release tag and the film's play ring. The nav mark is a single raindrop (9 × 14px, sky to lavender). Icons are drawn SVG at one 1.5px stroke with round caps (chevron, cross, arrow); the GitHub mark is GitHub's own.

**The Border Title Rule.** A frame that asks names itself in its top border: the title (`─ Allow bash`) sits on a night patch cut into the top-left edge, and the key hint (`y · a · n ──`) into the bottom-right edge, exactly as the TUI's approval box.

**The Bleed Rule.** A terminal inside a card has no padding below it: the window sits at the card's bottom edge with its own bottom corners squared, so it reads as continuing past the card.

## Components

### Buttons
Pills in mono, quiet until touched.
- **Shape:** full pill (999px), at least 44px tall, 0 1.25rem padding, 700 0.9375rem mono, optional 16px icon at 0.5rem gap.
- **Primary:** the light pill: `text` fill and border, `night` text. On hover it brightens to white and rises 1px (180ms).
- **Outlined:** translucent window fill (70%), 1px `edge` border, `text` label; on hover the border turns lavender and the fill takes a 10% lavender wash.
- **Focus:** the 2px sky outline, 3px offset.

**The One Light Pill Rule.** Each region has at most one primary light pill (Install bruine in the hero; View on GitHub at the close); every other action beside it is an outlined pill.

### Install Band (signature)
The command asked the way bruine asks: a framed amber request with a letter per answer.
- **Frame:** full width of its 56rem column, 1px amber border, 10px radius, night fill under a faint amber wash (7% to 2%), band glow. Title in bold amber and key hint in muted text are set into the top and bottom borders.
- **Body:** the command in `command` type after a faint `$ `; below it three choices, each a pointer (`›`), a bold amber key and a label: y copies, a switches installer (npm, pnpm, bun), n opens the guide.
- **States:** the current or hovered choice shows the pointer (fades in, slides 4px), turns text-coloured and gets an 8% amber fill; pressed is 16%. The letters answer from the keyboard while the band is at least 60% visible or focused.
- **Done:** on copy, border, title and glow turn mint over 300ms, a mint status line appears, and three lavender rings ripple in the rain at the band's left. Under the band, the install facts in mono label and the dictionary line in italic violet-light.

### Terminal Window
- **Frame:** `window` fill, 1px edge, 12px radius, window lift, clipped.
- **Bar:** mono 0.75rem in faint, three columns: the window lights (three 10px dots, #ff6159, #ffbd2e, #28c941, which never leave the bar), a centred ellipsised title (`bruine · ~/code/api`), and a lavender timestamp in tabular figures that tracks playback or the scrub (empty on stills).
- **Body:** the recorded screen in `terminal` type, scaled whole. Dark by default; light mode swaps to the light-terminal fill, ink and edge over 500ms.
- **Hero:** autoplays the recorded session from the prompt to the queued message, holds 2.6s on the last frame, loops; pauses off screen; rests on the last frame under reduced motion.
- **Film:** the same window holds the film, with a lavender play ring (48–64px, 1px border at 70%) on a bottom-darkening wash; on hover the ring scales to 1.06 and fills 16% lavender.

### Capability Card (signature)
One claim, shown by the real terminal.
- **Frame:** 14px radius, 1px edge, a top-lit gradient from `surface` at 55% to `window` at 35%, clipped, no shadow. Padding `card-pad` on top and sides, none at the bottom.
- **Content:** a card title and a muted body, then the demo: a terminal window bleeding off the card's bottom edge (The Bleed Rule).
- **Demo size:** every demo is the same box, 56 columns × 16 rows of the real terminal, sliced from the part of the still that carries the point (retry, image, light theme). A film clip (the max-effort prompt for the weather) takes the identical box, aspect 33.6 / 21.12, contained on `clip-ground`.

### Developer Card
- **Frame:** 14px radius, 1px edge, flat window fill at 50%, `card-pad` all round, no shadow.
- **Content:** card title, muted body, then a copy command.
- **Copy command:** a `window` well with 1px edge and 8px radius, the command in mono 0.875rem/1.6 after a `$ `, scrolling sideways rather than wrapping; beside it a 6px-radius outlined mono button in muted that turns text-coloured with a lavender edge on hover, and says Copied for 2.2s after a copy.

### Readings
Small status chips copied from the TUI's status line: mono 0.875rem, `window` fill, 1px edge, 4px radius. Colour is the reading's job: sky for a measurement (tok/s), mint for something kept (cache), amber for the Ask mode.

### Links
- **Inline:** sky, 1px underline at 40% sky offset 0.22em; hover turns violet-light with a solid underline (160ms).
- **More link:** mono 0.9375rem, at least 44px, with a drawn 14px arrow that moves 3px right on hover.
- **Focus:** 2px sky outline, 3px offset, 4px radius, everywhere.

### Navigation
Mono 0.875rem in one row: the raindrop and bold `bruine` at the left, links in muted at the right turning text-coloured on hover or when current, a GitHub mark (label hidden under 860px), and an `en / fr` switch in a 6px edge-bordered box with the other language in lavender. A lavender skip link drops in on focus. The footer repeats the links in muted Inter under a hairline, with the version in faint mono.

### Lists and Tables
- **Promise rows, FAQ, fit tables, releases:** hairline-divided rows (see The Hairline List Rule). FAQ questions are mono bold with a drawn lavender chevron that rotates 90° when open (220ms); answers are muted.
- **Refusals:** a 1.5rem column holding a drawn 12px pink cross before each item.
- **Tables:** inside a 1px edge frame with 8px radius, mono 0.8125rem headers on the `window` fill, hairline rows, tabular figures. In the compare table the bruine column carries a 6% lavender wash and a lavender header; the first column is sticky.
- **Code:** inline code on `surface` in violet-light; blocks on `window` with a 1px edge and 8px radius, 0.875rem, 1.6 leading.

### Session Chapters
Text beside the pinned terminal: ask, think, queue, approve, always, done. Inactive chapters sit in muted with faint titles; the active one turns text-coloured with a violet-light title (300ms).

### Close
Centred: the closing line in the largest display voice, a muted lead at 58ch, then a row of pills (one light, the rest outlined), over the cloud glow (a radial ellipse 50% × 55% at 50% 60%, cloud blue at 30% into cloud violet at 12%, gone by 72%).

## Do's and Don'ts

### Do:
- **Do** keep amber for asking: the install band and the Ask permission mode only.
- **Do** set every heading, label, button, command and reading in JetBrains Mono, and prose in Inter at the 68ch measure.
- **Do** draw frames as the TUI does: 1px line, rounded corners, the title cut into the top border.
- **Do** divide grouped facts with 1px `edge` hairlines.
- **Do** give every card a real terminal demo bleeding off its bottom edge or a command to copy, at 14px radius with a 1px `edge` border and a translucent night fill, in a grid of equal columns.
- **Do** size every capability demo at 56 columns × 16 rows, and give a film clip the same box (33.6 / 21.12) on `clip-ground`.
- **Do** fill every terminal window with output recorded from the running app, laid out on its own cell grid and scaled whole.
- **Do** use one light pill per region and outline the rest.
- **Do** draw icons as SVG at one 1.5px stroke with round caps.
- **Do** let motion be weather: the hero autoplay, the scroll scrub, rain intensity that follows the page (drizzle at 0.16, still while the session waits for an approval, a storm with lightning while the weather card is more than 55% on screen), and one ripple on copy, all easing on `cubic-bezier(0.16, 1, 0.3, 1)`. Every part of the page claims weather under its own name and the sky combines them: the strongest rain, lightning if any asks, stillness if any waits.
- **Do** stop all of it under reduced motion: the rain is drawn once and never moves, the hero rests on its last frame.

### Don't:
- **Don't** add a light page theme; light lives only inside the terminal window and in the one light pill.
- **Don't** use amber for emphasis, buttons, warnings or decoration that does not ask.
- **Don't** set a heading in Inter or a paragraph of prose in mono.
- **Don't** make a card of an icon, a heading and a sentence; without a real terminal or a command, it is a hairline row.
- **Don't** put two light pills in one region.
- **Don't** put a shadow on anything but the install band and the terminal window; cards stay flat.
- **Don't** reflow or re-set a terminal to fit a card; slice whole rows and scale the grid.
- **Don't** set text dimmer than `faint`.
- **Don't** let the rain take input or sit in front of content: it is fixed, behind, and `pointer-events: none`.
