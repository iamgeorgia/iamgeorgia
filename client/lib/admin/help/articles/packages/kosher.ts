import type { HelpArticle } from "../../types";

/**
 * `/admin/packages/[slug]/kosher` (`PackageKosherEditor.tsx`). The profile's
 * existence is the switch and remove is a real action; the hotel standard,
 * certification and Shabbat fieldsets with their defaults; the dated
 * Override; saving re-validates every fixed hotel slot and is refused with
 * `KOSHER_INELIGIBLE` rather than written.
 */
export const article = {
  id: "pk-kosher",
  title: "Package kosher rules",
  summary: "The rules a kosher package is sold under — hotel standard, certification, Shabbat — and the dated override for a hotel that has lost eligibility.",
  category: "packages",
  routes: ["/admin/packages/[slug]/kosher"],
  keywords: ["kosher", "shabbat", "candle lighting", "havdalah", "certification", "certificate", "supervision", "mashgiach", "board", "override", "ineligible", "passover"],
  related: ["pk-hub", "pk-parts", "ht-kosher", "sv-editing"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Packages", "[package]", "Kosher"] },
    {
      type: "paragraph",
      text: "A kosher package is an ordinary package with a kosher profile attached. The profile says what the hotels in it must satisfy and what the package will not do on Shabbat; the hub's **Kosher eligibility** panel checks the fixed hotels against it on every load.",
    },
    { type: "heading", id: "switch", text: "The switch is the profile" },
    {
      type: "paragraph",
      text: "There is no kosher checkbox. Creating the profile makes the package kosher; removing it makes the package ordinary again. Remove is a real action that discards every rule below, not a toggle you can flip back.",
    },
    { type: "heading", id: "rules", text: "Hotel standard and certification" },
    {
      type: "table",
      columns: ["Field", "What it sets"],
      rows: [
        ["Minimum hotel standard", "The lowest level of kosher service a hotel in the package may have."],
        ["Supervision", "The supervision the package promises."],
        ["Hotel request codes", "Codes passed to the hotel with the booking."],
        ["Certified kitchen required", "Whether a hotel needs a verified certificate at all."],
        ["Certificate valid through the stay", "Whether a certificate that expires mid-stay disqualifies the hotel."],
        ["Scopes", "Which certificate scopes count: `PROPERTY`, `KITCHEN`, `RESTAURANT`, `PASSOVER`."],
        ["Required board codes", "The boards the hotel stay must be sold on."],
      ],
    },
    { type: "heading", id: "shabbat", text: "Shabbat" },
    {
      type: "list",
      items: [
        "**Mode**: **From local sunset**, **Fixed hours** or **No Shabbat rules**.",
        "From local sunset: **Candle lighting** minutes before sunset, 0 to 120, default 18; **Havdalah** minutes after, 0 to 120, default 42.",
        "Fixed hours: a **Starts** and an **Ends** time.",
        "**No transfers during Shabbat** and **No tours on Shabbat or a festival** keep those slots off the affected days.",
        "**Notes** for anything the rules above cannot say.",
      ],
    },
    { type: "heading", id: "override", text: "Override" },
    {
      type: "paragraph",
      text: "The **Override** fieldset takes an **Until** date and a **Reason**. It is, in the schema's own words, an admin's dated decision to sell a kosher package whose hotel has lost eligibility. Audited; never a silent bypass. Use it when a certificate has lapsed on paper but the kitchen has not changed and renewal is under way; it expires on the date you give.",
    },
    {
      type: "callout",
      tone: "info",
      title: "A save is checked against the hotels first",
      text: "Saving re-validates every fixed hotel slot against the rules on screen. If one fails, the save is refused with `KOSHER_INELIGIBLE` and nothing is written — loosen the rule, change the hotel on **Parts**, or set an override, then save again.",
    },
  ],
} satisfies HelpArticle;
