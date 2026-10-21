# Line spacing (leading) — what was changed and why

Date: 7 October 2026
Commit: `38e1f84` (`client/app/globals.css`, `client/components/ui/Button.tsx`)

## The problem

Lines of text in headings sat too close to each other. It was worst in the
home hero headline, but the same thing happened in page titles, section
headings and card titles, in all four languages (English, Georgian, Russian,
Hebrew).

The cause was the `line-height` values in the type scale. They were set very
tight (0.98–1.2), which only works for a headline that stays on one line. As
soon as a heading wrapped onto two lines, the bottom of the letters on the
first line (g, y, p, р, у, ღ, ყ) reached the top of the letters on the second
line (b, d, h, б, ლ, ქ).

## What was done

### 1. Measured the real gap

Instead of guessing, the gap was measured in a real browser (headless Chrome).
"Clear gap" below means the empty space between the lowest letter of one line
and the tallest letter of the next line.

Two passes:

1. **Home hero only** — 4 languages × 7 screen widths (320, 375, 430, 768,
   1024, 1440, 1920px), measured from screenshots pixel by pixel.
2. **Whole site** — every text block that wraps onto two or more lines, on 21
   routes × 4 languages × 4 widths (320, 375, 768, 1440px).

What the measurement showed before the fix:

| Style | English | Georgian | Russian | Hebrew |
|---|---|---|---|---|
| Home hero headline | 0px | 5–12px | 0px | 3px |
| Page titles (`type-h1`) | 0px | 7px | lines overlap | lines overlap |
| Section headings (`type-h2`) | 3px | 6px | 1px | 2px |
| Card titles (`type-h3`) | 4px | 7px | 3px | — |
| Sub-labels (`type-h4`) | 6px | 5px | 6px | 5px |
| Wrapped button label | 7px | 3px | 7px | — |

Body text, captions and small text were already fine (6–10px clear gap), so
they were **not** changed.

### 2. Changed the line-height values

All in `client/app/globals.css`. Before → after:

| Style | English | Georgian | Russian | Hebrew |
|---|---|---|---|---|
| Home hero headline (`type-display`) | 0.98 → 1.12 | 1.06 → 1.24 | 0.98 → 1.18 | 0.98 → 1.20 |
| Page titles (`type-h1`) | 1.04 → 1.16 | 1.12 → 1.28 | 1.04 → 1.22 | 1.04 → 1.22 |
| Section headings (`type-h2`) | 1.10 → 1.20 | 1.16 → 1.32 | 1.10 → 1.26 | 1.10 → 1.26 |
| Card titles (`type-h3`) | 1.20 → 1.28 | 1.26 → 1.36 | 1.20 → 1.32 | 1.20 → 1.32 |
| Sub-labels (`type-h4`) | 1.35 (same) | 1.35 → 1.45 | 1.35 (same) | 1.35 (same) |

And one change in `client/components/ui/Button.tsx`:

| Style | English / Russian / Hebrew | Georgian |
|---|---|---|
| Button label that wraps to two lines | 1.25 (same) | 1.25 → 1.375 |

A one-line button keeps exactly its old height, because buttons have a minimum
height that is taller than one line of text.

### 3. Why each language has its own number

The same `line-height` does not give the same gap in every script:

- **English** uses the Fraunces font. Its tallest and lowest letters together
  are exactly as tall as the font size, so everything above `1.0` is clear gap.
- **Georgian** uses Noto Sans Georgian. Almost every Georgian letter goes
  either up or down, so both edges of every line are busy. The same gap looks
  tighter than in English, so Georgian gets about twice as much.
- **Russian and Hebrew** headings fall back to Times New Roman (Fraunces has no
  Cyrillic or Hebrew letters). Its letters are about 6% taller from top to
  bottom, so these two languages get a little more than English.

Smaller headings get a bigger number than larger ones. That is on purpose: it
keeps the gap from shrinking to almost nothing in pixels at small sizes.

## Result

Clear gap between lines after the fix:

