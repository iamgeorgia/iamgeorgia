import type { HelpArticle } from "../../types";

/**
 * The public channel. Everything is B2B by default (`b2cEnabled` defaults
 * false in `schema.prisma`); the switch lives in `HotelActions.tsx` and
 * `TourActions.tsx` as "Public sale (B2C)", in `PackageActions.tsx` as "Sell
 * to the public", on the service form as "Sell to the public (B2C)", and on
 * the vehicle class list row as "Public / Trade only". None asks for
 * confirmation. "Featured" without ACTIVE shows nowhere — the package panel
 * warns, the tour panel does not.
 */
export const article = {
  id: "pb-b2c-vs-trade",
  title: "Public sale (B2C) vs trade-only",
  summary: "Publishing sells to partners; a second switch sells to the public. Where that switch is on each screen, and why Featured does nothing on its own.",
  category: "publishing",
  roles: ["ADMIN"],
  keywords: ["b2c", "b2b", "public", "trade", "partners", "sell to the public", "featured", "homepage", "public site", "anonymous visitors"],
  related: ["pb-statuses", "ht-hub", "tr-hub", "pk-hub", "sv-editing", "tc-vehicle-classes"],
  blocks: [
    {
      type: "paragraph",
      text: "Everything on the platform is sold to trade partners by default. Publishing a record makes it visible and bookable for partners; whether anonymous visitors on the public site can see and book it is a separate switch, off until someone turns it on. Publishing is not the same as being public.",
    },
    { type: "heading", id: "switches", text: "Where the switch lives" },
    {
      type: "table",
      columns: ["Record", "Where", "Label"],
      rows: [
        ["Hotel", "The **Publishing** panel on the property hub", "**Public sale (B2C)**"],
        ["Tour", "The **Publishing** panel on the tour hub", "**Public sale (B2C)**"],
        ["Package", "The **Publishing** panel on the package hub", "**Sell to the public**"],
        ["Service", "The service form, saved with the rest of it", "**Sell to the public (B2C)**"],
        ["Vehicle class", "The row in the vehicle classes list", "**Public** / **Trade only**"],
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "One click, no confirmation",
      text: "The hub switches flip the moment they are pressed and nothing asks whether you meant it. On a record that is on sale, turning the switch on exposes it to the public immediately.",
    },
    { type: "heading", id: "combinations", text: "How the two combine" },
    {
      type: "table",
      columns: ["Status", "Public switch", "Who sees it"],
      rows: [
        ["`DRAFT` or `INACTIVE`", "Off or on", "Nobody. The switch changes nothing until the record is on sale."],
        ["`ACTIVE`", "Off", "Trade partners only."],
        ["`ACTIVE`", "On", "Partners and anonymous visitors on the public site."],
      ],
    },
    { type: "heading", id: "featured", text: "Featured" },
    {
      type: "paragraph",
      text: "Tours and packages also carry a **Featured** switch — on the homepage rail, as the tour panel puts it. It is a placement, not a channel.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Featured without Published shows nowhere",
      text: "A featured record that is not on sale appears in no rail and no list. The package panel says so — **Featured, but not on sale — nothing will show it until it is published.** — the tour panel stays silent.",
    },
    {
      type: "links",
      items: [
        { label: "Draft, on sale, off sale, archived (and suspended)", articleId: "pb-statuses" },
        { label: "Vehicle classes", articleId: "tc-vehicle-classes" },
      ],
    },
  ],
} satisfies HelpArticle;
