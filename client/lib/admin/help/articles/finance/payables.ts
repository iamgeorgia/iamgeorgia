import type { HelpArticle } from "../../types";

/**
 * `/admin/finance/payables` (`finance/payables/page.tsx`, `PayablesBrowser`)
 * and `/admin/finance/payables/[id]` (`PayableActions`). Encodes: one payable
 * per confirmed booking, package parts included; the instalment split by the
 * supplier's terms; the two review flags; paying an instalment with one
 * idempotency key per dialog; the override and handing it back; write-off;
 * refund due after a cancellation. Figures per currency, never added.
 */
export const article = {
  id: "fn-payables",
  title: "Payables: what we owe suppliers",
  summary: "Every supplier payable, its instalments, paying one, and setting an amount by hand.",
  category: "finance",
  routes: ["/admin/finance/payables", "/admin/finance/payables/[id]"],
  keywords: [
    "supplier",
    "pay supplier",
    "net price",
    "instalment",
    "deposit",
    "balance",
    "due date",
    "late",
    "override",
    "write off",
    "waive",
    "refund due",
    "needs review",
  ],
  related: ["fn-terms", "fn-payments", "fn-receivables", "fn-reminders"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Payables"] },
    {
      type: "paragraph",
      text: "A payable is what we owe one supplier for one booking: the supplier's **net price**, the amount they charge us before our margin. There is one payable per booking, and every amount on it is in that booking's currency. The screen never adds amounts in different currencies together, which is why the cards at the top are counts rather than totals.",
    },
    { type: "heading", id: "where-from", text: "Where payables come from" },
    {
      type: "list",
      items: [
        "A payable is created when a booking is confirmed — a hotel stay, a transfer, a tour or a service. A request still waiting for the supplier's answer owes nothing yet, and one the supplier declined never gets a payable.",
        "A package order makes one payable per part, because each part is its own booking with its own supplier and its own reference.",
        "Inventory the platform owns itself has no outside supplier; its payables show **Platform** in the supplier column. **Platform inventory only** narrows the list to those.",
        "Bookings confirmed before the finance module existed were backfilled; their page says so under **Origin**.",
      ],
    },
    { type: "heading", id: "instalments", text: "Instalments and due dates" },
    {
      type: "paragraph",
      text: "The supplier's payment terms split the amount into instalments: an optional **Deposit** and a **Balance**, each due a set number of days before or after confirmation, arrival or departure. The list shows each payable's next due date with how far off it is; a date that has passed while money is still outstanding turns red and counts on the **Late** card.",
    },
    {
      type: "table",
      columns: ["Status", "What it means"],
      rows: [
        ["Open", "Nothing paid yet."],
        ["Part paid", "Some money has gone out; the rest is still owed."],
        ["Paid", "Everything owed has been paid."],
        ["Nothing owed", "The amount came to zero — for example a cancellation the supplier does not charge for."],
        ["Written off", "Finance decided the rest will not be paid. Final."],
      ],
    },
    { type: "heading", id: "review", text: "Needs review" },
    {
      type: "definitions",
      items: [
        {
          term: "No payment terms for this supplier",
          description: "The supplier has no terms on file, so the whole amount went into one balance with no due date. Add their terms on the payment terms screen, or pay it on the date you agree with them.",
        },
        {
          term: "Cancelled — amount to be set by hand",
          description: "The booking was cancelled and the supplier's terms say cancellations are decided by hand. Work out what they are still owed and set the amount by hand — zero if nothing.",
        },
      ],
    },
    {
      type: "paragraph",
      text: "Setting the amount by hand or writing the payable off clears the flag: a person has looked at it. The **Needs review** chip shows only flagged payables.",
    },
    { type: "heading", id: "pay", text: "Paying an instalment" },
    {
      type: "steps",
      items: [
        "Open the payable and choose **Pay the deposit** or **Pay the balance** under **Actions**.",
        "Pick how the money went out, the day it went out, and the amount. The amount starts at what is left on that instalment; a smaller amount records a part payment.",
        "Add the bank reference if there is one, and press **Record payment**.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "Recording a payment does not send money — it writes down a payment already made. If the connection drops, press **Record payment** again in the same dialog: it is recognised as the same payment and is not recorded twice.",
    },
    { type: "heading", id: "by-hand", text: "Setting the amount by hand" },
    {
      type: "paragraph",
      text: "**Set the amount owed by hand** replaces what the supplier's terms say with your own figure, with a reason that goes to the audit log. It can be anything from zero up to the net at confirmation. The figure is kept when the booking changes later; the page shows it under **Set by hand** with your reason. **Hand back to the supplier's terms** removes it, and the amount is worked out from the supplier's rules again.",
    },
    { type: "heading", id: "write-off", text: "Writing off what is left" },
    {
      type: "callout",
      tone: "danger",
      title: "Cannot be undone",
      text: "**Write off what is left** marks everything still outstanding as not to be paid and closes every open instalment. A written-off payable cannot be paid or adjusted again. Payments already made stay on record. A reason is required.",
    },
    { type: "heading", id: "refund-due", text: "Refund due after a cancellation" },
    {
      type: "paragraph",
      text: "When a booking is cancelled after we have paid the supplier, what is owed can drop below what was paid. The difference shows as **Refund due to us** and in the list as an amount to come back. Ask the supplier for it, and record what they return as a refund on the Payments screen.",
    },
    {
      type: "links",
      items: [
        { label: "Supplier payment terms", articleId: "fn-terms" },
        { label: "Recording payments and refunds", articleId: "fn-payments" },
      ],
    },
  ],
} satisfies HelpArticle;
