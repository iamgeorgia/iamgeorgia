import type { HelpArticle } from "../../types";

/**
 * `/admin/tours/[slug]/options` (`TourOptionsManager.tsx`). Every option
 * field with its range and default; seasons as price sheets over a window;
 * tiers per season with net prices and an optional fixed sell that overrides
 * the buyer's markup; Archive option and Delete price sheet behind a browser
 * confirm. Confirmation mode is per option, and ON_REQUEST writes the booking
 * PENDING.
 */
export const article = {
  id: "tr-options-prices",
  title: "Options, seasons and price tiers",
  summary: "How a tour is sold: the options it offers, the seasons each option is priced in, and the per-party tiers that set the net and the sell.",
  category: "tours",
  roles: ["ADMIN"],
  routes: ["/admin/tours/[slug]/options"],
  keywords: ["option", "price", "pricing", "season", "price sheet", "tier", "net", "sell", "markup", "on request", "instant", "private", "shared", "per group", "per person", "cancellation", "notice", "horizon", "archive option"],
  related: ["tr-departures", "tr-hub", "tr-publish-checklist", "pb-b2c-vs-trade", "tc-pricing-model"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Tours", "[tour]", "Options & prices"] },
    {
      type: "paragraph",
      text: "A tour is sold through options — a shared departure and a private one, say — and each option is priced by season and by party size. As the screen puts it: selling prices are derived from the buyer's markup unless a tier fixes one.",
    },
    { type: "heading", id: "options", text: "Options" },
    {
      type: "table",
      columns: ["Field", "What it wants"],
      rows: [
        ["Name, Code", "How the option is named in the panel and on the public page."],
        ["Kind", "**Shared** or **Private**."],
        ["Priced", "**Per person** or **Per group**. Decides what a tier's price is the price of."],
        ["Runs", "**Scheduled departures** or **On demand**."],
        ["Confirmation", "**Instant** or **On request**."],
        ["Visibility", "Public, or partner-only."],
        ["Smallest party, Largest party", "1 to 500 each."],
        ["Start time", "A wall-clock time."],
        ["Languages", "The languages the tour is guided in."],
        ["Cancellation terms", "One of the platform's templates."],
        ["Notice (hours)", "0 to 1440, default 24. How close to departure a booking is still accepted."],
        ["Horizon (days)", "1 to 730, default 365. How far ahead a booking may be made."],
        ["Operates on", "Weekday checkboxes."],
        ["On sale", "A checkbox. **Off sale keeps the option and its bookings but sells nothing.**"],
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "Instant or on request is a property of the option, not of any one departure. An on-request option writes every booking as `PENDING`, and somebody has to answer it.",
    },
    { type: "heading", id: "seasons", text: "Seasons" },
    {
      type: "paragraph",
      text: "A season is a price sheet over a window of dates. Each has a **Name**, **From** and **Until** dates, a **Priority** from 0 to 1000, **Days** checkboxes for the weekdays it applies to, and an **Active** switch. When two seasons cover the same date, the higher priority wins.",
    },
    { type: "heading", id: "tiers", text: "Price tiers" },
    {
      type: "paragraph",
      text: "Inside a season, each tier covers a band of party sizes: a **minPax** from 1 to 500 and a **maxPax** that, left blank, means no ceiling. A tier carries an adult, a child and an infant **net** price — what the supplier is paid — and an optional **sell** price whose placeholder reads `markup`.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "A fixed sell overrides the buyer's markup",
      text: "Leave the sell blank and every buyer pays the net plus their own markup. Fill it in and every buyer pays that figure, whatever their markup says. Fill it in only when the price is meant to be the same for everyone.",
    },
    {
      type: "paragraph",
      text: "For example, a shared option priced per person with one season from May to October and two tiers — 1 to 3 travellers at one net, 4 and above at a lower one — quotes each party from the tier its size falls into.",
    },
    { type: "heading", id: "archiving", text: "Archiving an option, deleting a price sheet" },
    {
      type: "callout",
      tone: "warning",
      title: "One browser prompt each",
      text: "**Archive** on an option asks **Archive … ? Its bookings stay readable.** and then takes it off the tour for good; its bookings can still be opened. Deleting a season asks **Delete the “…” price sheet?** and removes the sheet and every tier in it.",
    },
    {
      type: "links",
      items: [
        { label: "Departures and capacity", articleId: "tr-departures" },
        { label: "Public sale and trade sale", articleId: "pb-b2c-vs-trade" },
      ],
    },
  ],
} satisfies HelpArticle;
