import type { HelpArticle } from "../../types";

/**
 * `/admin/finance/receivables` (`ReceivablesBrowser`) and its detail page
 * (`ReceivableActions`, `RecordPaymentModal`), reading
 * `GET /api/admin/finance/receivables`. Encodes: when the server creates a
 * receivable (`syncBookingReceivableInTx` at confirmation, the order's own when
 * every request is answered); the due date from the partner's
 * `paymentDueDays`/`paymentDueAnchor` (guests: `FINANCE_GUEST_DUE_DAYS`, 0) at
 * 23:59 local; moving one due date (`PATCH … { dueAt, reason }`, owner
 * decision D5); cancellation lowering the amount to the charge, with what was
 * paid beyond it shown as a refund due; write-off (`waive`).
 */
export const article = {
  id: "fn-receivables",
  title: "Receivables: what buyers owe us",
  summary: "What each agency and guest owes, moving a due date, refunds and write-offs.",
  category: "finance",
  roles: ["ADMIN"],
  routes: ["/admin/finance/receivables", "/admin/finance/receivables/[id]"],
  keywords: [
    "receivable",
    "receivables",
    "owed to us",
    "debtor",
    "agency owes",
    "unpaid booking",
    "overdue",
    "due date",
    "more time to pay",
    "extend payment",
    "refund due",
    "write off",
    "waive",
    "collect payment",
  ],
  related: ["fn-payments", "fn-terms", "fn-payables", "fn-overview"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Receivables"] },
    {
      type: "paragraph",
      text: "A receivable is money a buyer owes us for one booking or one order: an agency booking for its clients, or a guest who booked for themselves without an account. Each row says who owes, how much, how much has been paid, and by when.",
    },
    { type: "heading", id: "when-created", text: "When a receivable appears" },
    {
      type: "list",
      items: [
        "**A booking on its own** — a hotel stay, a transfer, a tour or a service booked by itself — gets its receivable the moment it is confirmed. Its reference is the booking's reference.",
        "**An order** gets one receivable for the whole order, once every request in it has been answered. The bookings inside an order have no receivable of their own: the order is what the buyer pays.",
        "Nothing is owed for a booking that is still pending, and a booking cancelled before it was ever confirmed leaves no receivable at all.",
      ],
    },
    { type: "heading", id: "due-dates", text: "Due dates" },
    {
      type: "paragraph",
      text: "Each agency has its own payment days — so many days after confirmation, or after arrival — set on that partner's page. A receivable's due date is worked out from those days when it is created, and falls at the end of that day. A guest without an account pays at once: the due date is the day of confirmation.",
    },
    {
      type: "paragraph",
      text: "To give a buyer more time on one booking, open the receivable and choose **Change due date**. Pick the new day and say why; the reason is kept in the audit log. Only this one item moves — the partner's usual payment days stay as they are. To change those for every future booking, edit the partner's payment terms instead.",
    },
    { type: "heading", id: "overdue", text: "Overdue" },
    {
      type: "paragraph",
      text: "A receivable is overdue when it is still open or part paid and its due date has passed. Overdue rows show their due date in red with how many days late they are, and the status pill says “overdue” in words. **Overdue only** narrows the list to them.",
    },
    { type: "heading", id: "filters", text: "Finding a receivable" },
    {
      type: "definitions",
      items: [
        { term: "Search", description: "Matches the reference, the buyer's name and the buyer's email." },
        { term: "Status", description: "Open, Part paid, Paid, Written off and Nothing owed. Choose several to see them together; **All** clears the choice." },
        { term: "Overdue only", description: "Open or part-paid items past their due date." },
        { term: "Guests only", description: "Buyers who booked without a partner account." },
        { term: "Currency", description: "One currency at a time. Amounts in different currencies are never added together." },
      ],
    },
    { type: "heading", id: "taking-payment", text: "Taking a payment" },
    {
      type: "steps",
      items: [
        "Open the receivable and choose **Record a payment**. The amount is filled in with what is outstanding, and the currency is fixed to the receivable's.",
        "Change the amount if less was paid. If more was paid, the extra stays on the payment as unallocated money, to be matched to another item later.",
        "Choose the method and the day it was paid, add the bank or receipt reference, and save.",
      ],
    },
    {
      type: "paragraph",
      text: "Money that covers several of an agency's bookings at once is easier to record from **Payments**, settling that partner's oldest open items first.",
    },
    { type: "heading", id: "refunds", text: "Refunds after a cancellation" },
    {
      type: "paragraph",
      text: "When a booking is cancelled, its receivable drops to the cancellation charge — or to nothing, which shows as **Nothing owed**. If the buyer had already paid more than that, the difference shows as **To refund**, and a **Refund** button appears. It records money out to the buyer against this receivable, filled in with the amount due back, and asks for a reason.",
    },
    { type: "heading", id: "write-off", text: "Writing off" },
    {
      type: "paragraph",
      text: "**Write off** stops what is left from being owed — a goodwill gesture, or a debt that will not be collected. It needs a reason. Payments already received stay recorded; only the outstanding amount is cleared, and the item shows as **Written off**.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "A write-off is final",
      text: "There is no button to undo it. A written-off item no longer takes payments: if money arrives for it later anyway, record it on **Payments**, leave it unallocated, and say in the note which item it was for.",
    },
    {
      type: "links",
      items: [
        { label: "Recording payments and refunds", articleId: "fn-payments" },
        { label: "Payment terms", articleId: "fn-terms" },
      ],
    },
  ],
} satisfies HelpArticle;
