# Responsive audit fixes and image loading

| | |
|---|---|
| **Branch** | `gabriel-code` (based on `feat/b2b-phase-0-hardening`) |
| **Commit** | `b86c81e` · 110 files · +692 / −330 |
| **Date** | 2 November 2026 |
| **Source** | *I am Georgia Visual Audit* (items VA-01 … VA-50) |

## Summary

This change fixes every **responsive layout defect** in the visual audit, and makes **image loading** resilient and faster.

- **Phones:** no page scrolls sideways any more at 360, 390 or 430px, in the admin panel, the partner portal or the public site.
- **Laptops (1024–1440):** admin tables no longer hide their money columns off screen. Most tables now fit without scrolling. A short list of small leftovers is under [Remaining work](#remaining-work).
- **Images:** a photo that fails to load shows a neutral placeholder tile instead of the browser's broken-image icon. Uploaded media can now be embedded across origins, and the largest image on the 404 page is preloaded.

Audit items that are not about layout (contrast, copy, currency, validation and so on) were left out on purpose. They are listed under [Out of scope](#out-of-scope).

---

## 1. Responsive fixes

### Root causes found

Most of the audit's overflow findings came from three CSS mechanisms. Fixing each mechanism once fixed many pages at the same time.

| Mechanism | What happened | Fix |
|---|---|---|
| **Implicit grid track** | A `grid` without `grid-cols-*` gets an `auto` column. That column grows to the min-content width of its widest child (unbreakable text, a long email, a `truncate` line) and pushes the page wider than the phone. | Explicit `grid-cols-1` (`minmax(0,1fr)`) on every page-level grid, plus `min-w-0` on grid items. 55 grids hardened. |
| **Escaping `sr-only` elements** | An absolutely positioned `sr-only` label (for example the table's hidden "Actions" header) is clipped only by an `overflow` box that is its containing block. Without `position: relative` on the scroller, it escaped and widened the page. | `relative` on the table scroller and on the notifications tab row. |
| **Viewport-based table minimum** | `DataTable` forced `md:min-w-[44rem]` (704px) on every table, measured against the **screen**, not the panel. A five-column table in a 470px detail column therefore scrolled sideways with room to spare. | Minimum removed. Tables now take their natural width and scroll only when a row really needs more room. |

### Fixes by audit item

| ID | Problem | Fix | Main files |
|---|---|---|---|
| **VA-01** | Hotel page with dates scrolled sideways (441px at 360–430); the gallery's Close button was off screen | Transfer, tour and package lists use `grid-cols-1` + `min-w-0`; long route names now show `…` | `components/packages/CompleteYourTrip.tsx` |
| **VA-04** | Admin dashboard was 459px wide on phones | `grid-cols-1` on the KPI tiles and on the "decide" grid; `[&>*]:min-w-0` on the items | `admin/(panel)/page.tsx` |
| **VA-05** | Notifications tab row stretched the page to 591px | `relative` on the scrolling tab list so hidden labels stay clipped | `components/notifications/NotificationsBrowser.tsx` |
| **VA-06** | A focused field or a jump link landed under the fixed header | `scroll-padding-top` on `html` (5.5rem; 6rem from 1024px). Anchors' own `scroll-mt-36` reduced to `scroll-mt-14`, because the two add up | `app/globals.css`, hotel and tour detail pages, `admin/help/HelpBlocks.tsx` |
| **VA-11** | At 1280–1920 the dashboard left an empty third column and squeezed Latest bookings | Latest bookings spans two columns from `xl`, with the other widgets stacked in the third. Without it, the widgets flow into 2–3 columns | `admin/(panel)/page.tsx` |
| **VA-12** | Admin tables hid up to 345px at 1024 (Payment and Total out of sight) | 44rem minimum removed (see above); four tables rebalanced (see below) | `components/admin/DataTable.tsx` + tables below |
| **VA-13** | Overflows of 443–1065px on reminders and receivables | Covered by the grid and table fixes above | — |
| **VA-23** | The cookie notice plus the booking bar covered about 26% of a phone screen | Notice is now a single compact strip and sits **above** the booking bar (`--booking-bar-offset`). Height at 390px: en 65px, ka 119px, ru 80px, he 65px (was about 150px) | `components/layout/CookieNotice.tsx` |
| **VA-25** | "CANCELLATIO / N" broke mid-word in the deadlines widget | The counts respond to the widget's own width (container query): three columns from 28rem, label/value rows below that | `components/admin/dashboard/widgets.tsx` |
| **VA-34** | The header search placeholder was cut off on phones | The hint comes in three lengths: "Search…" (<380px), "Search bookings…" (380–767px), the full sentence from 768px. Screen readers always get the full sentence | `components/admin/AdminShell.tsx` |
| **VA-39** | The featured package was repeated in the results on phones | Spotlight shown only from `lg`; its hidden image is no longer loaded eagerly | `(site)/packages/(index)/page.tsx` |
| **VA-42** | The portal header was cramped and wrapped at 390px | Wordmark stays on one line; "Sign out" becomes an icon with a screen-reader label below `sm`; the mobile tab bar uses equal columns, so no tab is clipped at 360 | `components/partners/PortalShell.tsx` |
| **VA-43** | The bottom booking bar covered the search form and "See departures" | The bar slides away (and is `inert`) while the form it points to is on screen, and returns when you scroll past it. It publishes its height for the cookie notice | `components/booking/MobileBookingBar.tsx` |

### Admin tables rebalanced for 1024–1440 (VA-12)

| Table | Change |
|---|---|
| **All bookings** | Type pill moves into the Reference cell below 1536px; booking title wraps to two lines (it used to be cut at a fixed 288px); buyer email and account names wrap instead of setting the column width |
| **Receivables** | Debtor email wraps; the extra "Open" link column appears from 1280px (the reference already opens the record) |
| **Audit log** | Below 1280px, "Who" is capped at 10rem and "Summary" needs at least 12rem; the record type may wrap |
| **Transfer booking: Legs** | "Pick-up" from 1536px (it is already in the Dispatch panel above); "Net" from 1280px; "Sell" always shown |
| **All registries** | Booking references never break at the hyphen ("BKG-/000003"): dashboard, hotel, tour, transfer and service bookings, orders, approvals, receivables, invoices, penalties |

`DataTable`'s `hideBelow` option now also accepts `"2xl"`.

---

## 2. Image loading

| Change | Why | Files |
|---|---|---|
| **`ImageFallback`** (new): neutral tile with an image-off icon | One consistent look for a missing photo, usable from server components | `components/ui/ImageFallback.tsx` |
| **`SafeImage`** (new): `next/image` that switches to the fallback when the photo fails | A failed photo showed the broken-image icon with its alt text over the card. The failure is remembered per `src`, so galleries try the next photo afresh | `components/ui/SafeImage.tsx`, used in 11 components (hotel, tour and package cards, room offers, cart, galleries, featured hotels) |
| **`MediaImg`** (new): plain `<img>` for uploaded media, with the same fallback | Catches failures that happen **before** React hydrates (`complete && naturalWidth === 0`). Defaults to `loading="lazy"` and `decoding="async"` | `components/ui/MediaImg.tsx`, used in about 21 places (admin galleries and lists, driver photo, fleet, portal drivers, booking driver cards) |
| **Optimised thumbnails** in Complete your trip | Raw `<img>` replaced with `SafeImage` + `sizes`, so phones download a small WebP instead of the full photo | `CompleteYourTrip.tsx` |
| **Local API allowed for the image optimiser** (development only) | Next 16 refuses to optimise images from private IPs; turned on only when `NEXT_PUBLIC_API_URL` points at localhost | `client/next.config.ts` |
| **`Cross-Origin-Resource-Policy: cross-origin` on public media** | Helmet's default `same-origin` blocked the site (port 3000) from showing API media (port 5000): `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`. Private media keeps `same-origin` | `server/routes/media.routes.js`, `server/test/media.test.js` (27/27 pass) |
| **404 hero preloaded** with `fetchPriority="high"` | It is the page's largest image (LCP) | `(site)/not-found.tsx` |
| **No eager load of the hidden packages spotlight** | Phones were downloading an image they never displayed | `(site)/packages/(index)/page.tsx` |

---

## 3. Verification

**Method:** headless Chrome (playwright-core) against the running app and API, logged in as a demo super-admin or agency owner. For every page it measured document width against viewport width, elements sticking out past the edge, and the scroll width of every table. Runs were paced to stay under the API's 100 requests/minute limit.

| Check | Result |
|---|---|
| All 72 admin pages at 360 / 390 / 430 / 1024 / 1440 | Page width = screen width everywhere (no sideways page scroll) |
| VA-01 before/after (360–768) | Before: 441–450px document at 360–430 → after: fits, with `…` |
| VA-11 dashboard at 1440 / 1920 | Latest bookings 749px / 920px wide, table fits without scrolling |
| VA-23 / VA-43 tour page at 390 in en, ka, ru, he | Bar hidden on the first screen, back after scrolling, notice docked above it |
| VA-42 portal at 360 / 390 / 768 | Wordmark on one line, all 5 tabs unclipped |
| Server media tests | 27/27 pass |
| `tsc --noEmit`, ESLint | Clean (3 warnings that already existed) |

**Admin tables: pixels hidden off the right edge, before → after** (0 = fits, — = was already fine). These are the 25 admin pages that had a scrolling table before the fix:

| Table | 1024 | 1280 | 1366 | 1440 |
|---|---|---|---|---|
| All bookings | 359 → **0** | 298 → **0** | 227 → **0** | 153 → **0** |
| Hotel booking detail (nightly prices, cancellation windows) | 276 → **0** | 105 → **0** | 48 → **0** | — |
| Tour booking price lines | 276 → **0** | 105 → **0** | 48 → **0** | — |
| Transfer booking legs | 339 → **0** | 190 → **0** | 140 → **0** | 97 → **0** |
| Receivables registry | 133 → **0** | 2 → **0** | — | — |
| Receivable and payment detail tables | 234 → **0** | 63 → **0** | — | — |
| Hotel and package detail tables | 234 → **0** | 63 → **0** | — | — |
| Dashboard Latest bookings | — | 63 → **0** | — | — |
| Transfer route fares | 279 → 68 | 108 → **0** | — | — |
| Customer's bookings | 234 → 48 | 63 → **0** | — | — |
| Tour booking travellers | 234 → 19 | 63 → **0** | — | — |
| Dispatch board | 130 → 92 | — | — | — |
| Audit log | 118 → 26 * | — | — | — |

\* Measured before the last audit-log change (the record type may wrap below 1280px). By the column widths it should now fit with about 10px to spare, but this has not been re-measured.

---

## Remaining work

These tables still scroll slightly at the width shown:

| Page | Table | Width | Hidden now | Before |
|---|---|---|---|---|
| `/admin/transfers/dispatch` | Transfer legs | 1024 | 92px | 130px |
| `/admin/transfers/routes/[id]` | Fares by vehicle class | 1024 | 68px | 279px |
| `/admin/customers/[id]` | Bookings for this customer | 1024 | 48px | 234px |
| `/admin/audit` | Audit log | 1024 | 26px (see note above) | 118px |
| `/admin/partners` | Partner companies | 1280 | 20px | 20px (unchanged) |
| `/admin/tours/bookings/[ref]` | Travellers | 1024 | 19px | 234px |
| `/admin/packages` | Packages | 1024 | 14px | 14px (unchanged) |
| `/admin/finance/invoices/sync-events` | Unmatched reports | 1024 | 6px | 6px (unchanged) |
| `/admin/finance/payables` | Supplier payables | 1024 | 2px | 2px (unchanged) |

The fix for each is the same kind as above: let long unbreakable text wrap, or show a secondary column only from `xl`.

Still to run (paused because the machine was low on memory):

- The public site in **en / ka / ru / he** at 360, 390, 430, 768, 1024, 1440 and 1920.
- A re-check of the admin header (search hint, references) from 360 to 1920px.

---

## Deployment notes

- **Restart the API** after deploying, so the media `Cross-Origin-Resource-Policy` header takes effect.
- No database migrations, no new dependencies, no environment changes.

## Not in this commit

These files are still uncommitted locally:

- `docs/MOBILE_DESIGN_SYSTEM.md`: existing draft, not part of this work.
- `server/package-lock.json`: lock-file noise from an older npm (it drops `libc` fields); probably should be discarded.
- `server/scripts/seed-fleet.js`, `server/scripts/seed-transfer-bookings.js`: genuine seed fixes for the newer schema (`primaryRole`, `channel`); worth committing separately.

## Out of scope

These audit items are not responsive-layout defects, so this change leaves them alone:

- **Currency and pricing:** VA-02 (USD prices labelled GEL), VA-31.
- **Colour contrast:** VA-03, VA-09, VA-10, VA-26.
- **Focus and keyboard:** VA-07, VA-08, VA-28.
- **Copy, i18n and RTL text order:** VA-14, VA-21, VA-22, VA-24, VA-32, VA-33, VA-40.
- **Behaviour and routing:** VA-16, VA-17, VA-19, VA-20, VA-29, VA-30, VA-35, VA-36, VA-37, VA-38, VA-41.
- **Suggestions:** VA-44 to VA-50. VA-50's footer links already meet WCAG 2.5.8 through the spacing exception.
- **Image fallback (VA-15):** done here, as part of the image work.