| Style | English | Georgian | Russian | Hebrew |
|---|---|---|---|---|
| Home hero headline, phone | 5px | 12px | 4.5px | 5–11px |
| Home hero headline, desktop | 13px | 29px | 11px | 13px |
| Page titles | 5–8px | 12–20px | 6–10px | 6–9px |
| Section headings | 6–9px | 10–15px | 6–9px | 7–10px |
| Card titles | 5–6px | 8–9px | 6–7px | 7px |
| Sub-labels | 6px | 6.6px | 6px | 5px |
| Wrapped button label | 7px | 4.6px | 4px | — |

The Hebrew home headline fits on one line on desktop, so its hero numbers also
include the 404 page headline, which uses the same style and wraps to two
lines.

The tightest heading pair anywhere on the audited pages is now about 4.5px
(before: 0px or overlapping).

## Checks that were run

- No horizontal scrolling on any audited page, in any language, at any width.
- No text cut off by its box. (The audit only reported screen-reader-only
  labels, which are hidden on purpose.)
- Line breaks in the home hero did not change.
- `eslint` passes on `Button.tsx`.
- Screenshots were reviewed by eye for the hero, page titles, section headings
  and card titles in all four languages, at phone and desktop width.

Side effect: because headings are taller, pages that have wrapped headings are
a little taller too (the home hero by 10–26px on phones).

## What was NOT checked

- **Admin panel, partner portal, driver panel and checkout pages.** They need a
  login or the real API, which does not run on the local machine (no Postgres /
  Docker). They use the same heading styles, so they get the new spacing, but
  nobody has looked at them rendered.
- **`/destinations`, `/destinations/tbilisi`, `/experiences`.** These returned
  the 404 page locally, so only the 404 layout was checked there.

## Problem found but not fixed

**Hebrew never uses the Hebrew web font (Noto Sans Hebrew).** The font is
declared but never downloaded. Hebrew headings render in Times New Roman and
Hebrew body text in Arial.

Why: in the font stack in `globals.css`, the Georgian font comes before the
Hebrew one, and `next/font` adds an automatic "fallback" font next to each
real font. That fallback is a local system font (Arial / Times New Roman) that
covers every character, including Hebrew — so the browser stops there and
never reaches Noto Sans Hebrew.

It was left alone because fixing it changes the look of every Hebrew page, so
it should be its own task. When it is fixed, the Hebrew line-height values in
this document should be measured again.

## How to change the spacing later

All the numbers live in one place: `client/app/globals.css`.

- English (default): the `.type-display`, `.type-h1`, `.type-h2`, `.type-h3`
  rules in the **TYPE SCALE** section.
- Georgian: the `:lang(ka)` rules in the **GEORGIAN TYPE** section.
- Russian and Hebrew: the `:lang(ru)` / `:lang(he)` rules in the
  **RUSSIAN AND HEBREW DISPLAY** section.
- Georgian button labels: `[&:lang(ka)]:leading-snug` in
  `client/components/ui/Button.tsx`.

To make lines further apart, raise the number; to bring them closer, lower it.
A change of `0.02` is about 2px at the desktop hero size and under 1px on a
phone. Keep Georgian higher than Russian/Hebrew, and Russian/Hebrew higher than
English, at every size.

## How the measurement was done (for next time)

The scripts were throwaway and are not in the repository. The method:

1. Run the Next dev server (`npm run dev` in `client/`).
2. Run a small mock API on port 5000 that serves the seed data from
   `server/db/seed/`, so tours, hotels, packages and transfers pages render
   without a database.
3. Open each page in headless Chrome with `playwright-core`, at each width and
   in each language, with reduced motion on (otherwise sections below the fold
   stay invisible).
4. For every element whose text wraps onto two or more lines, read the
   line-height and font size, then measure how far the letters of each line
   really reach up and down (canvas `measureText`). The clear gap is
   `line-height − descent of the upper line − ascent of the lower line`.
5. Group the results by language and style and sort from tightest to loosest.

The canvas method was checked against the pixel measurement of the home hero
and agreed within 1px.
