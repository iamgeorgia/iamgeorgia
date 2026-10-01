# I'am Georgia — Front-End Work Log

Everything changed on the front end, why it changed, and what is still outstanding.

**Stack:** Next.js 16.3 (App Router, Turbopack) · React 19.2 · Tailwind CSS v4 · Framer Motion 13 · TypeScript 5

**Status at time of writing:** `tsc --noEmit` clean · `eslint` clean · `next build` succeeds.

---

## Table of contents

1. [Colour system](#1-colour-system)
2. [Layout fixes](#2-layout-fixes)
3. [Brand identity — logo and page titles](#3-brand-identity--logo-and-page-titles)
4. [Internationalisation](#4-internationalisation)
5. [Transfers went live](#5-transfers-went-live)
6. [Outstanding work](#6-outstanding-work)
7. [File reference](#7-file-reference)
8. [Error handling](#8-error-handling)
9. [Admin navigation](#9-admin-navigation)
10. [Fleet, drivers and dispatch](#10-fleet-drivers-and-dispatch)
11. [Tours went live](#11-tours-went-live)
12. [Packages and orders went live](#12-packages-and-orders-went-live)
13. [Responsive audit](#13-responsive-audit)
14. [SEO, sharing and public URLs](#14-seo-sharing-and-public-urls)
15. [Admin help and tutorials](#15-admin-help-and-tutorials)

---

## 1. Colour system

Built around the logo orange, implemented as centralised design tokens in `app/globals.css` (**39 colour tokens**). No component hardcodes a hex value — verified: zero hex literals in any `.tsx` file.

### Foundation

| Token | Value | Role |
| --- | --- | --- |
| `--color-brand` | `#eb6830` | Logo orange. Fills, buttons, icons |
| `--color-brand-hover` | `#c8501f` | Hover / pressed |
| `--color-brand-text` | `#b4471b` | Orange **text** on light surfaces |
| `--color-brand-soft` | `#fff0e8` | Brand-tinted panels |
| `--color-background` | `#fff9f3` | Warm white page ground |
| `--color-surface` | `#ffffff` | Cards, modals, form fields |
| `--color-surface-earth` | `#f1e8de` | Editorial / cultural sections |
| `--color-sand` | `#e8d6c2` | Georgian earth accent |
| `--color-line` | `#e8ded4` | Borders and dividers |
| `--color-ink` | `#20201d` | Primary text, dark sections |
| `--color-body` | `#4a463f` | Body copy |
| `--color-muted` | `#625f59` | Secondary text |
| `--color-subtle` | `#78716a` | Tertiary metadata |
| `--color-accent-green` | `#496458` | Nature / mountain categories |
| `--color-accent-gold` | `#b8873f` | Ratings, premium markers |

A full 10-step orange scale (`--color-brand-50` … `--color-brand-900`) sits behind the semantic aliases. The intended distribution is roughly **60% warm neutrals / 25% charcoal and photography / 10% brand orange / 5% supporting accents** — orange is the signature, not the page.

### Accessibility fixes

Three tokens were failing WCAG AA on live text. I measured every foreground/background pair that actually occurs in the codebase (checking usage sites individually, not just the token table — several tokens pass on white but fail on the earth surfaces).

| Token | Before | After | Problem |
| --- | --- | --- | --- |
| `--color-subtle` | `#a39c92` — **2.60:1** | `#78716a` — 4.60:1 | 13px metadata (review dates, place types) below AA |
| `--color-accent-gold` | `#c89a5b` — **2.55:1** | `#b8873f` — 3.19:1 | Stars are the primary rating signal, under the 3:1 floor for meaningful marks |
| `--color-success` | `#3f7d5a` — **4.40:1** | `#3a7353` — 5.03:1 | Fell below AA once it landed on a soft/earth panel |

`--color-accent-gold-on-dark` (`#c89a5b`) keeps the original lighter gold for the charcoal footer, where it reads correctly at 6.40:1.

`--color-subtle` is documented as the floor: it must not be used on `--color-surface-earth` or `--color-sand`, where it drops below AA. One usage on an earth section was switched to `--color-muted`.

**Result: all 27 in-use combinations meet WCAG AA** (4.5:1 for text, 3:1 for meaningful non-text marks).

### Semantic leakage fixes

Brand orange was doing status work, which conflated identity with meaning:

- **Form errors** used `border-brand` / `text-brand-text` — an invalid field looked like a call to action. Now `border-error` / `text-error-text`, plus `--color-error-on-dark` (`#e0776d`) for the footer newsletter, where `#c94b42` drops to 3.5:1 on charcoal.
- **`Badge` tone `forest`** used `bg-success` for a *category* — making "mountain" and "breakfast included" read as the same kind of information. Now `bg-accent-green`.
- **Room `availabilityNote`** ("limited availability") rendered in brand orange. Now `--color-warning-text` (`#9c621c`), since `#d28a32` is only 2.71:1 as text.

Each semantic state keeps its reference hue for fills and icons, plus a darker `-text` shade for small type on light surfaces — the same split as `--color-brand` / `--color-brand-text`.

### Naming

`Badge` tones were renamed for meaning rather than appearance: `wine` → `brand`, `forest` → `nature`. `accent-green` was defined but entirely unused; it is now wired to nature-led tour categories.

`guestScoreLabel()` in `lib/utils.ts` was changed to return a dictionary key (`"exceptional"`, `"veryGood"`) rather than an English word, so the verdict beside a guest score can be translated.

---

## 2. Layout fixes

### "Where to go" — dead space removed

**Top row.** The lead destination card was locked to `aspect-16/10` (447px tall) while the stacked pair beside it came to 659px, leaving ~212px of empty space beneath it. Added a `stretch` prop to `DestinationCard` that drops the aspect ratio at `lg` and fills the grid row instead. Measured after: lead 659px, pair 659px — flush.

**Bottom rail.** Was `lg:grid-cols-5` holding 4 cards, so one column was always empty. Rather than hardcode `grid-cols-4`, it now uses `lg:grid-flow-col lg:auto-cols-fr` — one equal column per card, so the row spans the full width whatever the count.

> **Latent bug found and fixed:** the rail rendered `!featured` destinations while the top row used only 3 of the 4 featured ones, so **one destination appeared nowhere on the homepage**. The rail now derives its list by exclusion, so nothing is dropped.

### "The Georgian table" — crop and clipping

Two separate causes, found by checking the source image dimensions:

- The photos are landscape (`1800×1196`, `1800×1200`, `1800×1200`) but the containers were `aspect-square`, so `object-cover` was **discarding roughly a third of the width of every image**. Containers are now `aspect-3/2`, matching the sources almost exactly (1.500 vs 1.500 / 1.505) — they render essentially uncropped.
- The strip was inset in a padded container while the block above it is full-bleed, and butted directly against it. It is now near full-bleed with uniform padding all round, so the first and last frames sit fully inside the viewport.

| | Before | After |
| --- | --- | --- |
| Frame height | 371px | 243px |
| First frame starts | x = 0 (flush) | x = 12 |
| Last frame ends | x = 1521 (flush) | x = 1509 |
| Crop on landscape sources | ~33% of width | none |

The 12px inset matches the 12px gap between frames, so the spacing reads as one rhythm.

### "Why travel with us" — pinned intro

Added `lg:sticky lg:top-32 lg:self-start`. **`self-start` is the part that matters**: a grid item is stretched to the full row height by default, so `sticky` would have had no travel.

The sticky box and the reveal animation were also separated into two elements — the Framer Motion entrance was putting a `translateY(24px)` transform on the same element being positioned, which offset the pin by 24px. The sticky element now has `transform: none` and pins at exactly 128px.

Applied to the identical section on the About page ("What we hold to") for consistency.

---

## 3. Brand identity — logo and page titles

### Logo

**No logo asset existed anywhere in the repo** (no SVG, ICO, or anything matching `*logo*` / `*brand*`). I designed a mark from the brand palette: the orange tile carrying a warm-white Caucasus ridge and sun.

The first version read as the generic photo-placeholder glyph, so it was redrawn with the ridge bleeding off the tile edges.

- `components/layout/Logo.tsx` — inlined SVG component (no extra request, scales cleanly, and `next/image` refuses SVG without `dangerouslyAllowSVG`). Used in the header, mobile nav and footer.
- `app/icon.svg` — the browser tab icon, via the Next file convention.

> **Replace this with the real artwork when you have it.** Swap those two files; nothing else needs touching. Colours are literal hex in the mark on purpose — it is logo artwork and must not shift if a UI token is retuned.

### Page titles

`app/[locale]/page.tsx` and `not-found.tsx` were the only routes missing metadata. All routes now return distinct, translated titles:

```
/                     I'am Georgia — Discover Georgia Beyond the Ordinary
/tours                Tours — I'am Georgia
/hotels/vera-house…   Vera House Tbilisi — I'am Georgia
/no-such-page         Page not found — I'am Georgia
```

Home uses `title: { absolute }` so it reads as brand + tagline rather than "Home — I'am Georgia".

---

## 4. Internationalisation

Four languages: **English, ქართული (Georgian), Русский (Russian), עברית (Hebrew)**. German was removed from the switcher — it had no translations and would have shown as a half-English language.

### Routing

Locale-prefixed routes. Every page moved under `app/[locale]/`; all four locales prerender for all 35 detail pages.

```
iamgeorgia.travel/tours          → English   (default, unprefixed)
iamgeorgia.travel/ka/tours       → ქართული
iamgeorgia.travel/ru/tours       → Русский
iamgeorgia.travel/he/tours       → עברית
```

**`proxy.ts`** handles three cases. Note that Next 16 renamed the `middleware` file convention to `proxy` — this is the same request hook under the new name.

| Request | Behaviour |
| --- | --- |
| `/ka/tours` | Served as-is — the `[locale]` segment already matches |
| `/en/tours` | **307 redirect** to `/tours`, so English has one canonical URL |
| `/tours` | **Rewritten** internally to `/en/tours`; the address bar keeps `/tours` |

The rewrite is what lets English stay unprefixed without duplicating the route tree. `Accept-Language` and a stored cookie are honoured **only on the bare root**, so a shared in-language link always opens in the language it names.

### Locale plumbing

The problem: 71 components need the locale, and prop-drilling it through every card and section would be unworkable.

- **Server components** use `getI18n()` (`lib/i18n/server.ts`), built on Next 16's `next/root-params`. Because `[locale]` sits above the root layout it is a *root parameter*, readable from any server component without props. Returns `{ locale, t, path, fill, dir, intlLocale }`.
- **Client components** use `useI18n()` from `lib/i18n/provider.tsx`. `next/root-params` is server-only, so the root layout resolves the locale once and seeds a context. Adds no extra fetch — the dictionary is already in the server-rendered payload.

`path()` / `useLocalePath()` prefix a canonical href with the active locale. **Every `Link` must use it** — a raw `href="/tours"` drops a Georgian reader back into English mid-journey.

### Dictionaries

`lib/i18n/ui/{en,ka,ru,he}.ts` — ~430 lines each, same shape. `UiDictionary` is derived from the English object, so **adding a key to `en.ts` makes TypeScript fail the build until ka, ru and he supply it**. Deliberately not `as const`: literal types would demand the English *words* from every translation rather than just the same keys.

`fill()` handles `{placeholder}` substitution (`"{count} reviews"` → `"128 reviews"`) — a few lines rather than pulling in an ICU formatter for a handful of single-value slots.

### Plurals

`${count} ${noun}s` is an English assumption. Russian needs three forms of the same noun (1 турист / 2 туриста / 5 туристов), Hebrew has a dual, Georgian has one form for every count. Countable nouns are therefore stored as `PluralForms` under `t.units`, and `plural(locale, count, forms)` (`lib/i18n/plural.ts`) picks the variant through `Intl.PluralRules` — which already knows the rules for all four locales.

The old `pluralize()` helper in `lib/utils.ts` hard-coded the English `-s` and has been replaced at every call site it reached.

### Editorial content — the merge layer

The other half of translation: words that belong to a *thing* — a tour, a transfer class, a pick-up point — which cannot sit in a flat dictionary because they multiply with the data.

`data/i18n/merge.ts` holds the mechanism. The English record in `data/` stays the source of truth for everything that is **not** language — ids, slugs, prices, coordinates, images, capacities, ratings, day counts — and a translation supplies only the prose fields, merged over the English record at read time:

```ts
localise(base, locale, content)      // one entity
localiseAll(items, locale, content)  // a collection
```

Three consequences, all of them the point:

- A missing translation degrades to English **for that one field**, rather than breaking the page.
- Pricing, filtering and sorting logic never has to know a locale exists. `quotesForQuery()` computes a fare from the English record; the result is localised at the very end.
- Adding a language is a new key in one file per collection, not a fork of the data.

Accessors take an **optional** locale, and the omission is meaningful — the canonical record is what logic reads, the localised one is what components render.

> **Transfers no longer use this layer.** The whole vertical moved to the database (see §5), and its translations moved with it: `transfer_point_translations`, `transfer_vehicle_translations` and `transfer_route_translations` hold the same per-field overlay, merged server-side by `serializers/localise.js`. The contract is identical — a missing field degrades to English, not the whole record — but it now scales to four hundred routes instead of nineteen hardcoded places. Tours are the remaining user of the client-side merge.

Two traps worth naming, because both fail silently:

- The merge is **shallow**, on purpose — a deep merge over arrays would splice a translated list into an English one of a different length. So a translated `gallery` must restate every frame including its `src`, and a translated `itinerary` must restate every day.
- Closed vocabularies do **not** belong in per-entity content. Meals were free text repeated across 30 itinerary days; they are now `MealKey`s (`"breakfast" | "lunch" | "dinner"`) rendered through `t.tours.mealNames`. Same reasoning moved vehicle classes, transfer features, property types, amenities, tour categories and difficulty out of `data/` and into the dictionary.

### Locale-aware formatting

Numbers and dates were formatted against hard-coded English locales, so a Russian page said `$1,240` where it should say `1 240 $`. `formatPrice()` now takes an `intlLocale`, and `useI18n()` exposes it alongside `getI18n()` so client and server components format identically.

`formatDuration()` takes its `h`/`m` abbreviations as an argument rather than looking them up, because it is called from the pricing engine, which must stay locale-free. Languages that set the abbreviation off from the digits carry the space in the string itself (`" ч"`, `" სთ"`).

### Errors travel as keys, not sentences

Validation lives next to the rules it enforces — `validateTransferQuery()` in `lib/transfers/query.ts`, and the checkout form's own `validate()`. Both are imported by modules that have no locale and should not acquire one, so they return **keys** into `t.transfers.errors` / `t.transfers.booking.errors`. The component that renders a message is the one that knows the reader's language, so it does the lookup:

```ts
const messageFor = (key?: string) => (key ? t.transfers.errors[key] : undefined);
```

The rules are the same in every language; only the wording moves.

### Right-to-left

Hebrew sets `dir="rtl"` on `<html>`. Converted areas use logical properties (`ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`, `text-start`) instead of physical ones, and directional arrows carry `rtl:-scale-x-100` so they point along the reading direction. The nav's active underline uses `after:origin-[inline-start]`.

### Fonts

Fraunces and Inter have no Georgian or Hebrew glyphs — without intervention those pages would fall back to whatever the OS picked, which is exactly the "translated but not designed" look to avoid. Added **Noto Sans Georgian** and **Noto Sans Hebrew**, placed after the Latin faces in the stack:

```css
--font-sans: var(--font-inter), var(--font-georgian), var(--font-hebrew),
  ui-sans-serif, system-ui, sans-serif;
```

A browser walks the stack per character, so Latin text still renders in Inter while Georgian and Hebrew resolve to a designed face.

### SEO

`hreflang` alternates on every page mark the four URLs as the same page in different languages, with `x-default` pointing at English. Per-locale `openGraph.locale` and translated meta titles and descriptions.

### Verified

Against a running production build:

| URL | `lang` | `dir` | Sample content |
| --- | --- | --- | --- |
| `/` | `en` | `ltr` | Where to go · Plan your trip |
| `/ka` | `ka` | `ltr` | სად წავიდეთ · დაგეგმე მოგზაურობა |
| `/ru` | `ru` | `ltr` | Куда поехать · Спланировать поездку |
| `/he` | `he` | **`rtl`** | לאן לנסוע · לתכנן את הטיול |

### Localised so far

**Chrome and shared UI.** Header · Footer · MobileNavigation · LanguageMenu · NewsletterForm · Logo · all 10 home sections · Breadcrumbs · EmptyState · Rating / ScoreBadge / Stars · Modal · MediaGallery · SearchField · ShareSave · the four index pages · not-found · root layout metadata.

**Transfers — complete, UI and content.** Landing, search results, detail, checkout, confirmation and the segment error boundary; TransferSearch, LocationSelector, PassengerSelector, TransferCard, TransferFilters, TransferResults, TransferJourneyBar, TransferGallery, TransferBookingForm, TransferBookingSummary, TransferConfirmation, TransferSteps, TrustRow. All 9 offers and all 19 pick-up points translated.

**Tours — complete, UI and content.** Index, detail, TourCard, TourExplorer. All 10 tours translated, including itineraries, highlights, inclusions and gallery alt text — now served by the API from `server/db/seed/tours.js` (see §11).

Both verticals were verified against a production build: all four locales prerender, and `/ka`, `/ru`, `/he` render translated route names, vehicle classes, itinerary days and prices in local number format.

---

## 5. Transfers went live

The transfers vertical was the most finished part of the front end and the least
real: six pages, four languages, and every price computed in the browser from
two sets of coordinates in `data/transferLocations.ts`. Checkout wrote a draft
to `sessionStorage`, invented a reference like `IG-8F2K4Q`, and told the
traveller they were booked. Its own source said so — *"Nothing is sent anywhere;
there is no request and no server."*

It is now a real product, backed by `server/`.

### What moved, and why

**Pricing left the browser.** `getRouteMetrics`, `quoteFor`, `quotesForQuery`
and `totalFor` are gone from `lib/transfers/query.ts`. The arithmetic was not
wrong — it is the same maths, in `server/services/transfer/pricing.service.js`,
in integer cents. What was wrong was where it ran: a price the browser computes
is a price the browser can change, and a catalogue the browser carries goes
stale the moment an operator edits it.

The module kept everything that never needed a fare — reading the journey out
of the URL, validating it, formatting it — and a comment where the engine used
to be, saying where it went.

**Money became minor units.** `types/transfer.ts` carried plain-number dollars;
every figure is now integer cents with a currency beside it, matching
`types/catalogue.ts` and the API. Components format through `lib/money.ts`
rather than `formatPrice`.

**The catalogue became a database.** Nineteen hardcoded pick-up points and nine
offers became 67 points, 9 vehicle classes and **396 routes** seeded from the
operator's own brief, with 3,564 prices. `data/transfers.ts`,
`data/transferLocations.ts` and their two `data/i18n` companions are deleted;
the vocabulary they also held — filter chips, sort options, passenger bands —
moved to `lib/transfers/vocabulary.ts`, because it is interface, not data.

The ka/ru/he prose in those files was not thrown away. `server/scripts/
seed-transfer-translations.js` reads it out of the last commit that held it and
writes it into the translation tables, mapping the four ids that changed
(`tbs-airport` → `tbilisi-airport`, and so on).

**Checkout posts.** `lib/transfers/booking.ts` and its `sessionStorage` draft
are deleted. The form sends a signed quote token with an idempotency key, and
handles the two answers that are conversations rather than failures: `409
PRICE_CHANGED` when the fare moved while the traveller was typing, and `410`
when the quote went stale.

`transfers/confirmation?ref=…` became `transfers/confirmation/[reference]`,
reading a real booking. The email in the query string is not decoration:
references come from a sequence and are enumerable, so the server requires the
address the booking was made under.

### New pages

- **`/transfers/routes/[slug]`** — a landing page per route, with translated
  copy, a from price and `Service` structured data. This is what a catalogue of
  named routes is *for*: a result set has nothing to offer an index, but
  "Tbilisi Airport to Gudauri transfer" is a thing people search for.
- **The panel**, at `/admin/transfers/…`: `routes` (with a bulk repricer),
  `routes/[id]`, `vehicles`, `vehicles/[id]`, `points`, `extras`, `bookings`
  and `bookings/[reference]`.

  The route screen is the one that earns its keep. It carries the price grid
  across every vehicle class — saved whole, so a half-applied set of fares
  cannot happen — the landing-page copy, the stops editor, and the closed-date
  windows that stand in for inventory. A publish checklist refuses a route with
  no price at all, because publishing one would silently fall through to the
  distance estimate.

  The bulk repricer on the list screen exists because 396 routes × 9 classes is
  over three thousand fares. It requires a filter (there is no "everything"
  option, here or in the API) and fills gaps by default rather than overwriting.

### Finding a transfer booking

`BookingLookupForm` routes by reference prefix: `TRF-` goes to the transfer
confirmation page, `BKG-` to the hotel one. They are separate records with
separate endpoints, so a single page that tried both and saw which answered
would 404 half the time on its way to succeeding.

### The picker had to change

`LocationSelector` filtered nineteen places in memory. It now asks the server,
debounced and guarded against out-of-order replies. That is not just a data
source change: the server matches names, regions, IATA codes **and every
translation**, so a Russian reader typing "Кутаиси" finds the row an English
reader finds typing "Kutaisi" — which a client-side filter over English
fixtures could never do.

### Still true

Four locales, RTL Hebrew, the design tokens, the URL-as-state search: all
unchanged. `tsc --noEmit` clean, `eslint` clean, `next build` succeeds, and the
server suite is 599 green.

---

## 6. Outstanding work

Being explicit, because the site is **not** fully translated yet. The app is fully working in English; untranslated components show English rather than breaking.

### Where translation stands

| Section | UI strings | Editorial content |
| --- | --- | --- |
| Chrome, home, index heroes | ✅ | — |
| Transfers | ✅ | ✅ (in the database) |
| Tours | ✅ | ✅ |
| Hotels | ❌ | ❌ |
| Destinations | ❌ | ❌ |
| Experiences | ❌ | ❌ |
| About, Contact, RequestModal | ❌ | — |
| Admin panel | ❌ | — |

The merge layer is built and proven, in both forms: `data/i18n/tours.ts` for content the client still carries, and the `transfer_*_translations` tables for content that has moved to the database. Which one a vertical should use is decided by whether an operator needs to edit it — hotels are already live records, so they follow transfers; tours moved the same way in §11, and no vertical uses the client-side merge any more.

### Files that still hold hardcoded English UI text

The dictionaries already contain most of these keys — the files simply do not read from them yet.

```
components/hotels/*            BookingSummary, HotelFilters, HotelExplorer,
                               HotelCard, HotelListItem, HotelRoomCard,
                               HotelPolicies, HotelReviews, HotelAmenities,
                               HotelSearchPanel, HotelSectionNav
app/[locale]/(site)/hotels/[slug]/page.tsx
app/[locale]/(site)/destinations/**            DestinationCard, DestinationFeature
app/[locale]/(site)/experiences/**             ExperienceCard, ExperienceExplorer,
                                               ExperienceBookingCard
app/[locale]/(site)/about/page.tsx
app/[locale]/(site)/contact/page.tsx           + components/contact/ContactForm
components/ui/RequestModal.tsx
components/admin/*                             the older 15 files, entirely English
```

Two vocabulary maps are still English-in-data and should move to the dictionary the way vehicle classes and features did: `amenityLabels` in `data/amenities.ts` and the `label` fields on `hotelSortOptions` / `propertyTypes` in `data/hotels.ts`.

### Editorial content still English-only

| File | Words | Entities | Status |
| --- | --- | --- | --- |
| `data/tours.ts` | 3,262 | 10 | ✅ translated |
| ~~`data/transfers.ts`~~ | — | — | moved to `transfer_vehicles` |
| ~~`data/transferLocations.ts`~~ | — | — | moved to `transfer_points` |
| `data/hotels.ts` | 3,768 | 9 | ❌ |
| `data/destinations.ts` | 2,392 | 8 | ❌ |
| `data/experiences.ts` | 1,858 | 8 | ❌ |

So hotel descriptions, room names, guest reviews, destination copy and experience listings still render in English on `/ka`, `/ru` and `/he`.

Hotels are the largest and most awkward of the three: each property carries rooms, policies, category score labels, nearby places and fictional guest reviews. The reviews are worth a decision rather than a default — a translated "verified guest review" is a slightly odd artefact, and leaving them in the reviewer's own language may read as more honest than translating them.

### RTL is partial

`dir="rtl"` is set and Hebrew mirrors correctly in the header, footer, nav, home sections and the whole transfers and tours flow. The files listed above still use physical `pl-` / `left-` / `text-right` classes, so those areas will not mirror until converted — `HotelRoomCard`, `HotelSearchPanel` and `BookingSummary` are the visible offenders.

### Translation quality

The Georgian, Russian and Hebrew UI copy was **AI-generated, not human-reviewed**. It is accurate and idiomatic, but this is marketing copy for a premium brand, and lines like *"Guests are a gift from God"* carry cultural weight that deserves a native speaker before launch — particularly the Georgian, where the source is quoting a Georgian idiom back to Georgian readers.

### Minor

`text-[0.8125rem]` appears 15 times, duplicating `.type-caption` — worth folding into the type scale for the same centralisation reason. The brand gradient (`#EB6830 → #D95624`) is not implemented; nothing uses it, and adding unused CSS seemed worse than leaving it out.

---

## 7. File reference

### Created

```
proxy.ts                          Locale routing (Next 16 middleware convention)
lib/i18n/config.ts                Locales, direction, URL helpers
lib/i18n/server.ts                getI18n() for Server Components
lib/i18n/provider.tsx             LocaleProvider + useI18n() for Client Components
lib/i18n/dictionaries.ts          Dictionary lookup + fill()
lib/i18n/cookie.ts                Locale preference persistence
lib/i18n/ui/en.ts                 English — source of truth for the schema
lib/i18n/ui/ka.ts                 ქართული
lib/i18n/ui/ru.ts                 Русский
lib/i18n/ui/he.ts                 עברית
components/layout/Logo.tsx        Brand mark (placeholder — replace with real artwork)
app/icon.svg                      Browser tab icon
```

### Substantially rewritten

```
app/globals.css                   Design tokens, type scale, scrims, RTL-safe utilities
app/[locale]/layout.tsx           Root layout — lang/dir, fonts, provider, hreflang
lib/navigation.ts                 Nav items now carry dictionary keys, not labels
components/layout/Header.tsx
components/layout/Footer.tsx
components/layout/LanguageMenu.tsx
components/layout/MobileNavigation.tsx
components/home/*.tsx             All 10 sections
```

### Structural change

Every route moved from `app/*` to `app/[locale]/*`. `app/globals.css` and `app/icon.svg` stay at the `app/` root.

---

## 8. Error handling

What happens when the API does not answer, decided once rather than per screen.

### The client

`lib/api/client.ts` remains the only `fetch` against the API, and now also decides what "no answer" means:

- **Every request has a timeout** — 15 s by default, overridable per call with `timeoutMs`. It applies to Server Components too, so a socket that never answers cannot hold a page render open indefinitely. A caller-supplied `signal` is still honoured; the two are combined.
- **`NetworkError extends ApiError`** with `status: 0` and `kind: "network" | "timeout"`. A rejected `fetch` (offline, DNS, connection refused) and a fired timeout both become one, carrying a message fit to show. Only the `fetch` promise is wrapped, so `redirect()` / `notFound()` thrown by callers are untouched. A caller's own abort is re-thrown as-is.
- **`describeError(error, fallback?)`** is the one way to turn a caught error into a sentence. An `ApiError` (including `NetworkError`) speaks for itself; anything else — a bug — gets the generic fallback, or a domain-specific one where the screen has more to say ("Could not close those dates."). The previous ~26 hand-rolled ternaries all use it.

### Boundaries

| File | Catches | Chrome kept |
| --- | --- | --- |
| `app/global-error.tsx` | The root layout itself | None — brings its own `<html>`, imports `globals.css`, English only |
| `app/[locale]/(site)/error.tsx` | Any public page | Header and footer; localised via `t.error.*` |
| `app/[locale]/(site)/transfers/error.tsx` | Transfers, with its own wording | As above |
| `app/[locale]/(admin)/admin/(panel)/error.tsx` | Any panel screen | Sidebar and top bar |
| `app/[locale]/(admin)/admin/error.tsx` | The panel shell and the sign-in screen | None |
| `app/[locale]/(portal)/portal/error.tsx` | Any portal page | Portal header and nav |

The new boundaries use Next 16.3's `retry` prop rather than `reset`: the failing content is server-rendered, and re-rendering the same failed payload would only fail again. `app/[locale]/(portal)/portal/not-found.tsx` gives a partner who hits a bad reference a portal-styled 404 instead of the marketing one.

### What is guarded, and what is not

Primary content is left to the boundary — a hotel list, a bookings register or an admin table that cannot load *is* the failure, and a page pretending otherwise is worse. Decoration is guarded: the panel's sidebar counts render as zeros, the hotel page drops its "more properties" rail, and the partner dashboard says its recent-bookings list is unavailable while still showing the figures above it. `useViewer` no longer treats a failed `/api/auth/me` probe as "signed out" — only a 401/403 does; anything else leaves the answer unknown and is retried on the next mount.

---

## 9. Admin navigation

The sidebar had gone flat and lopsided. Inventory listed seven destinations, four of which were transfers — routes, fleet, pick-up points, extras — so the vertical that happened to own the most screens visually outweighed hotels, destinations and tours put together. It was also the reason `/admin/transfers/bookings` had no entry at all: there was nowhere left to put it.

### Three levels, each earning its place

`lib/admin/navigation.ts` now describes **groups** (Operations, Inventory, Network), **sections** (a vertical with several screens) and **items** (the screens). `AdminNavEntry` is a union of item and section, narrowed by `isAdminNavSection`, so a group can hold either and the sidebar renders whichever it finds.

A vertical stays flat until it has more than one catalogue screen. Hotels, destinations and tours each have exactly one way in, and a disclosure wrapping a single link is a control that hides one thing. Only Transfers is a section today.

| Group | Contents |
| --- | --- |
| Operations | Overview · Hotel bookings · Transfer bookings |
| Inventory | Destinations · Hotels · **Transfers** (Catalogue: Routes, Pick-up points, Vehicle classes, Extras — Fleet & drivers: Fleet, Drivers, Schedule, Ratings) · Tours |
| Network | Partners · Applications |

### Sub-groups inside a long section

Transfers grew from four screens to eight once the fleet half landed (§10), and one run of eight rows under a single disclosure stopped being scannable. `AdminNavSection` now holds `groups: AdminNavSubgroup[]` — a labelled run of items — rather than a flat `items`, and `adminSectionItems(section)` flattens them for the callers that only care about the screens (active state, badge roll-up).

The split follows the line the product itself draws: **Catalogue** is what a traveller buys (routes, the points they run between, the vehicle classes, the extras), **Fleet & drivers** is what turns up to drive them (cars, drivers, their schedule, their ratings). The catalogue is admin-only and changes rarely; the fleet is worked every day and is the half a dispatcher is allowed to see.

In the sidebar each sub-group is its own `<ul>` under a small uppercase caption, `aria-labelledby` it, with a hairline (`border-t border-on-dark/10`) between neighbours. Captions render only when a section has more than one sub-group left: `navigationFor("DISPATCHER")` filters items and then drops any sub-group left empty, so the dispatcher's Transfers section is a single uncaptioned run — a divider with nothing on the other side of it would be a line for its own sake.

### The active-state trap

The old file carried a comment explaining why Transfers could not be a parent: `isAdminPathActive` matches on a path prefix, so an entry at `/admin/transfers` stayed lit while a child screen was open and two rows looked selected. That constraint is gone, not worked around — `isAdminSectionActive` asks whether **any child** is active rather than testing the shared prefix.

That distinction is now load-bearing. Transfer bookings sits at `/admin/transfers/bookings`, under the same prefix, but it is an Operations screen and belongs to no catalogue section. A prefix test would light up Inventory → Transfers every time an operator opened a transfer booking. The child test does not.

The section header is a `button`, not a link — `/admin/transfers` only redirects, and a disclosure that is also a link is a control whose click does two different things depending on where it lands. The redirect stays as a bookmark catcher.

### Two registers, both named

Adding Transfer bookings meant "Bookings" stopped being unambiguous, so it is now **Hotel bookings**. A `TRF-` reference is not a `BKG-` one — the two registers share no identifier space and were never going to merge.

### Behaviour

- **Expanded by default.** The panel is worked by keyboard all day; hiding four screens behind a click to save four lines is a bad trade. The collapse is for an operator who never touches transfers.
- **A collapsed section opens itself** when the route moves inside it, so the sidebar can never hide the screen you are looking at. Done by adjusting state during render, not in an effect — it has to be true on the first paint after the navigation, not one frame later.
- **Collapse survives navigation.** `AdminShell` is a persistent client layout, so `AdminSidebar` is not remounted between panel screens. No storage, no hydration mismatch.
- **Badges roll up.** A collapsed section shows the sum of its children's queue counts, or collapsing would be a way to lose work. Nothing under Transfers is badged yet; the mechanism is there so the first one that is cannot go unnoticed.

### RTL and a11y

The disclosure chevron uses `rotate-180` rather than a left/right glyph — a rotation, not a direction, so it must not flip in Hebrew. The child run is indented with `ms-[1.3125rem]` against a `border-s` rail aligned to the parent's icon; both move to the right in Hebrew with everything else.

Each group's `<ul>` is now `aria-labelledby` its heading, the section button carries `aria-expanded` and `aria-controls`, and `aria-current="page"` stays on the leaf link — never on the section, which is not a destination.

---

## 10. Fleet, drivers and dispatch

The transfer module gained its operational half: physical cars, driver profiles with their own login, a dispatch board, a schedule, ratings and a mobile-first driver panel. Front-end decisions worth knowing:

- **Three panels, three guards.** `requireAdminSession` now admits `DISPATCHER` as well as the two admin roles (`TRANSFER_OPS_ROLES` in `types/auth.ts`); `requireDriverSession` guards the new `(driver)/driver` route group; `homePathFor(session)` is the one place that decides where a signed-in account belongs, used by every sign-in and activation redirect. `Session.driver` carries the driver's own profile, null for everyone else.
- **The driver panel is a phone first.** `components/driver/DriverShell` is a thin top bar plus a fixed, safe-area-padded bottom tab bar (Today / Upcoming / History / Me) that becomes a top nav at `md`. Every action is one large button; `AssignmentControls` sends `expectedFrom` with each milestone so a double tap on a bad connection cannot skip a step, and a `STALE_STATE` 409 simply refreshes.
- **The dispatch board lists legs, not bookings** (`/admin/transfers/dispatch`): a return is two jobs on two days. Row actions come from `allowedTransitions`, the same table the API enforces. `AssignDriverModal` mounts its form only while open, so every open starts clean without resetting state in an effect; candidates arrive ranked with their conflicts shown rather than hidden, and a 422 `OVERRIDE_REQUIRED` from the server surfaces the exact checkbox it needs.
- **Private files never get a URL.** `DocumentsPanel` (shared by `FleetDocuments` and `DriverDocuments`) opens a document by asking for a short-lived signed link; the facts (type, label, expiry) are all the page ever holds. Function props reach it through thin client wrappers, since a Server Component cannot hand a function down.
- **The sidebar renamed "Fleet" to "Vehicle classes"** and added Fleet, Drivers, Schedule and Ratings under Transfers, and Dispatch (badged with undriven legs) under Operations. A dispatcher's layout skips the partner and hotel queue counts it cannot read. The eight Transfers screens are split into two captioned sub-groups with a divider between them — see §9, "Sub-groups inside a long section".
- **What a partner sees of a driver** is `DriverCard` on the portal transfer booking: photo, name, verification, rating, languages, the car, and the phone number only once the server has released it. `RateDriverForm` appears on a completed leg until it has been rated; `/portal/drivers/[id]` is the profile with cars and published reviews.
- **The passenger's rating page** (`/transfers/rate/[token]`) is a site page and therefore translated — `transfers.rating.*` in all four dictionaries.
- **Still English:** the driver panel chrome and the admin dispatch screens, as with the rest of the admin panel (§6). A Georgian and Russian driver panel is the obvious next i18n step.
- **A partner picks the driver at checkout.** `components/transfers/DriverChoice` sits in the transfer booking form for an approved partner (or an admin) and asks `POST /api/partner/drivers/available` with the offer's quote token: verified drivers with a car of the booked class that is free across every leg, each with photo, rating, languages, bio and the car's photographs. "Let us assign a driver" stays the default. The choice travels as `preferredDriverId` / `preferredFleetVehicleId`; a `409 DRIVER_UNAVAILABLE` or `422 DRIVER_NOT_ELIGIBLE` clears it and remounts the list (`key` bump) rather than failing the booking. The confirmation page shows the requested driver through `RequestedDriver` — translated, `transfers.booking.driver*` in all four dictionaries — as "awaiting confirmation" until they accept; the portal's `DriverCard` does the same with `awaitingDriver`. Language names come from `Intl.DisplayNames`, not a dictionary.
- **Admins can delete a car or a driver** from the danger zone on its page (`canDelete` is decided by the page from the session; the server refuses non-admins regardless). Only while the record has never been on a job — the server answers 409 `HAS_ASSIGNMENTS` otherwise, and the panel shows that message with archive/deactivate as the way forward. The plate, or the surname, has to be typed back first.

---

## 11. Tours went live

Tours were the last vertical on fixtures. `data/tours.ts` and `data/i18n/tours.ts` are gone, the merge layer in `data/i18n/merge.ts` with them, and every tour on the site, in the portal and in the panel is a live record from `/api/tours` and its neighbours. The editorial prose moved to the server with the seed that loads it (`server/db/seed/tours.js`), so nothing was lost — it just stopped being shipped to the browser.

### The shape, in one paragraph

A tour is sold through **options** (a shared seat or a private group, per person or per group, confirmed instantly or by the operator), each with **price sheets** by season and party size and **departures** — a capacity row per date. What the site asks for is a *date and a party*; what it gets back is every option priced for every departure in the two weeks after that date, each either bookable with a signed token or explained (`SOLD_OUT`, `PARTY_SIZE`, `TOO_SOON`…). Everything downstream mirrors the hotel flow: hold → checkout → `TUR-` reference.

### What changed on the site

- **`/tours`** is two pages behind one route, as `/hotels` is. Without a date it browses the catalogue through `TourExplorer` (client-side filters over a few dozen records — a round trip per keystroke would be slower and no more correct). With one it is a real search: `/api/search/tours?date&adults&childAges` returns only journeys with a departure that day for that party, rendered as `TourResultCard`s with a real total.
- **`/tours/[slug]`** carries the `TourSearchForm` (date + party with child ages, `lib/tours/query.ts`) and a `TourDepartures` section: every option, every date in the window, with "Reserve" taking a hold *before* the traveller types a name. Unsellable dates stay on the page with their reason — a calendar with a sold-out Saturday on it is more useful than one with a gap. The sticky `TourPanel` says "from" per person, a real total for the party, or "nothing in that window", and never confuses the three.
- **`/tours/checkout`** is its own route. A tour hold is a different record on a different endpoint and the form asks for different things — passports, nationality, dietary needs, a pick-up note — so it did not become a mode of the hotel checkout. The draft lives in its own `sessionStorage` key (`createDraftStore` in `lib/booking/checkoutSession.ts` now makes one store per product), so a hotel and a tour checkout in two tabs cannot clobber each other.
- **On request is a first-class state.** An option with `confirmationMode: ON_REQUEST` ends in a *request*: the button says "Send request", the confirmation page says "Request sent" with what happens in the next 48 hours, `t.tours.status.PENDING` reads "Awaiting confirmation", and the cancel panel says a request the operator has not answered is cancelled at no charge. Telling a traveller they are booked when the guide has not said yes is the one thing these screens must never do.
- **`/booking/confirmation/[ref]`** and **`/booking/manage/[ref]`** branch on the `TUR-` prefix (`TourConfirmationView`, `TourManageView`), so the lookup form and the confirmation email need no new URLs.
- The homepage rail (`SignatureTours`) reads featured tours from the API, topped up from the programme when fewer than three are flagged, and is guarded — with `unstable_rethrow` first, because a catch that swallows Next's dynamic-usage signal leaves a static home page with no rail.

### Dictionary

`t.tours.planning.*` (the prototype "request this journey" card) is gone from all four languages; `t.tours.{search,results,availability,checkout,confirmation,manage,cancel,status,optionKinds}` and `units.seat` were added to all four. `BookingSteps` takes `labels` so the tour checkout can say "Choose a departure" where hotels say "Choose a room".

### Portal

`/portal/bookings` grew a product tab (`?product=tours`) backed by `/api/partner/tours/bookings`; the register component (`TourBookingsBrowser`) is shared with the panel and differs only in where a reference links. `/portal/bookings/TUR-…` shows the same frozen record the traveller sees, `PortalTourBookingEditor` for the paperwork (lead traveller, pick-up note, requests — never the departure, party or price), and cancellation priced off the frozen terms.

### Panel

- **Operations → Tour bookings** (`/admin/tours/bookings`), badged with `pendingTourRequests`: on-request bookings the operator has yet to answer. Their seats are already claimed, so a request left waiting is capacity nobody else can buy. The detail page carries `TourBookingActions`: confirm, decline with a required reason (the agency reads it word for word), or cancel with the frozen-terms charge shown first.
- **Inventory → Tours** is a real register (`ToursBrowser`, `HotelStatusBadge` reused since `TourStatus` is a subset), a create wizard (`NewTourForm`) and a hub per tour with the publish checklist, `TourActions` (publish / off sale / archive / delete, plus the B2C and featured switches) and five sub-screens: details & itinerary (`TourDetailsEditor` — the itinerary is sent whole and renumbered), options & prices (`TourOptionsManager` — options, and price sheets as a tier grid in net minor units with an optional fixed sell), departures (`TourCalendarManager` — a 28-day grid and a range editor; a reduction below what is booked surfaces the server's 409 with the dates), images (`TourGalleryManager`, `TOUR_IMAGE`), translations (`TourTranslationsEditor`, one tab per language, blank fields fall back to English).
- Two endpoints were added server-side for the panel: `GET /admin/tours/:id/translations` and `GET /admin/tours/policies/cancellation` (the platform templates a tour option may use — those priced against the whole total, since a tour has no first night).
- `InventoryBrowser` and `ListingEditor`, the fixture-era prototypes, are deleted.

### Gotchas

- New routes need `npx next typegen` (or a build) before `PageProps<"/[locale]/…">` type-checks — the route union is generated.
- `types/tour.ts` is now the live shape and `Tour` means the API record; the fixture `Tour` no longer exists anywhere.

## 12. Packages and orders went live

The fourth product, and the first that is not one thing. A **package** is an
admin-defined template of typed slots — a hotel stay, a transfer, a tour, a
service — with no price of its own; an **order** is what a package becomes when
somebody books it, and it is four bookings written in one transaction.

### Site

- **`/packages`** browses undated, filtered in the browser (`PackageExplorer`),
  because the whole catalogue is a page of records and a region chip should not
  cost a round trip. A date does not change what the listing queries: pricing a
  package means resolving four products through four engines, and doing that per
  card would be a search page measured in seconds. The date is carried onto the
  cards instead, so a buyer who picked one lands on a package already priced.
- **`/packages/[slug]`** is the brochure until a start date arrives, then
  `PackageBuilder`. Its slot rows re-quote by **rewriting the URL**, not by
  patching a total: the package adjustment is allocated across every line, so one
  changed room moves all of them, and only the server knows by how much. Choices
  travel as one `choices` JSON parameter (`lib/packages/query.ts`) because a rate
  plan for slot 0, a vehicle for slot 1 and an option for slot 2 spelled out
  separately is a query string nobody can read.
- **`/packages/checkout`** has nothing in the URL. A composite offer runs to
  several thousand characters and its holds are a map rather than one string, so
  the whole thing lives in the tab's own draft (`saveOrderCheckoutDraft`). A
  refresh resumes it; a fresh tab says so plainly — the rooms are held against
  the offer, not against the address bar.
- **The refusals are the interesting screens.** A confirm can come back `409`
  with a per-slot breakdown, and the form renders it that way: which part moved
  and from what, or which part went. One round trip, the whole picture.
- **`/booking/confirmation/[ref]`** and **`/booking/manage/[ref]`** branch on the
  `ORD-` prefix, alongside `BKG-` and `TUR-`.
- **`CompleteYourTrip`** is the cross-sell rail on the hotel and tour pages:
  airport transfers, tours during the stay, packages containing the anchor, all
  priced for the real dates by `/api/recommendations`. It renders only once dates
  are chosen — undated it would be a rail of prices nobody could book — and a
  failure renders nothing at all, because a hotel page must not 500 because the
  transfer catalogue has no airport near the property.

### Orders, read four ways

`OrderDetail` is shared by the confirmation page, the guest's manage page and the
portal, because all three show the same record and differ only in what they let
you do to it. Each item shows **its child booking's own reference**: a traveller
at a hotel desk quotes `BKG-…`, not `ORD-…`.

Dropping an optional part states the **clawback** before you confirm it — the
discount was given for booking the trip whole, so the share carried by that part
is not refunded, and that belongs on the screen where the decision is made rather
than in an email afterwards. A required part explains itself instead of offering
a button the server would refuse with `REQUIRED_COMPONENT`.

### Panel

- **Operations → Orders**, badged with `pendingOrders`: orders holding a request
  nobody has answered. Their rooms and seats are already claimed, so a queue left
  standing is capacity nobody else can sell. The detail page confirms, declines
  and cancels per item, and the copy distinguishes the two declines — an optional
  part is dropped and the total shrinks, a required part cancels the whole order
  at no charge, because the failure is the supplier's.
- **Inventory → Packages**: register, create, and a hub with the publish
  checklist, the kosher eligibility re-judged against live certificates on every
  read, and six sub-screens. `PackageComponentsBuilder` writes the slot set
  **whole** — the server replaces and re-validates it together, because a slot is
  only correct relative to its neighbours — and renders a `422`'s per-slot
  `problems` on the offending row. `PackagePreviewQuote` runs the real engine on a
  draft with net beside sell, which is where a template that cannot sell should be
  found.
- **Inventory → Services** is one screen: a service has no inventory, no
  departures and no gallery, so splitting four fieldsets across four routes would
  be navigation for its own sake.

### Dictionary

`t.packages.*` and `t.orders.*` in all four languages, including the kosher
vocabulary a Hebrew-reading traveller expects (הדלקת נרות, הבדלה, השגחה) rather
than a literal rendering of the English. `nav.packages` joins the primary
navigation, so the platform now sells four things from the header.

### Gotchas

- **A Server Component cannot pass a function to a Client Component.** The first
  version of `OrderDetail` took an `itemAction` render prop and 500ed on the
  manage page. It takes `cancel={{ quote, email }}` — serialisable data — and
  renders the control itself.
- New routes still need `npx next typegen` before `PageProps<"/[locale]/…">`
  type-checks.
- `MediaCategory` gained `PACKAGE_IMAGE`; a gallery upload silently 400s without
  it.

## 13. Responsive audit

Every public, admin and driver route was loaded in a real Chromium at 360, 390,
768, 1024 and 1280px (Hebrew and Georgian included) and probed for horizontal
overflow: `documentElement.scrollWidth` against the viewport, plus a walk over
every element whose box left the viewport. Phone-width screenshots were then
read by eye. What follows is what was broken, and the rule each fix leaves
behind.

### Header: two display utilities on one element

On phones the header showed "Admin panel" and "Plan your trip" next to the
burger, pushing the burger off the right edge (and off the left edge in
Hebrew). Both controls were given `hidden sm:inline-flex` through `className`,
but `AccountNav` and `Button` set `inline-flex` themselves, and `cn()` is a
plain join — two display utilities on one element resolve by **stylesheet
order**, and `inline-flex` won. The `Button` file already warns about this for
colours.

The rule: never pass an unprefixed `hidden` into a component that sets its own
display. Show and hide it through a wrapper — `<span className="hidden
sm:contents">` — which has no display of its own to fight. Prefixed variants
(`lg:hidden`) are safe because a media-query rule always sits later in the
sheet than the base utility.

The account link is icon-only between `sm` and `md`: on a 640px row the
wordmark, language menu, trip button and burger left no room for a Georgian
label, and the burger went off the edge again. The accessible name stays on
the link.

### Search forms: fixed widths and `fr` minimums

`StaySearchForm` overflowed the tablet by 30px: four fields and a labelled
button need about 800px on one line and a 768px screen gives 704. It now runs
one column on a phone, two (index) or three (property page) at `md`, and a
single row only from `lg`. Cell borders are set per cell rather than with
`divide-*`, because the divide utilities have no idea where a grid row starts.

All three search forms (`Stay`, `Tour`, `Package`) had fixed-width submit
buttons (`md:w-40`, `md:w-44`) that clipped the Georgian label — "თავისუფალი
ნომრების ნახვა" is a sentence, not a verb. The button column is `auto` and the
field tracks are `minmax(0, …)`, so a long label widens the button and the
fields give way, never the page. A bare `1fr` track has a min-content minimum
and will push a row past its container; `minmax(0, 1fr)` is the form that
shrinks.

### Admin: tables inside grid columns

The overview, the tour-booking, order and transfer-route detail screens were
~750px wide on a phone. `DataTable` scrolls inside its wrapper, but a scroll
container still reports its content's min-content width upwards, so the
`min-w-[44rem]` table sized its grid column. `DataTable`'s wrapper now has
`contain-inline-size`, which sizes it from its parent alone; `AdminPanel` and
every `lg:col-span-*` wrapper in the panel and portal carry `min-w-0` so no
other wide child can do the same. The date-range filters on the booking and
order lists wrap below `sm` instead of running past the edge.

### Lists: a `<select>` is as wide as its longest option

The sort control on the hotel and transfer lists was 408px on a 360px phone
in Georgian. A wrapped flex item is sized to its content, so the toolbar row
carries `max-w-full min-w-0` and the select `min-w-0`, and it shrinks to the
container instead of the page. The same `min-w-0` went on the label around
the tour list's two selects.

### Also fixed on the way

- `/transfers/[slug]` rendered `<Rating>` (a `div`) inside a `<p>` — invalid
  nesting and a hydration error on every visit.
- Order part rows (`OrderItems`) keep an 11rem text measure and let the price
  block wrap under it, instead of squeezing "Tbilisi International Airport"
  into a three-word-wide column beside the price.
- The driver account card's email could not break and overflowed by a pixel;
  the definition list's value column is `minmax(0, 1fr)` and the email
  `break-all`.

### Still open

- **Georgian `Intl` output differs between server and browser.** Chromium
  ships no `ka` locale data (`Intl.NumberFormat.supportedLocalesOf(["ka"])` is
  empty and `ka-GE` resolves to `en-US`), while Node has full ICU. Every price,
  date and grouped number on `/ka` therefore hydrates differently — "1304 ₾"
  on the server, "GEL 1,304" in Edge — and React regenerates the tree with a
  console error on each Georgian page. The fix is a decision, not a patch:
  either a deterministic Georgian formatter for money and dates (against the
  "never hand-format" rule, but the only way both sides agree), or an
  `Intl` polyfill for `ka` loaded on the client. Firefox does carry `ka`, so
  the mismatch is browser-specific.
- Partner portal screens were reviewed by code only; the audit had no partner
  credentials.
- Audit script and findings live outside the repo; the check is worth
  turning into a Playwright test that asserts `scrollWidth === innerWidth`
  for a route list at three widths.

---

## 14. SEO, sharing and public URLs

An audit of how the four entity pages — hotel, tour, transfer vehicle,
package — look to a search engine and to a link-preview crawler, followed by
the fixes. Everything is server-rendered (App Router, dynamic per request), so
the metadata a crawler needs was already in the initial HTML; the gaps were in
what that metadata said and in which status codes went with it.

### What was already in place

`lib/seo/metadata.ts` (`pageMetadata`: title template, clamped description,
self-referencing canonical, reciprocal hreflang, Open Graph, Twitter card),
`lib/seo/jsonLd.tsx` (Organization, WebSite, BreadcrumbList, Hotel,
TouristTrip), `app/robots.ts`, `app/sitemap.ts` read from the catalogue, and
`noindex` on the admin, driver and portal trees and on every checkout, token
and results page. The API serializers gate net rates, suppliers, commissions
and channel flags behind the viewer, and the sitemap reads anonymously.

### What was wrong

| Problem | Effect | Fix |
| --- | --- | --- |
| `/transfers/[slug]` was `noindex` with no canonical, hreflang, card image or JSON-LD | Vehicle pages invisible to search; shared links got the generic card | `pageMetadata` + `Service` JSON-LD; bare URL indexed, dated variants canonicalise to it |
| `/packages/[slug]` had no JSON-LD and no `priority` on its gallery | No rich-result eligibility; LCP image lazy | `BreadcrumbList` + `TouristTrip` (itinerary from the rendered days, `Offer` only from the brochure's own "from" price); gallery lead is the LCP |
| Packages and vehicles missing from the sitemap | New records never discovered | Two more sections, read anonymously like the rest |
| The API resolves `id OR slug` and lowercases the slug, so `/hotels/<uuid>` and `/hotels/Vera-House` rendered as duplicates | Duplicate URLs, database ids in circulation | `lib/seo/slug.ts` — a 308 to the record's own slug, query string preserved |
| `hotels/`, `tours/` and `transfers/` each had a `loading.tsx` above their `[slug]` route | Every 404 and redirect on a detail page streamed as a **200** (soft 404) | Listing page and skeleton moved into an `(index)` route group; the retired `destinations`/`experiences` skeletons deleted. Detail pages now answer 404 and 308 for real |
| `/en/...` redirected with 307 | Signals not consolidated | 308 |
| Fallback card was the 1800×1196 hero declared as 1200×630 | Previews cropped to a lie | `public/images/social/default.jpg`, a real 1200×630 JPEG |
| Card images used whichever URL the gallery used first | WebP renditions are skipped by several preview crawlers | `lib/seo/social.ts` — cover, then first photo, then editorial frame, preferring the JPEG/PNG original, with dimensions |
| Share copied `window.location.href` (dates, filters, `utm_*`); no Web Share API; untranslated dialog | Shared links pointed at one visitor's session | `ShareSave` takes the canonical path, resolves it against the visitor's origin, offers the device share sheet where one exists and a copy row everywhere |
| Vehicle pages reachable only from the `noindex` search results | Orphaned for crawlers | Fleet names on `/transfers` link to the vehicle pages |

### Verified against the dev stack

For a hotel, tour, package and vehicle in all four locales: title with brand
suffix, description, self-referencing canonical, five hreflang links,
`og:title/description/image/url/type/locale`, `twitter:card/title/image`,
one `<h1>`, valid JSON-LD (`BreadcrumbList` plus `Hotel` / `TouristTrip` /
`Service`), and no supplier, net, margin or channel fields in the HTML. Status
codes: id and upper-case slug → 308 to the slug; unknown, trade-only and
archived records → 404; `/en/…` and trailing slash → 308. The sitemap carries
every section with per-locale alternates; robots disallows the three private
trees at all four prefixes.

### Not done, and why

- **Dev media bucket.** The dev database's uploaded images point at R2 objects
  that no longer exist (404), so hotel cards in dev preview with a broken
  image. Production uploads land beside their records; nothing to fix in code.
- **410 for archived records.** The API answers 404 for archived and unknown
  alike; a 410 needs the server to distinguish them. Google treats both the
  same, so this is low value.
- **Slug renames.** The schema keys on `id` so a slug can change, but nothing
  records the old one. A rename today is a 404 on every link that used it; a
  slug-history table with a 308 is the missing piece.
- **Dedicated per-entity preview cards** (name over the cover photograph via
  `ImageResponse`) would sharpen previews for entities without a photograph;
  the vehicle classes are the only such case today and get the brand card.

---

## 15. Admin help and tutorials

The panel had grown to sixty-four screens and explained none of them beyond
a panel subtitle and the odd form hint; a new administrator needed a
developer beside them. The manual now lives inside the panel, documents only
what exists, and is checked against the page tree in CI.

### The shape

- **Content is data, not markup.** `lib/admin/help/articles/<area>/<name>.ts`
  each export one `HelpArticle` — a list of typed blocks (paragraph, heading,
  steps, list, callout, table, definitions, where, links) rendered by one
  component, `components/admin/help/HelpBlocks.tsx`. Inline markup is limited
  to `**bold**` for a control's label and `` `code` `` for a status or a URL;
  `HelpInline.tsx` interprets those two forms and nothing else. No markdown
  library, no MDX, no sanitiser to get wrong.
- **Fourteen areas, eighty-one articles**, in `lib/admin/help/categories.ts`
  and the folders beside it. `index.ts` assembles the registry and filters it
  by the two audiences: `SUPER_ADMIN`/`ADMIN` read as `ADMIN`, `DISPATCHER`
  sees only what their sidebar reaches. An article a role may not read
  answers not-found, matching the 403 its screen would give.
- **Routes → articles.** Each article lists the screens it is the help for,
  in the page tree's own bracket form (`/admin/hotels/[slug]/rooms`), with an
  optional `#section`. `routes.ts` resolves a canonical path (locale stripped,
  as the sidebar does) to the most specific claim.
- **Three surfaces.** The hub at `/admin/help` (search, the role's Quick
  Start, the areas, "read before you click"), an area page, and an article
  page at reading width. Sidebar entry: a final `Support` group, `ops: true`
  so a dispatcher keeps it.
- **A Help button on every screen**, rendered by `AdminPageHeader` itself
  rather than by sixty-four pages. It imports the registry on click, never
  with the screen, resolves the article for the path and opens it in
  `ui/Modal` scrolled to the mapped section, with "Open as a page". A page can
  name its article (`help="ht-kosher"`) or opt out (`help={false}`). The
  viewer's role reaches it through `AdminViewerContext`, set once in the shell.
- **Quick Start** on the Overview (administrators) and on the dispatch board
  (dispatchers, whose Overview redirects). Ticks and dismissal live in
  `localStorage` through `useSyncExternalStore`, the cookie-notice pattern;
  the hub keeps an un-dismissable copy.

### What keeps it honest

`test/help-registry.test.ts` runs under plain Node (`npm test`, no runner
installed): ids unique and prefixed by area, every `related` id resolves to
something the reader may open, every route section is a heading in its
article, no two articles claim one screen, every `where` path names a real
sidebar group and entry — and every `page.tsx` under `(panel)` resolves to an
article or is listed in `HELP_ROUTE_EXEMPTIONS`. A new screen without help
fails CI. `scripts/ts-resolve-hook.mjs` lets Node find `./types` and `@/…`
the way the bundler does; the help data tree therefore uses `import type`
and relative imports only, and no `enum`.

### Deliberately not built

- Guided spotlight tours: no popover primitive exists, and every panel screen
  re-renders on `router.refresh()` after a mutation, which would unmount a
  tour mid-step. "Where" chips and numbered steps carry the same information.
- Screenshots: they go stale with every UI change. The `figure` block is
  reserved in the schema and rendered as nothing, so a capture pipeline can
  land later without a content migration.
- Localised help: the panel is English, so the manual is.
- Server-side onboarding state: no preferences table exists; per-browser is
  fine for a first-visit card.

### What the audit turned up, and left alone

Writing the manual meant reading every screen, and the articles say plainly
where a control acts without asking: the dispatch **Mark as…** select, the
**Confirm** buttons on requirements, order parts and tour requests, package
**Archive** and **Delete**, **Remove block**, blackout **Reopen**, the bulk
pricer's **Overwrite**. `rf-dangerous-actions` is the consolidated list. A
shared confirmation dialog on `ui/Modal` replacing those and the remaining
`window.confirm`/`window.prompt` calls is the obvious next piece of work; the
manual's wording changes from "fires immediately" to "asks first" when it
lands.

---

*Generated with [Claude Code](https://claude.com/claude-code)*
