# I'am Georgia — Visual Design System for the Mobile App

> **Purpose.** This is the brand and visual language of the I'am Georgia website, carried over to native mobile (iOS and Android). It covers **identity, logo, colour, typography, iconography, imagery, elevation, shape, motion and the visual treatment of components**. It does **not** cover screens, navigation or information architecture. The app gets its own structure, and this document makes sure it looks and feels like the same brand.
>
> **Source of truth.** Every value here comes from the website code: `client/app/globals.css` (design tokens), `client/components/layout/Logo.tsx` and `client/app/icon.svg` (the mark), `client/app/[locale]/layout.tsx` (fonts) and `client/components/ui/*` (component styling). Contrast ratios were measured, not estimated.
>
> **Labels used in this document**
> - **[WEB]**: exactly what the website does. Keep it.
> - **[APP]**: translation of a web value into native units or conventions.
> - **[PROPOSAL]**: does not exist on the website yet (for example dark mode, adaptive icon). It is a recommendation and needs sign-off.
>
> Last updated: 2026-10-26.

---

## Contents

1. [Brand essence](#1-brand-essence)
2. [Logo](#2-logo)
3. [App icon and splash](#3-app-icon-and-splash)
4. [Colour](#4-colour)
5. [Dark mode](#5-dark-mode-proposal)
6. [Typography](#6-typography)
7. [Multilingual and RTL type rules](#7-multilingual-and-rtl-type-rules)
8. [Spacing and grid](#8-spacing-and-grid)
9. [Shape (corner radius)](#9-shape-corner-radius)
10. [Elevation and shadow](#10-elevation-and-shadow)
11. [Iconography](#11-iconography)
12. [Photography and imagery](#12-photography-and-imagery)
13. [Motion](#13-motion)
14. [Component visual language](#14-component-visual-language)
15. [Accessibility](#15-accessibility)
16. [Design tokens (JSON)](#16-design-tokens-json)
17. [Platform mapping (Material 3 and iOS)](#17-platform-mapping-material-3-and-ios)
18. [Open decisions](#18-open-decisions)

---

## 1. Brand essence

| | |
|---|---|
| **Name** | I'am Georgia. Written exactly like this in running text, with the apostrophe after the *I*. |
| **Wordmark** | `I'AM GEORGIA`, always uppercase in the lockup. Not translated in any language. |
| **Tagline** | EN *Discover Georgia Beyond the Ordinary* · KA *აღმოაჩინე საქართველო ჩვეულებრივის მიღმა* · RU *Откройте Грузию за пределами обычного* · HE *לגלות את גאורגיה מעבר לרגיל* |
| **Character** | Warm, editorial, unhurried, premium but not luxury-cold. It should read like a travel magazine, not a booking engine. |
| **Visual idea** | A warm orange sun-tile over the Caucasus ridge. Warm white ground, charcoal ink, photography carrying the emotion. |
| **Languages** | English, Georgian (ka), Russian (ru), Hebrew (he, right-to-left). All four are first-class. Nothing may look "translated but not designed". |

### The 60 / 25 / 10 / 5 rule [WEB]

Orange is the **signature, not the page**. Across any screen, aim for roughly:

| Share | What |
|---|---|
| **60%** | Warm neutrals: background `#FFF9F3`, surfaces, earth tones |
| **25%** | Charcoal ink `#20201D` and photography |
| **10%** | Brand orange `#EB6830`, used for primary actions, active states, highlights |
| **5%** | Supporting accents: green (nature), gold (ratings) |

If a screen looks orange, it is wrong. Orange should point at the one thing the user should do next.

---

## 2. Logo

### 2.1 The mark [WEB]

A rounded orange tile. A warm-white Caucasus ridge rises from the bottom-left corner, runs across two peaks and leaves the right edge. A warm-white sun sits in the top-right corner.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="#EB6830"/>
  <circle cx="25.5" cy="7" r="3" fill="#FFF9F3"/>
  <path d="M0 32 L10.5 10 L17.5 20.5 L22.5 14 L32 30 L32 32 Z" fill="#FFF9F3"/>
</svg>
```

| Element | Value |
|---|---|
| Grid | 32 × 32 units |
| Tile | `#EB6830` (Brand 500), corner radius 7 units (≈ 22% of the side, very close to the iOS icon squircle) |
| Ridge | `#FFF9F3` (warm white). Peaks at (10.5, 10) and (22.5, 14), valley at (17.5, 20.5) |
| Sun | `#FFF9F3`, centre (25.5, 7), radius 3 |

**Construction rule.** The ridge **must bleed off the left, bottom and right edges**. An earlier version had the ridge floating inside the tile, and it read as the generic "image placeholder" icon. Never inset it.

**Colours are literal.** The logo uses hard-coded hex values, not theme tokens, so it never shifts when a UI colour is retuned (or when the app switches to dark mode).

> ⚠️ **Provenance.** This mark was drawn for the website from the brand palette (see `client/FRONTEND.md` §3). If official logo artwork exists, it supersedes this section. Swap the SVG and keep every other rule in this document.

### 2.2 Wordmark [WEB]

| Property | Value |
|---|---|
| Text | `I'AM GEORGIA` |
| Typeface | **Fraunces Medium (500)** |
| Tracking | **+0.06em** (≈ +1.1 pt at 18 pt) |
| Line height | 1.0 |
| Case | Uppercase, set as typed. Do not rely on an automatic text transform. |
| Colour | `#20201D` on light grounds · `#FFF9F3` on dark grounds and over photography |

### 2.3 Lockups

| Lockup | Mark | Wordmark | Gap | Where on web |
|---|---|---|---|---|
| **Horizontal, compact** | 32 pt | 18 pt | 10 pt | Header on phones |
| **Horizontal, large** | 40 pt | 18–20 pt | 12 pt | Footer (on charcoal) |
| **Mark only** | ≥ 24 pt | — | — | Favicon, avatars, tight spaces |

[APP] Use the compact horizontal lockup for the top app bar or onboarding. Use mark-only for small surfaces such as notification icons, map pins and chat avatars.

### 2.4 Clear space and minimum size

- **Clear space:** keep at least **¼ of the mark's width** empty on all sides (8 pt around a 32 pt mark). Nothing else may enter it: text, icons, edges of a card.
- **Minimum size:** mark **16 pt**. Below 24 pt drop the wordmark and use the mark alone.
- **Wordmark minimum:** 13 pt. Below that the tracking closes up and the apostrophe disappears.

### 2.5 Logo on backgrounds

| Background | Treatment |
|---|---|
| Warm white `#FFF9F3` / white | Standard mark + ink wordmark |
| Charcoal `#20201D` | Standard mark + warm-white wordmark |
| Photography | Standard mark + warm-white wordmark, **only over a scrim** (§12.3) |
| Brand orange | ❌ Not allowed. The tile disappears. Use a white or charcoal panel. |

### 2.6 Don'ts

- ❌ Don't recolour the tile, the ridge or the sun, and don't swap the warm white for pure `#FFFFFF`.
- ❌ Don't add a stroke, gradient, glow or shadow to the mark.
- ❌ Don't **mirror** the mark in RTL (Hebrew). Logos are never mirrored.
- ❌ Don't rotate, skew or stretch it, and don't change the corner radius except where the platform masks the icon (§3).
- ❌ Don't set the wordmark in any typeface other than Fraunces, and don't translate it.
- ❌ Don't place it on busy photography without a scrim.

---

## 3. App icon and splash

### 3.1 iOS app icon [APP]

- Master: **1024 × 1024 px**, opaque, **no rounded corners**. iOS applies its own mask.
- Use the mark with the tile as a full square (drop `rx="7"`). The sun at its original position sits safely inside the iOS corner curve.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#EB6830"/>
  <circle cx="25.5" cy="7" r="3" fill="#FFF9F3"/>
  <path d="M0 32 L10.5 10 L17.5 20.5 L22.5 14 L32 30 L32 32 Z" fill="#FFF9F3"/>
</svg>
```

- **iOS 18+ dark / tinted icons [PROPOSAL]:** for dark, use a `#141311` background with an orange `#EB6830` ridge and sun. For tinted, use a monochrome ridge and sun on transparent.

### 3.2 Android adaptive icon [PROPOSAL]

Android masks icons to a circle, squircle or rounded square. **The original sun position gets clipped by a circular mask**: at the web position its outer edge sits about 3 dp outside the 66 dp safe zone. The adaptive variant moves the sun inward to (24, 9), which keeps the composition and clears the safe zone with 2.3 dp to spare.

- **Background layer:** solid `#EB6830`.
- **Foreground layer (108 × 108 dp):** the ridge is extended past the edges so parallax and zoom effects never reveal a gap.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <g transform="translate(18 18) scale(2.25)">
    <circle cx="24" cy="9" r="3" fill="#FFF9F3"/>
    <path d="M-3.8 40 L10.5 10 L17.5 20.5 L22.5 14 L37.9 40 Z" fill="#FFF9F3"/>
  </g>
</svg>
```

- **Monochrome layer (Android 13+ themed icons):** the same foreground, single colour, transparent background.
- **Notification small icon:** ridge and sun as a white silhouette on transparent, 24 × 24 dp. Android tints it, so no orange.

### 3.3 Splash / launch screen [PROPOSAL]

| | Light | Dark |
|---|---|---|
| Background | `#FFF9F3` | `#141311` |
| Icon | Full orange tile mark, centred | Full orange tile mark, centred |
| Size | Android 12+: per the SplashScreen API (icon within the 240 dp / 160 dp mask). iOS: mark ≈ 96 pt | same |

No tagline, no spinner, no wordmark on the launch screen. Keep it a single calm frame. If an animation is wanted, the only brand-appropriate one is the **sun rising** behind the ridge (≤ 600 ms, `ease-out-soft`).

---

## 4. Colour

All values are **sRGB hex**. The palette is **warm throughout**. There is no cold grey and no pure `#FFFFFF` page anywhere. White `#FFFFFF` is used only for raised surfaces (cards, fields, sheets) and for labels on orange.

### 4.1 Brand orange [WEB]

| Token | Hex | RGB | Role |
|---|---|---|---|
| `brand-50` | `#FFF0E8` | 255 240 232 | Brand-soft tint: selected chips, highlight panels |
| `brand-100` | `#FFDECE` | 255 222 206 | Light tint, pressed state on soft surfaces |
| `brand-200` | `#FBC1A4` | 251 193 164 | Decorative / illustration |
| `brand-300` | `#F59E75` | 245 158 117 | Decorative, orange on dark surfaces |
| `brand-400` | `#F0804E` | 240 128 78 | Orange text and icons **on dark** (see §5) |
| **`brand-500`** | **`#EB6830`** | **235 104 48** | **THE brand colour. Logo, fills, icons, active states** |
| `brand-600` | `#C8501F` | 200 80 31 | Hover / pressed. Focus ring. Score badge |
| `brand-700` | `#B4471B` | 180 71 27 | **Orange text on light surfaces** |
| `brand-800` | `#8E3714` | 142 55 20 | Deep accent (rare) |
| `brand-900` | `#66270E` | 102 39 14 | Deepest accent (rare) |

**Semantic aliases. Use these, not the numbers:**

| Alias | → | Use |
|---|---|---|
| `brand` | `#EB6830` | Primary button fill, active tab icon, progress, selection, icons |
| `brand-pressed` (web: `brand-hover`) | `#C8501F` | Pressed state of anything filled with `brand` |
| `brand-text` | `#B4471B` | **Any orange text** on a light background (eyebrows, links, selected chip label) |
| `brand-soft` | `#FFF0E8` | Background of selected chips, info highlights, brand panels |

> **Rule:** `#EB6830` is **never** used for small text on a light ground (3.07:1, fails AA). Orange text always uses `brand-text #B4471B` (5.21:1).

### 4.2 Neutrals [WEB]

| Token | Hex | Role |
|---|---|---|
| `background` | `#FFF9F3` | App / screen background (warm white) |
| `surface` | `#FFFFFF` | Cards, input fields, list rows that sit on the background |
| `surface-soft` | `#FFF0E8` | Pressed/hover state of ghost and outline controls, soft panels |
| `surface-earth` | `#F1E8DE` | Editorial and cultural sections, alternating bands |
| `sand` | `#E8D6C2` | Georgian earth accent, skeleton loaders (at 70% opacity) |
| `line` | `#E8DED4` | Borders, dividers, hairlines |

### 4.3 Text [WEB]

Four tiers from strongest to weakest:

| Token | Hex | Use | On `#FFF9F3` |
|---|---|---|---|
| `ink` | `#20201D` | Headlines, primary text, dark sections, icons | **15.63 : 1** |
| `ink-soft` | `#2E2E29` | Pressed state of dark buttons | — |
| `body` | `#4A463F` | Body copy, paragraphs | **8.98 : 1** |
| `muted` | `#625F59` | Secondary text, metadata, captions | **6.09 : 1** |
| `subtle` | `#78716A` | Tertiary text: dates, small labels. **The floor.** | **4.60 : 1** |

> ⚠️ `subtle` must **not** be used on `surface-earth` or `sand` (3.97:1, fails). Use `muted` there (5.25:1).

### 4.4 On dark (charcoal sections, over photos) [WEB]

| Token | Hex | Use | On `#20201D` |
|---|---|---|---|
| `on-dark` | `#FFF9F3` | Primary text on charcoal / photography | **15.63 : 1** |
| `on-dark-muted` | `#CFC7BE` | Secondary text on charcoal | **9.77 : 1** |

On the web, softer levels on dark are made with opacity of `on-dark`: 75% (descriptions), 70% (secondary), 60% (eyebrows), 40% (decorative icons, outline borders).

### 4.5 Supporting accents [WEB]

| Token | Hex | Use | Never |
|---|---|---|---|
| `accent-green` | `#496458` | Nature and mountain *categories* (badge fill with warm-white text, 6.19:1) | Never as "success". A category isn't a status |
| `accent-gold` | `#B8873F` | Rating stars, premium markers on light (3.19:1, clears the 3:1 graphics minimum) | Never a background, never text |
| `accent-gold-on-dark` | `#C89A5B` | Rating stars and premium marks on charcoal (6.40:1) | Never on light; it washes out |

### 4.6 Status colours [WEB]

Deliberately **outside** the brand hues, so an error never looks like a call to action. Every state has a fill/icon shade plus a darker `-text` shade for small type.

| State | Fill / icon / border | Text on light | Contrast (text on white) |
|---|---|---|---|
| Success | `#3A7353` | `#3A7353` | 5.59 : 1 |
| Warning | `#D28A32` (icons/fills only, 2.7:1 as text) | `#9C621C` | 5.03 : 1 |
| Error | `#C94B42` | `#B83F37` | 5.52 : 1 |
| Error on dark | `#E0776D` | `#E0776D` | 5.47 : 1 on `#20201D` |
| Info | `#47758A` | `#47758A` | 5.02 : 1 |

> **Rule:** orange is **never** a status. "Limited availability" is `warning-text`, not orange. An invalid field gets an `error` border, not a `brand` one.

### 4.7 Data visualisation [WEB]

Categorical, fixed order, never cycled. If a filter removes a series, the remaining ones keep their colours. Validated for colour-blind separation (ΔE ≥ 13.7 under protanopia).

| Series | Hex | Meaning |
|---|---|---|
| 1 | `#D2601F` | Hotels |
| 2 | `#12938A` | Tours |
| 3 | `#7A4FBD` | Transfers |

Chart marks only. Never used for status.

### 4.8 Colour usage cheatsheet

| You need… | Use |
|---|---|
| The main action on a screen | `brand` fill + white label (see §18.1 on contrast) |
| A secondary action | `ink` fill + `on-dark` label, or `outline` |
| Orange text (eyebrow, link, selected label) | `brand-text #B4471B` |
| A selected filter chip | `brand-soft` bg + `brand` border + `brand-text` label |
| The selected tab / nav item | `brand` icon + `ink` label (or `brand-text` label) |
| A divider | `line #E8DED4`, 1 px / hairline |
| A loading placeholder | `sand` at 70% |
| Text selection highlight | `brand` bg + white text |
| Rating star | `accent-gold` (light) / `accent-gold-on-dark` (dark) |
| Category tag "Mountains", "Nature" | `accent-green` badge |
| Text over a photo | `on-dark` over a charcoal scrim. Never an orange wash. |

---

## 5. Dark mode [PROPOSAL]

The website has **no dark theme**. Mobile users expect one, so this palette was derived from the brand's warm charcoal and every text pair was measured. It keeps the warmth: no blue-greys, no pure black.

| Role | Light (web) | **Dark (proposed)** | Dark contrast |
|---|---|---|---|
| background | `#FFF9F3` | **`#141311`** | — |
| surface (cards, fields) | `#FFFFFF` | **`#1E1C19`** | — |
| surface-raised (sheets, menus) | `#FFFFFF` | **`#28261F`** | — |
| surface-soft (pressed, selected bg) | `#FFF0E8` | **`#2E221B`** (orange-tinted) | — |
| line | `#E8DED4` | **`#36332D`** | decorative only |
| ink (primary text) | `#20201D` | **`#FFF9F3`** | 17.77 : 1 on bg |
| body | `#4A463F` | **`#D9D0C5`** | 12.18 : 1 on bg · 9.93 on raised |
| muted / subtle | `#625F59` / `#78716A` | **`#A8A097`** | 7.20 : 1 on bg · 5.87 on raised |
| brand (fills, icons) | `#EB6830` | **`#EB6830`** (unchanged) | 5.80 : 1 as an icon on bg |
| brand-text | `#B4471B` | **`#F0804E`** (brand-400) | 6.99 : 1 on bg · 6.40 on surface |
| accent-gold | `#B8873F` | **`#C89A5B`** (already the web's on-dark gold) | 6.66 : 1 on surface |
| success | `#3A7353` | **`#5FAE84`** | 6.37 : 1 on surface |
| warning-text | `#9C621C` | **`#E0A35A`** | 7.74 : 1 on surface |
| error | `#C94B42` | **`#E0776D`** (already the web's on-dark error) | 5.69 : 1 on surface |
| info | `#47758A` | **`#7FB0C6`** | 7.23 : 1 on surface |

Rules for dark mode:
- The **logo never changes** (§2.1).
- Photography stays at full strength. Don't dim images globally.
- Elevation in dark comes from **lighter surfaces** (`surface` → `surface-raised`), not from shadows.
- Charcoal sections from the light theme (`bg ink`) become `surface-raised` in dark so they still read as a separate band.

---

## 6. Typography

### 6.1 Typefaces [WEB]

| Role | Typeface | Weights used | Licence |
|---|---|---|---|
| **Display** (headlines, wordmark) | **Fraunces** (variable serif) | 300 Light, 400 Regular, 500 Medium (wordmark) | SIL OFL, OK to bundle |
| **Interface** (everything else) | **Inter** (variable sans) | 400 Regular, 500 Medium, 600 Semibold | SIL OFL |
| **Georgian** | **Noto Sans Georgian** | 300–600 to match | SIL OFL |
| **Hebrew** | **Noto Sans Hebrew** | 300–600 to match | SIL OFL |

Fallback order on the web (per character): `Fraunces → Noto Sans Georgian → Noto Sans Hebrew → system serif` for display, and `Inter → Noto Sans Georgian → Noto Sans Hebrew → system sans` for interface text. **The app must reproduce this per-script fallback.** Latin inside a Georgian sentence (a hotel name, a number) stays in Fraunces or Inter.

- **Fraunces axes:** only the defaults. Never move `SOFT` or `WONK`. The web browser sets the optical-size axis (`opsz`) to the font size automatically; **native platforms may not**. Set `opsz` to the point size explicitly (or pick the closest static optical-size cut), or headlines will look too heavy and too tight.
- **Display headlines are Light (300).** This thin, large serif is the core of the editorial look. Don't bold headlines.
- **Numbers:** prices, ratings, scores, dates and times use **tabular figures** (`tnum`) so columns line up.

> ⚠️ **Gap found on the website:** Fraunces has **no Cyrillic**, so Russian headlines currently fall through to the OS serif (Georgia / Times). For the app, choose a Cyrillic display serif on purpose. **Literata Light** or **Noto Serif Display Light** are the closest in spirit (both OFL). Validate visually before adopting. See §18.

### 6.2 Type scale for mobile [APP]

The web scale is fluid. The values below are what it resolves to on a phone (~360–430 pt wide), expressed in **pt (iOS) = sp (Android)**. Line heights are absolute, rounded to whole points.

| Token | Font | Weight | Size | Line height | Tracking | Typical use |
|---|---|---|---|---|---|---|
| `display` | Fraunces | 300 | **36** | 40 (1.12) | −0.025em (−0.9) | Hero headline, onboarding |
| `h1` | Fraunces | 300 | **32** | 37 (1.16) | −0.022em (−0.7) | Screen title (large) |
| `h2` | Fraunces | 300 | **28** | 34 (1.2) | −0.018em (−0.5) | Section heading |
| `h3` | Fraunces | 400 | **22** | 28 (1.28) | −0.012em (−0.26) | Card title, sheet title |
| `h4` | Inter | 600 | **17** | 23 (1.35) | −0.006em (−0.1) | List-row title, price, emphasis |
| `body-lg` | Inter | 400 | **18** | 30 (1.65) | 0 | Lead paragraph, descriptions |
| `body` | Inter | 400 | **16** | 26 (1.65) | 0 | Default text |
| `body-sm` | Inter | 400 | **15** | 24 (1.6) | 0 | Secondary paragraphs, card descriptions |
| `caption` | Inter | 400 | **13** | 20 (1.5) | +0.005em | Metadata, timestamps, helper text |
| `eyebrow` | Inter | 600 | **11** | 11–14 (1.0) | **+0.18em (+2)** | Uppercase overline above headings |
| `button` | Inter | 600 | **15** (md) / **16** (lg) / 13 (sm) | 1.25 | 0 | Button labels |
| `chip` | Inter | 500 | **13** | 1.25 | 0 | Filter chips |
| `badge` | Inter | 600 | **11** | 1.25 | +0.12em, uppercase | Badges |
| `wordmark` | Fraunces | 500 | 18 | 18 | +0.06em, uppercase | Logo lockup only |

Note on the web: `display` and `h1` both floor at 36 on a phone. The app separates them (36 / 32) so a screen title never competes with a hero.

**Dynamic Type / font scaling:** support it. Let body and caption scale fully. Cap display / h1 / h2 at about 1.3× so a hero headline doesn't break into one word per line. Georgian is already wider (§7).

**Text colour by role:** headlines `ink`, paragraphs `body`, metadata `muted`, smallest metadata `subtle`, eyebrows `brand-text` (light) or `on-dark` at 60% (dark sections).

### 6.3 The eyebrow pattern [WEB]

The brand's signature heading pattern: **eyebrow → headline → description**.

```
EXPLORE GEORGIA          ← eyebrow · Inter 600 · 11 · +0.18em · uppercase · brand-text
Where to go next         ← h2 · Fraunces Light 28 · ink
Twelve regions, from…    ← body-lg · Inter 18 · body
```

Spacing: eyebrow → headline **16 pt**. Headline → description **20 pt**.

---

## 7. Multilingual and RTL type rules

These rules were measured on the website after real layout bugs. **They're not optional.**

### 7.1 Georgian (ka) [WEB → APP]

Georgian (Mkhedruli) has no capitals. Almost every letter climbs to the top or drops below the baseline, so lines collide at Latin line-heights, and the script is drawn larger than Fraunces.

| Rule | Value |
|---|---|
| Size of Georgian in display styles | Multiply by **≈ 0.88**. (Web uses `font-size-adjust` to match Fraunces' x-height 0.482 against Georgian's 0.55. Native has no equivalent, so scale the Georgian style.) |
| Tracking on display styles | **0** (remove the negative tracking) |
| Line height, display | **1.24** |
| Line height, h1 | **1.28** |
| Line height, h2 | **1.32** |
| Line height, h3 | **1.36** |
| Line height, h4 | **1.45** |
| Line height, eyebrow | **1.4** (it wraps more often) |
| Line height, wrapped button label | **1.375** (snug) instead of 1.25 |
| Body text | No change (1.5–1.65 is already enough) |
| Width | Georgian runs **up to ~2× the width of English** ("About" → "ჩვენ შესახებ"). Every label must be allowed to wrap or truncate gracefully. Design with Georgian first. |
| Uppercase | Don't programmatically uppercase Georgian. Some platforms map it to Mtavruli capitals, which changes the look. Decide per string. |

### 7.2 Russian (ru) and Hebrew (he) [WEB]

Their fallback faces are taller (~1.06em against Fraunces' 1em), so display leading opens up:

| Style | ru | he |
|---|---|---|
| display | 1.18 | 1.20 |
| h1 | 1.22 | 1.22 |
| h2 | 1.26 | 1.26 |
| h3 | 1.32 | 1.32 |

Russian is also long. Allow wrapping on buttons and dialogs. On the web, fixed-height buttons clipped Russian labels, which is why button heights are **minimums** (§14.1).

### 7.3 Right-to-left (Hebrew)

- Mirror the **layout**: start/end, not left/right.
- Mirror **directional icons** (arrows, chevrons, "back", "next").
- Do **not** mirror: the logo, photos, the ridge/sun illustration, clocks, media playback icons, checkmarks, numbers.
- Badges with an asymmetric corner (the score badge, §14.6) flip that corner to the start edge.

---

## 8. Spacing and grid

### 8.1 Base unit [WEB]

**4 pt grid.** Every margin, padding and gap is a multiple of 4. Most used values on the website: **16 (gap-4), 20 (gap-5), 24 (gap-6)**.

| Token | pt | Typical use |
|---|---|---|
| `space-1` | 4 | Icon-to-text in dense rows |
| `space-1.5` | 6 | Icon-to-text in badges and meta rows |
| `space-2` | 8 | Small gaps |
| `space-3` | 12 | List-row internal gaps, image strip gaps |
| `space-4` | 16 | Default gap, card padding (compact) |
| `space-5` | 20 | **Screen side margin**, card content offset |
| `space-6` | 24 | Card padding, sheet padding, group spacing |
| `space-8` | 32 | Between groups |
| `space-10` | 40 | Between sections (compact) |
| `space-12` | 48 | Between sections |
| `space-16` | 64 | Major section break (web phones use 64–80) |

### 8.2 Screen layout [APP]

- **Side margin (gutter): 20 pt** on phones (the website's phone gutter). 32 pt on tablets.
- **Reading width:** cap long-form text at ~46 em (≈ 680 pt) on tablets.
- **Card content:** title starts 20 pt below its image (web `pt-5`).
- **Touch target:** minimum **44 × 44 pt (iOS) / 48 × 48 dp (Android)**, even when the visible element is smaller. Pad it out.
- **Safe areas:** respect the notch, home indicator and Android gesture bar. A sticky booking/CTA bar sits **above** the home indicator, with the bar's background extending beneath it.

---

## 9. Shape (corner radius)

The brand is **restrained and editorial**: crisp corners, not bubbly ones. On the website `rounded-sm` (4 px) is used **717 times**. Only chips, badges and avatars are fully round.

| Token | pt | Use |
|---|---|---|
| `radius-xs` | 2 | Focus ring, tiny marks |
| **`radius-sm`** | **4** | **Default: buttons, inputs, cards, images, score badge, toasts** |
| `radius-md` | 6 | Small containers (rare) |
| `radius-lg` | 10 | Larger containers (rare) |
| `radius-xl` | 16 | **Bottom-sheet top corners** |
| `radius-2xl` | 24 | Large feature containers (rare) |
| `full` | 999 | Chips, badges, avatars, round icon buttons |

[APP] Resist the platform habit of 12–20 pt rounded cards. 4 pt is part of the identity. The one larger radius is the **bottom sheet (16 pt top corners)**, which is exactly what the website does on phones.

---

## 10. Elevation and shadow

Shadows are **warm-tinted** (colour `#20201D`, never neutral grey) and **soft**. The design relies more on hairline borders and surface colour than on shadow.

| Level | Web CSS | iOS approximation | Android |
|---|---|---|---|
| `card` | `0 1px 2px rgb(32 32 29/.04), 0 8px 24px -12px rgb(32 32 29/.12)` | color `#20201D`, opacity 0.08, offset (0, 6), radius 12 | elevation 2 dp, shadow colour `#20201D` |
| `lift` (pressed-up, floating) | `0 2px 4px …/.05, 0 20px 40px -16px …/.22` | opacity 0.14, offset (0, 12), radius 20 | elevation 6 dp |
| `modal` | `0 32px 80px -24px …/.45` | opacity 0.28, offset (0, 20), radius 40 | elevation 12 dp |

- **Scrim behind sheets and modals:** `#20201D` at **70%** plus a light **background blur** (web `backdrop-blur-sm` ≈ 4–8 pt).
- **Dark mode:** drop shadows almost entirely. Use the surface steps from §5.
- Most cards on the website have **no shadow**: either borderless editorial cards (image + text on the background) or a `surface` card with a 1 pt `line` border. Use `card` shadow sparingly, for floating elements.

---

## 11. Iconography

| Property | Value |
|---|---|
| Library | **Lucide** (`lucide-react` on web). Native ports: `lucide-react-native`, `lucide_icons` (Flutter), or export SVGs |
| Style | Outline, **2 px stroke** (Lucide default, never changed on the site), round caps and joins |
| Grid | 24 × 24 |
| Colour | Inherits text colour: `ink`, `muted`, `on-dark` at 40–70%. Orange only for active/selected state |
| Filled icons | Only the **rating star** (filled gold) |

**Sizes [APP]:**

| Context | Size |
|---|---|
| Inline with caption/meta text | 14–16 pt (web's most used: 15) |
| In buttons | 16–18 pt |
| List rows, inputs | 20 pt |
| Tab bar / top bar | 24 pt |
| Empty states | 40–48 pt, `muted` colour |

Keep stroke visually at ~1.5–2 pt at every size. Don't let large icons get heavy, and scale stroke down if needed.

---

## 12. Photography and imagery

### 12.1 Direction

- **Real Georgia, real light.** Caucasus peaks, Svaneti towers, Tbilisi old town, Kakheti vineyards, the Black Sea, the Georgian table. Warm golden-hour light preferred.
- People shown as **travellers inside the place**, not posing for the camera.
- **No stock clichés**, no heavy filters, no HDR, no orange colour grading. The brand orange must stay the only orange accent on the screen.
- Photography is part of the **25%** in the colour rule. It carries the emotion so the UI doesn't have to.

> ⚠️ The website currently uses Wikimedia Commons placeholders (`client/public/images/CREDITS.md`). The app needs licensed brand photography.

### 12.2 Aspect ratios [WEB]

| Ratio | Use |
|---|---|
| **4 : 3** | **Default card image** (tours, experiences, hotels). Used 24× on the site |
| 3 : 2 | Editorial strips (food, culture) |
| 16 : 10 / 16 : 9 | Feature cards, gallery |
| 21 : 9 | Panoramic banners |
| 1 : 1 | Avatars, thumbnails |
| Full-bleed, **~92% of screen height** | Hero on phones, text anchored to the bottom |

Image corners: `radius-sm` (4 pt). Edge-to-edge heroes have no radius.

### 12.3 Scrims (text over photography) [WEB]

**Always neutral charcoal. Never an orange wash.**

| Scrim | Gradient (bottom → top) | Use |
|---|---|---|
| `scrim-bottom` | `#20201D` 88% at 0% → 55% at 28% → 12% at 62% → 0% at 100% | Hero, card overlays with text at the bottom |
| `scrim-full` | 80% at 0% → 40% at 45% → 28% at 100% | Full-image overlays with centred text |
| `scrim-side` (stacks with bottom) | start → end: 50% → 20% at 50% → 0% at 85% | Left-aligned hero copy on tablets (mirror in RTL) |

Text on scrims: `on-dark #FFF9F3`. Secondary text at 70–75%.

### 12.4 Placeholders and loading

- Loading image: `sand #E8D6C2` at 70% with a slow pulse (disabled under reduced motion).
- Skeletons copy the exact proportions of the content (4:3 image block, then 3–4 text bars) so nothing jumps.
- Broken image: `surface-earth` fill with a centred `muted` Lucide image icon.

---

## 13. Motion

### 13.1 Character

Calm, confident, **soft deceleration**. Things *settle*, they don't bounce. No springs with overshoot, no playful wiggles.

### 13.2 Curves [WEB]

| Token | Cubic-bezier | Use |
|---|---|---|
| **`ease-out-soft`** | `0.22, 1, 0.36, 1` | **Default for everything entering or changing** |
| `ease-in-out-soft` | `0.65, 0, 0.35, 1` | Moving between two on-screen positions |

### 13.3 Durations [WEB → APP]

| Duration | Use |
|---|---|
| **200 ms** | State changes: press, colour, chip toggle, border |
| **250 ms** | Bottom sheet / modal in (from +24 pt, scale 0.98 → 1, fade). Exit to +16 pt |
| 300 ms | Small layout transitions, tab content fade |
| 400 ms | Underline / highlight reveals |
| 700 ms | Image settle (scale 1.04 → 1) |
| **900 ms** | Hero entrance: headline rises 28 pt (starts at 35% opacity, never invisible) |
| 1800 ms | Hero image slow settle (scale 1.04 → 1) |

### 13.4 Signature behaviours

- **Press:** button moves **down 1 pt** (web `active:translate-y-px`) and darkens to `brand-pressed`. On mobile, optionally scale to 0.98 and add a light haptic on primary actions.
- **Reveal on scroll:** content rises 24 pt and fades in as it enters the viewport, staggered per item (max 8 steps). Content already on screen at load is never hidden.
- **Hero:** the headline must be visible immediately (it rises from a visible state). Secondary lines (eyebrow, standfirst, buttons) may fade in from 0.
- **Hover zoom → mobile:** the web's image zoom on hover (1.04) has no touch equivalent. Use it as a subtle settle when a card image loads, or for shared-element transitions into detail screens.

### 13.5 Reduced motion

When the OS "Reduce Motion" setting is on: **no travel, no scale**. Only short cross-fades (≤ 150 ms). Content must never stay hidden.

---

## 14. Component visual language

This section covers how things **look**, not where they go.

### 14.1 Buttons [WEB]

Shared: Inter **600**, radius **4 pt**, icon 16–18 pt with 8 pt gap, label centred and **allowed to wrap** (heights are minimums), 200 ms colour transition, press = 1 pt down.

| Size | Min height | Horizontal padding | Label |
|---|---|---|---|
| `sm` | 36 (pad the touch target to 44/48) | 16 | 13 |
| `md` | **44** | 24 | 15 |
| `lg` | **52** | 20 on phones (32 on tablets) | 16 |

| Variant | Rest | Pressed | Use |
|---|---|---|---|
| **primary** | bg `#EB6830`, label `#FFFFFF` | bg `#C8501F` | Book, reserve, plan a trip, the one main action |
| **secondary** | bg `#20201D`, label `#FFF9F3` | bg `#2E2E29` | Strong non-booking actions |
| **outline** | 1 pt border `ink` 25%, label `ink` | border `ink`, bg `surface-soft` | Secondary choices |
| **outline-brand** | 1 pt border `#EB6830`, label `#B4471B` | bg `brand-soft`, border `#C8501F` | Rare, brand-flavoured secondary |
| **ghost** | transparent, label `ink` | bg `surface-soft` | Tertiary, toolbars |
| **outline-light** | border `on-dark` 40%, label `on-dark` | border `on-dark`, bg `on-dark` 10% | On photos / charcoal |
| **light** | bg `background` 95% + blur, label `ink` | bg `background` | On photos |

Disabled: 50% opacity, no interaction. **One primary button per view.**

### 14.2 Filter chips [WEB]

- Height **36** (pad touch area to 44/48), horizontal padding 16, fully round, Inter 500 13 pt, no wrap.
- **Unselected:** transparent bg, 1 pt `line` border, label `body`. Pressed: border `subtle`, label `ink`.
- **Selected:** bg `brand-soft #FFF0E8`, border `brand #EB6830`, label `brand-text #B4471B`. **Never a solid orange fill.** A row of filled orange chips would swamp the palette.
- Horizontal chip rails scroll with the scrollbar hidden.

### 14.3 Badges [WEB]

Fully round, padding 12 × 4, Inter 600 **11 pt**, **uppercase, +0.12em**, optional 6 pt-gap icon.

| Tone | Style | Meaning |
|---|---|---|
| neutral | bg `surface-soft`, text `body` | General label |
| brand | bg `#EB6830`, text `on-dark` | Featured / highlight. Use rarely |
| light | bg `background` 90% + blur, text `ink` | On top of photos |
| nature | bg `accent-green`, text `on-dark` | Nature / mountain category |
| outline | 1 pt `line` border, text `body` | Quiet label |

Badges on images sit **16 pt from the top-start corner**.

### 14.4 Inputs [WEB]

- bg `background` (or `surface` on a `background` screen), 1 pt `line` border, radius 4, padding 12 × 10, text `ink`.
- **Font size ≥ 16 pt on mobile.** (The web forces 16 px on touch devices because iOS zooms into smaller fields.)
- Label above the field: Inter 500, 13–14 pt, `ink`. Helper text: `caption`, `muted`.
- **Focused:** border becomes `ink`. For keyboard / accessibility focus, the brand focus ring is **2 pt `#C8501F`, offset 3 pt**.
- **Error:** border `error #C94B42`, message `error-text #B83F37` in `caption`, with an icon. Never orange.
- Info notice inside forms: bg `surface-soft` 60%, 1 pt `line` border, radius 4, text `muted`.

### 14.5 Rating (5-star, tours) [WEB]

- One **filled** Lucide star in `accent-gold`, 14–16 pt, then the value (`4.8`, Inter 500, tabular figures, `ink`), then `(128)` in `muted`.
- On photos/dark: star and value `on-dark`, count `on-dark` 70%.
- Official hotel class (★★★★): row of 13 pt gold filled stars, 2 pt gap.

### 14.6 Score badge (10-point, hotels) [WEB]

The booking-platform pattern travellers know: a solid score block next to a worded verdict.

- Block: bg **`#C8501F`** (brand-600 for AA with white), white Inter 600 tabular number (`9.2`).
- Shape: radius 4 on three corners, **square bottom-start corner** (a speech-bubble cue). It flips in RTL.
- Sizes: 32 / 40 / 48 pt square minimum.
- Beside it: verdict ("Exceptional") in `body-sm` 600 `ink`, review count in `caption` `muted`.

### 14.7 Cards [WEB]

Two families:

1. **Editorial card** (tours, experiences, destinations): **no box**. A 4:3 image (radius 4), then 20 pt below: eyebrow location (`muted`), `h3` title (`ink`), 2-line `body-sm` description (`muted`), meta row (caption + 15 pt icons, `muted`), then a 1 pt `line` divider and a price row (`caption` "from" + `h4` price, end-aligned).
2. **Listing card** (hotels, results): `surface` bg, 1 pt `line` border, radius 4, 16 pt padding, image + content.

Pressed state: title gets an underline sweep (`ink`, 1 pt, 400 ms) and the image settles slightly. On mobile, a subtle `surface-soft` press tint on listing cards is fine.

### 14.8 Bottom sheets and dialogs [WEB]

- On phones every dialog is a **bottom sheet**: bg `background`, **16 pt top corners**, max height 92% of the screen, `modal` shadow, scrim `ink` 70% + blur.
- Padding 24 pt. Title in `h3` (Fraunces 22). Close button: 36 pt round, `muted` icon, pressed bg `surface-soft`.
- Content scrolls inside. Overscroll doesn't chain to the screen behind.

### 14.9 Section heading [WEB]

Eyebrow (brand-text) → `h2` (ink) → `body-lg` description (body). An optional "See all →" action in Inter 500 14 pt, `ink`, with the arrow mirrored in RTL.

### 14.10 Charcoal sections [WEB]

Full-width `ink #20201D` bands for statements, CTAs and the footer. Text `on-dark`, eyebrows `on-dark` 60%, stars `accent-gold-on-dark`, errors `error-on-dark`, buttons `outline-light` / `light` / `primary`.

---

## 15. Accessibility

Measured WCAG 2.x contrast for the pairs that actually occur:

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| ink `#20201D` | background `#FFF9F3` | 15.63 | ✅ AAA |
| body `#4A463F` | background | 8.98 | ✅ AAA |
| muted `#625F59` | background | 6.09 | ✅ AA |
| subtle `#78716A` | background | 4.60 | ✅ AA (the floor) |
| subtle `#78716A` | surface-earth `#F1E8DE` | 3.97 | ❌ use muted (5.25) |
| brand-text `#B4471B` | background | 5.21 | ✅ AA |
| brand-text `#B4471B` | brand-soft `#FFF0E8` | 4.89 | ✅ AA |
| brand `#EB6830` | background | 3.07 | ⚠️ icons / large text only |
| **white** | **brand `#EB6830`** | **3.20** | ⚠️ **AA only for large text** (see §18.1) |
| white | brand-600 `#C8501F` | 4.54 | ✅ AA |
| ink `#20201D` | brand `#EB6830` | 5.10 | ✅ AA |
| accent-gold `#B8873F` | white | 3.19 | ✅ graphics (≥ 3:1) |
| on-dark `#FFF9F3` | accent-green `#496458` | 6.19 | ✅ AA |
| on-dark-muted `#CFC7BE` | ink `#20201D` | 9.77 | ✅ AAA |

Other rules:
- **Touch targets** 44 pt / 48 dp minimum.
- **Never colour alone.** Status always has an icon or text; a selected chip has a border and a tint, not only a colour change.
- **Screen readers:** the logo mark is decorative next to the wordmark. Ratings announce "Rated 4.8 out of 5, from 128 reviews".
- **Dynamic Type / font scale** supported (§6.2).
- **Reduced motion** respected (§13.5).

---

## 16. Design tokens (JSON)

Framework-agnostic, ready to feed Style Dictionary or to hand-port into Flutter, React Native or SwiftUI.

```json
{
  "color": {
    "brand": {
      "50": "#FFF0E8", "100": "#FFDECE", "200": "#FBC1A4", "300": "#F59E75", "400": "#F0804E",
      "500": "#EB6830", "600": "#C8501F", "700": "#B4471B", "800": "#8E3714", "900": "#66270E"
    },
    "light": {
      "brand": "#EB6830",
      "brandPressed": "#C8501F",
      "brandText": "#B4471B",
      "brandSoft": "#FFF0E8",
      "background": "#FFF9F3",
      "surface": "#FFFFFF",
      "surfaceSoft": "#FFF0E8",
      "surfaceEarth": "#F1E8DE",
      "sand": "#E8D6C2",
      "line": "#E8DED4",
      "ink": "#20201D",
      "inkSoft": "#2E2E29",
      "body": "#4A463F",
      "muted": "#625F59",
      "subtle": "#78716A",
      "onDark": "#FFF9F3",
      "onDarkMuted": "#CFC7BE",
      "onBrand": "#FFFFFF",
      "accentGreen": "#496458",
      "accentGold": "#B8873F",
      "success": "#3A7353",
      "warning": "#D28A32",
      "warningText": "#9C621C",
      "error": "#C94B42",
      "errorText": "#B83F37",
      "info": "#47758A",
      "scrim": "#20201D"
    },
    "dark": {
      "brand": "#EB6830",
      "brandPressed": "#C8501F",
      "brandText": "#F0804E",
      "brandSoft": "#2E221B",
      "background": "#141311",
      "surface": "#1E1C19",
      "surfaceRaised": "#28261F",
      "surfaceSoft": "#2E221B",
      "surfaceEarth": "#28261F",
      "sand": "#36332D",
      "line": "#36332D",
      "ink": "#FFF9F3",
      "body": "#D9D0C5",
      "muted": "#A8A097",
      "subtle": "#A8A097",
      "onDark": "#FFF9F3",
      "onDarkMuted": "#CFC7BE",
      "onBrand": "#FFFFFF",
      "accentGreen": "#496458",
      "accentGold": "#C89A5B",
      "success": "#5FAE84",
      "warning": "#E0A35A",
      "warningText": "#E0A35A",
      "error": "#E0776D",
      "errorText": "#E0776D",
      "info": "#7FB0C6",
      "scrim": "#000000"
    },
    "series": { "hotels": "#D2601F", "tours": "#12938A", "transfers": "#7A4FBD" },
    "logo": { "tile": "#EB6830", "ridge": "#FFF9F3", "sun": "#FFF9F3" }
  },
  "font": {
    "display": "Fraunces",
    "sans": "Inter",
    "georgian": "Noto Sans Georgian",
    "hebrew": "Noto Sans Hebrew"
  },
  "type": {
    "display":  { "font": "display", "weight": 300, "size": 36, "lineHeight": 40, "tracking": -0.025 },
    "h1":       { "font": "display", "weight": 300, "size": 32, "lineHeight": 37, "tracking": -0.022 },
    "h2":       { "font": "display", "weight": 300, "size": 28, "lineHeight": 34, "tracking": -0.018 },
    "h3":       { "font": "display", "weight": 400, "size": 22, "lineHeight": 28, "tracking": -0.012 },
    "h4":       { "font": "sans",    "weight": 600, "size": 17, "lineHeight": 23, "tracking": -0.006 },
    "bodyLg":   { "font": "sans",    "weight": 400, "size": 18, "lineHeight": 30, "tracking": 0 },
    "body":     { "font": "sans",    "weight": 400, "size": 16, "lineHeight": 26, "tracking": 0 },
    "bodySm":   { "font": "sans",    "weight": 400, "size": 15, "lineHeight": 24, "tracking": 0 },
    "caption":  { "font": "sans",    "weight": 400, "size": 13, "lineHeight": 20, "tracking": 0.005 },
    "eyebrow":  { "font": "sans",    "weight": 600, "size": 11, "lineHeight": 14, "tracking": 0.18, "uppercase": true },
    "button":   { "font": "sans",    "weight": 600, "size": 15, "lineHeight": 19, "tracking": 0 },
    "chip":     { "font": "sans",    "weight": 500, "size": 13, "lineHeight": 16, "tracking": 0 },
    "badge":    { "font": "sans",    "weight": 600, "size": 11, "lineHeight": 14, "tracking": 0.12, "uppercase": true },
    "wordmark": { "font": "display", "weight": 500, "size": 18, "lineHeight": 18, "tracking": 0.06, "uppercase": true }
  },
  "lineHeightOverride": {
    "ka": { "display": 1.24, "h1": 1.28, "h2": 1.32, "h3": 1.36, "h4": 1.45, "eyebrow": 1.4, "displaySizeScale": 0.88 },
    "ru": { "display": 1.18, "h1": 1.22, "h2": 1.26, "h3": 1.32 },
    "he": { "display": 1.20, "h1": 1.22, "h2": 1.26, "h3": 1.32 }
  },
  "space": { "1": 4, "1.5": 6, "2": 8, "3": 12, "4": 16, "5": 20, "6": 24, "8": 32, "10": 40, "12": 48, "16": 64, "gutter": 20 },
  "radius": { "xs": 2, "sm": 4, "md": 6, "lg": 10, "xl": 16, "2xl": 24, "full": 999 },
  "motion": {
    "easeOutSoft": [0.22, 1, 0.36, 1],
    "easeInOutSoft": [0.65, 0, 0.35, 1],
    "duration": { "state": 200, "sheet": 250, "short": 300, "reveal": 400, "image": 700, "hero": 900, "heroImage": 1800 }
  },
  "size": {
    "touchMin": { "ios": 44, "android": 48 },
    "button": { "sm": 36, "md": 44, "lg": 52 },
    "chip": 36,
    "icon": { "inline": 15, "button": 16, "row": 20, "bar": 24 }
  }
}
```

`tracking` values are in **em**. Multiply by the font size for points (for example eyebrow 0.18 × 11 = 1.98 pt).

---

## 17. Platform mapping (Material 3 and iOS)

### Material 3 `ColorScheme` (Android / Flutter)

| M3 role | Light | Dark |
|---|---|---|
| `primary` | `#EB6830` | `#EB6830` |
| `onPrimary` | `#FFFFFF` | `#FFFFFF` |
| `primaryContainer` | `#FFF0E8` | `#2E221B` |
| `onPrimaryContainer` | `#B4471B` | `#F0804E` |
| `secondary` | `#20201D` | `#FFF9F3` |
| `onSecondary` | `#FFF9F3` | `#141311` |
| `tertiary` | `#496458` | `#7FA392`* |
| `surface` | `#FFF9F3` | `#141311` |
| `surfaceContainerLowest` | `#FFFFFF` | `#1E1C19` |
| `surfaceContainer` | `#F1E8DE` | `#28261F` |
| `onSurface` | `#20201D` | `#FFF9F3` |
| `onSurfaceVariant` | `#625F59` | `#A8A097` |
| `outline` | `#78716A` | `#A8A097` |
| `outlineVariant` | `#E8DED4` | `#36332D` |
| `error` | `#C94B42` | `#E0776D` |
| `scrim` | `#20201D` | `#000000` |

\* lightened green for dark mode (6.68:1 on `#141311`). Selected-chip label `#F0804E` on `#2E221B` measures 5.81:1.

**Turn off Material's dynamic colour (Material You)**. The brand palette must not be replaced by the user's wallpaper colours. Also override Material's default ripple to a warm `ink` at 8% (or `brand` at 12% on brand surfaces), not grey.

### iOS (SwiftUI / UIKit)

- Define named colours in the Asset Catalog with **Any / Dark** appearances using §4 and §5. Don't use `systemBackground`, `label` or `systemGray`. They're cold.
- `accentColor` / `tint` = `#EB6830`.
- Large titles: set a custom Fraunces Light appearance so the iOS large title doesn't fall back to SF Pro.
- Prefer native components (sheets, menus, date pickers) but tint them, and give sheets the 16 pt corner radius and `background` colour.

---

## 18. Open decisions

### 18.1 Primary button contrast ⚠️ (needs a decision)

White on `#EB6830` measures **3.20:1**. That passes WCAG AA only for **large text** (≥ 18.7 pt bold / 24 pt regular). The website's 15 px semibold button labels technically fall short. Options for the app:

| Option | Rest fill | Label | Ratio | Trade-off |
|---|---|---|---|---|
| A (current web) | `#EB6830` | white | 3.20 | Most "on brand", fails AA at button sizes |
| **B (recommended)** | **`#C8501F`** | white | **4.54** | Still unmistakably the brand orange, passes AA. Press state → `#B4471B` |
| C | `#EB6830` | `#20201D` | 5.10 | Passes, but a dark label on orange changes the personality |

Recommendation: **B for buttons**, while `#EB6830` stays the colour for the logo, icons, active indicators, progress and selection. If B is adopted, consider bringing it back to the website for consistency.

### 18.2 Cyrillic display face

Fraunces has no Cyrillic. Pick and approve a Russian display serif (candidates: Literata Light, Noto Serif Display Light), then set its line heights per §7.2.

### 18.3 Official logo artwork

Confirm whether official artwork exists (§2.1). If it does, replace the SVGs in §2–3 and keep the rules.

### 18.4 Dark mode sign-off

§5 is a proposal derived from the brand. Review it on real devices with real photography before shipping.

### 18.5 Serif for Georgian and Hebrew headlines (optional)

The website sets Georgian and Hebrew headlines in a sans (Noto Sans), while Latin headlines are a serif. For a closer match to Fraunces, **Noto Serif Georgian** and **Noto Serif Hebrew** (both OFL) are worth testing in the app. If adopted, re-measure the line heights in §7.
