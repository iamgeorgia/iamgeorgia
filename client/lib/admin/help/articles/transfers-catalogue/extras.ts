import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/extras` (`transfers/extras/page.tsx`,
 * `TransferExtrasEditor.tsx`). Encodes: one screen with a form per row saved
 * independently; the Code fixed after creation; the four charging bases with
 * the Amount label flipping to "Share of the fare (%)"; a percentage typed
 * as a percentage; the duplicate-code guard living in the form only because
 * the endpoint upserts; Retire / Offer it again with no confirmation.
 */
export const article = {
  id: "tc-extras",
  title: "Transfer extras",
  summary: "Child seats, waiting time, meet-and-greet and other add-ons — how each is charged, which classes offer it, and how it is retired.",
  category: "transfers-catalogue",
  routes: ["/admin/transfers/extras"],
  keywords: ["extras", "add-on", "child seat", "per passenger", "per hour", "per booking", "share of the fare", "percent", "code", "retire", "offer it again"],
  related: ["tc-pricing-model", "tc-vehicle-classes", "bk-transfer-booking-detail"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Extras"] },
    {
      type: "paragraph",
      text: "An extra is something added to a transfer booking for a charge. Extras live on one screen: three cards (**On offer**, **Priced off the fare**, **Retired**) and a table with a row per extra. Pressing **Edit** on a row expands it into its own form, and each form saves independently of the others. There are no detail pages.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "table",
      columns: ["Field", "What to enter"],
      rows: [
        ["Name", "What the traveller sees."],
        ["Code", "The key bookings record. Pick it carefully — it cannot be changed later. Read-only on an existing extra."],
        ["Description", "One sentence under the name."],
        ["Charged", "**Per booking**, **Per passenger**, **Per hour** or **Share of the fare**."],
        ["Amount", "The charge in lari. When Charged is Share of the fare, the label reads **Share of the fare (%)** and you type a percentage."],
        ["Position", "Lower first; sets the order extras are offered in."],
        ["Applies to vehicle classes", "Tick the classes that offer it. None ticked means every class."],
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "A percentage extra is typed as a percentage: `60` for sixty per cent, not `0.60`. Typing it as a fraction produces an extra worth six-tenths of one per cent.",
    },
    { type: "heading", id: "adding", text: "Adding an extra" },
    {
      type: "steps",
      items: [
        "Open the new-extra form at the bottom of the table.",
        "Type the **Name** and a **Code** nobody has used, such as `CHILD_SEAT`.",
        "Choose how it is **Charged** and type the **Amount**.",
        "Tick the classes it applies to, or leave all unticked for every class.",
        "Save the row.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "Creating an extra with a code that already exists overwrites that extra. The form refuses a duplicate code, but the API behind it does not, so the guard is only as good as the list you can see.",
    },
    {
      type: "paragraph",
      text: "Example: **Child seat**, code `CHILD_SEAT`, Charged Per booking, Amount 15, Applies to Economy and Comfort only. A traveller booking a Minivan is never offered it.",
    },
    { type: "heading", id: "retire", text: "Retiring an extra" },
    {
      type: "paragraph",
      text: "At the bottom right of each row's form, **Retire** takes the extra off offer without deleting it — bookings that already carry it keep it — and the row reads **· retired**. The same button then reads **Offer it again** and puts it back.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Retire** and **Offer it again** act on one click with no confirmation.",
    },
    {
      type: "links",
      items: [
        { label: "How a transfer fare is computed", articleId: "tc-pricing-model" },
        { label: "Vehicle classes", articleId: "tc-vehicle-classes" },
      ],
    },
  ],
} satisfies HelpArticle;
