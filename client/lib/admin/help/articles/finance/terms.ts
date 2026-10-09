import type { HelpArticle } from "../../types";

/**
 * The payment terms screen at `/admin/finance/terms/[kind]/[id]`
 * (`SupplierTermsForm.tsx`) and the Payment terms panel on a partner
 * (`PartnerTermsPanel.tsx`). Supplier terms are an optional deposit plus one
 * balance, each an anchor and a signed day offset; the balance is the
 * remainder (`buildInstalments` in `server/services/finance/ledger.service.js`).
 * The cancellation choice is owner decision D6; partner days-to-pay is D5.
 * Terms apply to bookings confirmed after they are saved.
 */
export const article = {
  id: "fn-terms",
  title: "Payment terms",
  summary: "When each supplier is paid, what it is owed after a cancellation, and how long partners have to pay.",
  category: "finance",
  roles: ["ADMIN"],
  routes: ["/admin/finance/terms/[kind]/[id]"],
  keywords: [
    "finance",
    "payment terms",
    "deposit",
    "balance",
    "schedule",
    "due date",
    "cut-off",
    "cancellation",
    "net",
    "supplier",
    "days to pay",
    "credit terms",
    "contract",
  ],
  related: ["fn-payables", "fn-receivables"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels", "[property]", "Payment terms"] },
    {
      type: "paragraph",
      text: "Every supplier — a hotel, a tour, a service, or a transfer provider — has its own payment terms: when we pay it for a booking, and what it is still owed if the booking is cancelled. Open them from the **Payment terms** tile on a hotel or a tour, the **Payment terms** panel on a service, or the **Payment terms** panel on a vehicle class for the provider that operates it.",
    },
    {
      type: "callout",
      tone: "info",
      title: "New terms apply to new bookings only",
      text: "Saving terms changes the schedule of bookings confirmed **after** you save. Bookings already confirmed keep the schedule they were given; to change one of those, adjust its payable on the Payables screen.",
    },
    { type: "heading", id: "schedule", text: "The schedule: deposit and balance" },
    {
      type: "paragraph",
      text: "A schedule is an optional **deposit** followed by one **balance**. The deposit is either a percentage of the booking's net or a fixed amount (never more than the net). The balance is always whatever is left, so the two add up to the net exactly.",
    },
    {
      type: "definitions",
      items: [
        { term: "Anchor", description: "The date a payment is counted from: **confirmation**, **arrival** or **departure**." },
        { term: "Offset", description: "How many days before or after the anchor it falls due — \"3 days after confirmation\", \"7 days before arrival\". Nothing can be due before confirmation." },
        { term: "Cut-off time", description: "The time of day on the due date when a payment falls due, in the supplier's time zone. Left empty, it is 10:00." },
        { term: "No schedule", description: "Untick **Pay this supplier on a schedule** and each booking's net becomes one balance with no due date, flagged for Finance to review on Payables." },
      ],
    },
    {
      type: "paragraph",
      text: "Below the fields, a sentence previews what a booking of 1,000 confirmed today with arrival in 30 days would get, so you can check the dates before you save.",
    },
    { type: "heading", id: "cancellation", text: "After a cancellation" },
    {
      type: "paragraph",
      text: "Suppliers differ in what they keep when a booking is cancelled, so each one is set to one of three rules:",
    },
    {
      type: "table",
      columns: ["Choice", "What the supplier is owed"],
      rows: [
        ["Same share of the net", "The same share of its net as the buyer was charged. If the buyer pays 50% on cancellation, the supplier is owed 50% of the net."],
        ["Nothing unless non-refundable", "Nothing — unless the buyer was charged the booking in full, in which case the whole net."],
        ["Decide by hand", "Every cancelled booking is flagged on Payables for Finance to set the amount."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "An example",
      text: "A hotel's net is 1,000 and we sold the room to an agency for 1,150. The agency cancels and is charged 50%: it owes us **575**. Under **Same share of the net**, we owe the hotel 50% of its net: **500**.",
    },
    {
      type: "paragraph",
      text: "Use **Notes** for anything the schedule cannot say — the contract reference, a bank cut-off, who agreed the terms.",
    },
    { type: "heading", id: "partner-terms", text: "Partner terms: days to pay" },
    {
      type: "paragraph",
      text: "How long a partner has to pay us is set on the partner itself, in the **Payment terms** panel of its page: a number of days counted from **confirmation** or from **arrival**. Each booking that partner makes is due that many days after its confirmation or arrival. Finance can still move one booking's due date on its receivable without changing the partner's terms.",
    },
    { type: "where", path: ["Sidebar", "Network", "Partners", "[partner]", "Payment terms"] },
    {
      type: "paragraph",
      text: "Anyone who can see payables or edit the catalogue can read supplier terms, and anyone who can see receivables or edit partners can read partner terms. Changing either needs permission to edit payment terms.",
    },
    {
      type: "links",
      items: [
        { label: "Payables: what we owe suppliers", articleId: "fn-payables" },
        { label: "Receivables", articleId: "fn-receivables" },
      ],
    },
  ],
} satisfies HelpArticle;
