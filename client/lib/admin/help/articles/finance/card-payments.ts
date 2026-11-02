import type { HelpArticle } from "../../types";

/**
 * `/admin/finance/card-payments` (`CardPaymentsBrowser`) and its detail page
 * (`CardPaymentActions`), reading `/api/admin/payments` and writing
 * `/check-status` and `/refunds`. Encodes: the ten `PspPaymentStatus` values
 * and which are terminal; `MISMATCH` (the gateway approved a different amount
 * or currency, so nothing reaches the ledger); refunds as an approval first
 * and a gateway call after; the TEST-mode banner (`PspModeBanner`); and the
 * `cardPaymentsAttention` badge (mismatches, rejected callbacks in the last
 * 24 hours, failed refunds).
 */
export const article = {
  id: "fn-card-payments",
  title: "Card payments",
  summary: "Guests paying by card: the statuses, what a mismatch means, refunds, and the test-mode bar.",
  category: "finance",
  routes: ["/admin/finance/card-payments", "/admin/finance/card-payments/[id]"],
  keywords: [
    "card",
    "card payment",
    "flitt",
    "gateway",
    "mismatch",
    "refund",
    "check status",
    "callback",
    "test mode",
    "declined",
    "visa",
    "mastercard",
    "reconcile",
  ],
  related: ["fn-payments", "fn-receivables", "fn-approvals"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Card payments"] },
    {
      type: "paragraph",
      text: "Every time a guest chooses to pay by card, an attempt is recorded here. The list shows the booking it belongs to, the amount, the card's brand and last four digits, and where the attempt stands. Open one to see what the gateway reported, every callback it sent, and any refunds.",
    },
    { type: "heading", id: "statuses", text: "Statuses" },
    {
      type: "table",
      columns: ["Status", "Meaning"],
      rows: [
        ["Created", "The attempt exists; the guest has not been sent to the payment page yet."],
        ["Awaiting guest", "The guest is on the gateway's page, or is about to be."],
        ["Processing", "The gateway is working on it; the answer is usually seconds away."],
        ["Approved", "The card was charged. The payment is in the ledger and has settled the receivable."],
        ["Declined", "The bank said no. The guest may try again, which opens a new attempt."],
        ["Expired", "The guest did not finish in time."],
        ["Cancelled", "The guest backed out, or the booking was cancelled first."],
        ["Failed", "Something broke before the gateway could decide; the failure reason is shown."],
        ["Mismatch", "The gateway approved a different amount or currency than we asked for. See below."],
        ["Reversed", "The whole charge has been refunded."],
      ],
    },
    {
      type: "paragraph",
      text: "Only Approved changes money in the ledger. Every other status leaves the receivable open.",
    },
    { type: "heading", id: "mismatch", text: "What a mismatch means" },
    {
      type: "callout",
      tone: "warning",
      title: "Nothing was recorded",
      text: "The gateway approved a different amount or currency than we asked for. We do not guess: nothing was written to the ledger and the receivable is still open. Compare with the gateway's own report, then either record the payment by hand against the receivable, or refund it from this page.",
    },
    { type: "heading", id: "check-status", text: "Check status now" },
    {
      type: "paragraph",
      text: "Callbacks normally keep every attempt up to date. If one looks stuck — Processing for minutes, or a guest says they paid and we show nothing — choose **Check status now**. The panel asks the gateway directly and applies the answer the same way a callback would. It is safe to press more than once. If the gateway does not answer in time, the page says so and keeps what we last knew.",
    },
    { type: "heading", id: "refunds", text: "Refunds" },
    {
      type: "steps",
      items: [
        "Open an Approved payment with an amount still refundable and choose **Request refund**.",
        "Enter the amount (never more than what is left to refund) and a reason. Send it.",
        "The request becomes an approval under Finance → Approvals. Someone other than you must approve it.",
        "On approval the refund is sent to the gateway and the card is credited. The Refunds table shows each step: requested, sent, refunded, declined or failed.",
      ],
    },
    {
      type: "paragraph",
      text: "A failed refund is retried automatically and counts toward the badge on the sidebar item until it succeeds or someone resolves it. Partial refunds are allowed; once the whole amount is refunded the payment shows Reversed.",
    },
    { type: "heading", id: "callbacks", text: "Callbacks" },
    {
      type: "paragraph",
      text: "The gateway tells us what happened by calling us. Each call is kept with its time, whether its signature checked out, the status it carried and where it came from. A call with an invalid signature is never acted on; if you see several, tell whoever looks after the integration. Expand **Payload** to read the raw message.",
    },
    { type: "heading", id: "test-mode", text: "The test-mode bar" },
    {
      type: "paragraph",
      text: "While card payments run against the gateway's test merchant, an amber bar across the top of every screen says so. Test cards are charged nothing, and test rows are marked **Test** in the list. The bar disappears in live mode. If you see it on a site that should be live, stop and tell an administrator.",
    },
    { type: "heading", id: "attention", text: "What needs attention" },
    {
      type: "definitions",
      items: [
        { term: "Mismatch", description: "A payment whose amount or currency differs from what was asked." },
        { term: "Rejected callbacks", description: "Messages in the last 24 hours that failed their signature check." },
        { term: "Failed refunds", description: "Refunds the gateway did not accept after retrying." },
      ],
    },
    {
      type: "paragraph",
      text: "The number beside Card payments in the sidebar counts these. Use **Needs attention only** in the filters to list them.",
    },
    {
      type: "links",
      items: [
        { label: "Recording payments and refunds", articleId: "fn-payments" },
        { label: "Receivables", articleId: "fn-receivables" },
      ],
    },
  ],
} satisfies HelpArticle;
