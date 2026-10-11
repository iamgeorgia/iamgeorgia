import type { HelpArticle } from "../../types";

/**
 * The partner credit panel on `/admin/partners/[id]` (`PartnerCreditPanel`),
 * `/admin/finance/penalties` (`PenaltiesBrowser`) and the Commission tab on
 * `/admin/finance/reports`. Encodes: what a credit limit does and the two
 * modes, that a penalty change is always an approval request, and how the
 * commission report reads.
 */
export const article = {
  id: "fn-credit-penalties",
  title: "Credit limits, cancellation penalties and commission",
  summary: "Cap what a partner can owe, change a cancellation charge with a second person's approval, and read the commission report.",
  category: "finance",
  roles: ["ADMIN"],
  routes: ["/admin/finance/penalties"],
  keywords: [
    "credit limit",
    "credit",
    "block",
    "warn",
    "penalty",
    "penalties",
    "cancellation charge",
    "override",
    "commission",
    "rate",
  ],
  related: ["fn-approvals", "fn-receivables", "fn-reports"],
  blocks: [
    { type: "heading", id: "credit-limit", text: "Credit limit" },
    { type: "where", path: ["Sidebar", "Network", "Partners", "[partner]"] },
    {
      type: "paragraph",
      text: "A credit limit is the most a partner may owe us at one time, in one currency. **Owed now** is everything the partner has been billed and not yet paid; **Still available** is the limit minus that. A partner with no limit can book without a ceiling.",
    },
    {
      type: "definitions",
      items: [
        { term: "Block", description: "A booking that would take the partner past its limit is refused. The partner is told to settle open invoices or contact us." },
        { term: "Warn", description: "The booking goes through and finance is told that the partner is over its limit." },
        { term: "No limit", description: "Clears the limit. The partner can book whatever it owes." },
      ],
    },
    {
      type: "paragraph",
      text: "To change the limit you need the credit permission. Enter the amount in whole and decimal units of the currency you pick (for example 5000.00), choose Block or Warn, and press **Save credit limit**. Partners see their own limit, what they have used and what is left on their Finance page.",
    },
    { type: "heading", id: "penalties", text: "Cancellation penalties" },
    { type: "where", path: ["Sidebar", "Finance", "Penalties"] },
    {
      type: "paragraph",
      text: "When a booking is cancelled, its policy decides what the buyer is charged. This list shows each charge, the figure the policy set, any figure finance agreed instead, and the reason given. Filter by partner, product, currency, or only the charges that were changed.",
    },
    {
      type: "steps",
      items: [
        "Find the booking and press **Ask to change**.",
        "Enter the new charge, which can be lower than the policy's figure but not higher, or choose to go back to the policy's figure.",
        "Write the **Reason** and press **Request approval**.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "A charge is never edited directly",
      text: "Every change is an approval request, even for people who can decide other requests. The charge stays as it is until someone other than you approves it. Follow the request from the link on the row or from the Approvals screen.",
    },
    { type: "heading", id: "commission", text: "The commission report" },
    { type: "where", path: ["Sidebar", "Finance", "Reports", "Commission"] },
    {
      type: "paragraph",
      text: "The Commission tab shows, for the bookings confirmed in the period you pick, how much was **sold**, the **net** left after commission, the **commission** itself, and what that came to as a percentage. Group it by partner or by product. The agreed rate shows a range when it changed between bookings. As on the other reports, each currency has its own table.",
    },
  ],
} satisfies HelpArticle;
