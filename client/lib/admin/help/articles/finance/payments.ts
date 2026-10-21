import type { HelpArticle } from "../../types";

/**
 * `/admin/finance/payments` (`PaymentsBrowser`, `RecordPaymentModal`) and its
 * detail page (`PaymentAllocator`), reading and writing
 * `/api/admin/finance/payments`. Encodes: the four direction × kind pairings
 * and what each settles (`planAllocations`); `allocate: OLDEST_DUE` (earliest
 * due first, undated last, one currency); unallocated money and
 * `POST /payments/:id/allocations`; the Idempotency-Key per opened dialog;
 * the server refusing to cross currencies (`CURRENCY_MISMATCH`).
 */
export const article = {
  id: "fn-payments",
  title: "Recording payments and refunds",
  summary: "Money in and out, what it settled, and spreading what was left unallocated.",
  category: "finance",
  routes: ["/admin/finance/payments", "/admin/finance/payments/[id]"],
  keywords: [
    "payment",
    "record payment",
    "money in",
    "money out",
    "bank transfer",
    "cash",
    "refund",
    "allocate",
    "allocation",
    "unallocated",
    "oldest first",
    "credit",
    "double payment",
    "paid twice",
  ],
  related: ["fn-receivables", "fn-payables", "fn-reports", "fn-overview"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Payments"] },
    {
      type: "paragraph",
      text: "Every movement of money is recorded here once: what came in from buyers, what went out to suppliers, and refunds both ways. Each payment also says what it settled — which receivables or which supplier instalments the money went to.",
    },
    { type: "heading", id: "four-kinds", text: "The four kinds of movement" },
    {
      type: "table",
      columns: ["Shown as", "Which way", "What it settles"],
      rows: [
        ["Received", "Money in from a buyer — an agency or a guest", "Receivables: what that buyer owes"],
        ["Paid to a supplier", "Money out to a hotel, driver, guide or other supplier", "Supplier instalments: what we owe them"],
        ["Refund to a buyer", "Money out, handed back to a buyer", "Receivables the buyer had paid — usually after a cancellation"],
        ["Refund from a supplier", "Money in, handed back by a supplier", "Supplier instalments we had paid"],
      ],
    },
    {
      type: "paragraph",
      text: "A refund always needs a reason, which is kept on the payment and in the audit log.",
    },
    { type: "heading", id: "recording", text: "Recording a payment" },
    {
      type: "steps",
      items: [
        "Choose **Record a payment** at the top of this screen.",
        "Say which way the money went — **Money in** or **Money out** — and tick **This is a refund** if it is one.",
        "Enter the amount, currency, method and the day it was paid. Add the bank or receipt reference: it is what someone searching for this payment later will type.",
        "Choose the partner it came from or went to. For a guest without an account, type their name and email instead.",
        "Under **What it settles**, choose the partner's oldest open items first, or leave it unallocated. Save.",
      ],
    },
    {
      type: "paragraph",
      text: "A payment for one particular item is quicker from that item: **Record a payment** and **Refund** on a receivable, or the instalment's pay button on a payable, fill everything in for you.",
    },
    { type: "heading", id: "oldest-first", text: "Oldest first" },
    {
      type: "paragraph",
      text: "With **oldest open items first**, the money goes to the partner's item with the earliest due date, then the next, until it runs out; items with no due date come last. Only items in the payment's own currency are touched. Whatever is left over once every open item is paid stays on the payment, unallocated. Refunds are not spread this way — a refund belongs to an item that was paid, so it is recorded from that item, or left unallocated and matched later.",
    },
    { type: "heading", id: "allocations", text: "Allocations" },
    {
      type: "paragraph",
      text: "The part of a payment that went to one item is an allocation. A payment's page lists them under **What it settled**, each linking to its receivable or payable; a receivable's page lists the same allocations under **Payments against it**. Refunds show there as negative amounts.",
    },
    { type: "heading", id: "unallocated", text: "Unallocated money" },
    {
      type: "paragraph",
      text: "Money that arrived before anyone knew what it was for, or more than the item it was recorded against, stays on the payment as unallocated. The list shows it under the amount as “unallocated”. To match it later, open the payment and use **Allocate the rest**: the buyer's open items in the same currency are listed, earliest due first. Type an amount against each, or choose **Fill oldest first**, then **Allocate**.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Supplier-side money",
      text: "Money paid to a supplier, or refunded by one, settles supplier instalments. Its **Allocate the rest** panel points to Payables, where the instalments are.",
    },
    { type: "heading", id: "never-twice", text: "A retry never pays twice" },
    {
      type: "paragraph",
      text: "Each opened **Record a payment** dialog carries its own key. If the connection drops and you press save again, or double-click, the server recognises the key and answers with the payment it already recorded — the dialog then says so. Closing the dialog and opening it again starts a new payment, so do that only when you mean to record another one.",
    },
    { type: "heading", id: "currencies", text: "One currency per payment" },
    {
      type: "paragraph",
      text: "A payment is in one currency and settles items in that currency only; the server refuses anything else. Amounts in different currencies are never added together on any finance screen.",
    },
    { type: "heading", id: "filters", text: "Finding a payment" },
    {
      type: "definitions",
      items: [
        { term: "Search", description: "Matches the payment's reference, the counterparty's name and the partner's name." },
        { term: "Direction and kind", description: "Money in or out; payments or refunds. Together they pick one of the four kinds above." },
        { term: "Method and currency", description: "Bank transfer, cash, card or other; one currency at a time." },
        { term: "Paid from / to", description: "Whole days, Tbilisi time, both ends included." },
      ],
    },
    {
      type: "links",
      items: [
        { label: "Receivables", articleId: "fn-receivables" },
        { label: "Payables", articleId: "fn-payables" },
      ],
    },
  ],
} satisfies HelpArticle;
