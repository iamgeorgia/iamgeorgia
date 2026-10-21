import type { HelpArticle } from "../../types";

/**
 * Inventory & pricing at `/admin/hotels/[slug]/calendar`
 * (`CalendarManager.tsx`): room type and window in the URL with a default of
 * today plus 27 days, the deliberately read-only grid, the Inventory range
 * editor (rooms 0–10000, minStay 1–365, "keep" placeholders) and the Prices
 * range editor (Night = supplier net, Extra adult, Sales keep/open/closed),
 * both applied with "Apply to range". Money is entered in major units and
 * stored as integer minor units (`lib/money.ts`).
 */
export const article = {
  id: "ht-inventory-pricing",
  title: "Inventory and nightly prices",
  summary: "The calendar: how many rooms are open on each night, the minimum stay, and the supplier's net price per rate plan — all set by date range.",
  category: "hotels",
  routes: ["/admin/hotels/[slug]/calendar"],
  keywords: ["calendar", "availability", "allotment", "rooms open", "minimum stay", "net price", "nightly rate", "extra adult", "closed", "stop sale", "apply to range", "weekdays"],
  related: ["ht-rooms-rates", "ht-hub", "ht-publish-checklist"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels", "[property]", "Inventory & pricing"] },
    {
      type: "paragraph",
      text: "The calendar shows one room type at a time over a window of dates — today and the next 27 days unless you choose otherwise. The room type and the window are part of the URL, so a bookmark opens the same view. Weekend columns are tinted.",
    },
    {
      type: "callout",
      tone: "info",
      title: "The grid is read-only",
      text: "Cells cannot be typed into. Every change is made with one of the two range editors below the grid and applied to a span of dates at once — by design, so that a month is set in one action rather than thirty.",
    },
    {
      type: "paragraph",
      text: "The screen needs an active room type before it shows anything. Without one it reads **Add a room type first — there is nothing to put on a calendar yet.**",
    },
    { type: "heading", id: "inventory", text: "Setting how many rooms are open" },
    {
      type: "steps",
      items: [
        "Choose the room type and the window at the top.",
        "In the **Inventory** editor set **From** and **To**, and untick any weekdays the change should skip.",
        "Enter the number of **rooms** open per night (0 to 10000) and the **minimum stay** in nights (1 to 365). A field left at `keep` leaves that value as it is on every date.",
        "Press **Apply to range**.",
      ],
    },
    { type: "heading", id: "prices", text: "Setting nightly prices" },
    {
      type: "steps",
      items: [
        "In the **Prices** editor choose the **Rate plan** the prices belong to.",
        "Set the dates and weekdays as above.",
        "Enter **Night** — the nightly cost from the supplier, in the property's currency — and, if the plan charges one, **Extra adult**.",
        "Set **Sales** to `open` or `closed` to open or stop sale on those nights, or leave it at `keep`.",
        "Press **Apply to range**.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "The price you enter is the net, not what the guest pays",
      text: "As the panel says, the selling price is derived by the buyer's markup. Enter the supplier's net; each partner's markup is applied on top of it when they sell.",
    },
    { type: "heading", id: "example", text: "An example" },
    {
      type: "paragraph",
      text: "To open five Deluxe Doubles every Friday and Saturday in July with a two-night minimum: choose the room type, set **From** 1 July and **To** 31 July, tick only Fri and Sat, enter 5 rooms and a minimum stay of 2, and apply. Then in **Prices** choose the `BB` plan, the same dates and weekdays, enter the net nightly cost, and apply again.",
    },
    {
      type: "paragraph",
      text: "Amounts are typed in whole units and decimals — `120.50` — and stored as integer minor units, so a price is never rounded on its way in.",
    },
    {
      type: "links",
      items: [
        { label: "Rooms and rate plans", articleId: "ht-rooms-rates" },
        { label: "Getting a hotel on sale", articleId: "ht-publish-checklist" },
      ],
    },
  ],
} satisfies HelpArticle;
