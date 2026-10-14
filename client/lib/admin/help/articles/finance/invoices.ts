import type { HelpArticle } from "../../types";

/**
 * `/admin/finance/invoices` (`InvoicesBrowser`), its detail page
 * (`InvoiceActions`), the unmatched sync-events page, the Invoices panel on a
 * receivable (`IssueInvoiceButton`) and the partner's own list under
 * `/portal/finance`. Reads `GET /api/admin/invoices`. Encodes: the owner's
 * trigger decision (proforma at confirmation, VAT invoice on full payment,
 * correction when a VAT-invoiced booking is cancelled); that documents are
 * created at InvoiceOcean by the outbox, so a status is DRAFT for a few
 * seconds and ERROR after a refusal; that the seller's details, numbering and
 * VAT live in the InvoiceOcean account (D1–D4); that nothing is ever deleted;
 * and that `INVOICEOCEAN_ENABLED=false` keeps the screens readable but issues
 * nothing.
 */
export const article = {
  id: "fn-invoices",
  title: "Invoices: proformas, VAT invoices and corrections",
  summary: "What is issued when, the invoice list and its filters, PDFs, sending, cancelling, retrying, and what partners see.",
  category: "finance",
  roles: ["ADMIN"],
  routes: ["/admin/finance/invoices", "/admin/finance/invoices/[id]", "/admin/finance/invoices/sync-events"],
  keywords: [
    "invoice",
    "invoices",
    "proforma",
    "VAT invoice",
    "correction",
    "credit note",
    "InvoiceOcean",
    "PDF",
    "send invoice",
    "email invoice",
    "cancel invoice",
    "retry invoice",
    "invoice failed",
    "tax ID",
    "VAT number",
    "invoice language",
    "unmatched",
  ],
  related: ["fn-receivables", "fn-payments", "pt-detail-review", "fn-overview"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Invoices"] },
    {
      type: "paragraph",
      text: "Invoices are the legal documents behind what buyers owe us. They are created in our InvoiceOcean account, which numbers them, prints them and emails them; the platform decides when one is due, fills in the buyer and the lines, and keeps a copy of every document's status so Finance never has to open InvoiceOcean to know where things stand.",
    },
    { type: "heading", id: "what-is-issued", text: "What is issued, and when" },
    {
      type: "list",
      items: [
        "**A proforma** the moment a booking or order is confirmed, for the whole amount the buyer owes. It is a request for payment, not a tax document.",
        "**A VAT invoice** when the bill is paid in full, issued from that proforma and already marked paid. A part payment is recorded against the proforma instead.",
        "**A correction** when a booking that already has a VAT invoice is cancelled or its price changes: it reverses the old lines and adds what is now owed, with the reason printed on it.",
        "**A new proforma** when a booking is cancelled or amended before its VAT invoice: the old proforma is cancelled and, if something is still owed, a new one is issued for the charge.",
      ],
    },
    {
      type: "paragraph",
      text: "Each document starts as **Queued**: the platform has written it and asked InvoiceOcean to create it, which usually takes a few seconds. Once InvoiceOcean answers it becomes **Issued** and gets its number. Nothing in a booking ever waits for InvoiceOcean — if the provider is down, the document is retried in the background and the booking goes ahead.",
    },
    { type: "heading", id: "list", text: "The invoice list" },
    {
      type: "definitions",
      items: [
        { term: "Search", description: "Matches the invoice number and the booking or order reference." },
        { term: "Kind", description: "Proforma, VAT invoice, correction, and the advance and final kinds that can be issued by hand." },
        { term: "Status", description: "Queued, Issued, Sent, Paid, Part paid, Cancelled and Failed. Choose several to see them together." },
        { term: "Issued between", description: "By issue date, as printed on the document." },
        { term: "Guests only", description: "Documents addressed to guests who booked without a partner account." },
      ],
    },
    {
      type: "paragraph",
      text: "Each row shows the number, the kind, who it is addressed to, the amount, the status and the issue date. Open a row for the lines, the buyer as printed, the chain it belongs to (which proforma a VAT invoice came from, which correction was issued against it) and the actions.",
    },
    { type: "heading", id: "actions", text: "Opening, sending, cancelling and retrying" },
    {
      type: "definitions",
      items: [
        { term: "Open PDF", description: "Opens the document as InvoiceOcean prints it, in a new tab. Available once the document is issued." },
        { term: "Send by email", description: "Asks InvoiceOcean to email the document to the buyer's address, or to another address you type. The status becomes Sent." },
        { term: "Cancel proforma", description: "Cancels an unpaid proforma here and at InvoiceOcean — a duplicate, a mistake, a booking changed by hand. A VAT invoice is never cancelled: it is corrected." },
        { term: "Retry", description: "Shown on a Failed document. Sends it to InvoiceOcean again after you have fixed what it refused." },
        { term: "Issue proforma / VAT invoice", description: "On a receivable's page, for a booking confirmed before invoicing was switched on, or after a failed one was cancelled. You can pick the language, the due date and the VAT rate, or write the lines yourself." },
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Nothing is deleted",
      text: "Accounting documents are never removed: a proforma is cancelled, a VAT invoice is corrected, a failed one is retried or cancelled. Every one of these is recorded in the audit log with who did it and why.",
    },
    { type: "heading", id: "failed", text: "When a document fails" },
    {
      type: "paragraph",
      text: "A **Failed** document shows InvoiceOcean's own reason on its page — for example a currency the account does not accept, or a seller detail missing from the InvoiceOcean account. Fix the cause, then press **Retry**. Finance is notified in-app when a document fails, and the finance mailbox is emailed when one is set.",
    },
    {
      type: "paragraph",
      text: "InvoiceOcean reports status changes back — a document marked paid or sent there — and the platform applies them to the matching invoice. A report about a document the platform does not know is kept under **Unmatched reports**, reached from the invoice list, so nothing is silently dropped.",
    },
    { type: "heading", id: "buyer-details", text: "Tax ID and language" },
    {
      type: "paragraph",
      text: "The buyer printed on a document is the partner's legal name, address and tax ID as they were when the document was requested. Set the partner's **Tax ID** and **Invoice language** on the partner's page under **Invoicing**; a partner can also enter its own tax ID in its portal settings. InvoiceOcean prints in its own set of languages, which has no Georgian or Hebrew — English is the default.",
    },
    { type: "heading", id: "partners", text: "What the partner sees" },
    {
      type: "paragraph",
      text: "Under **Finance** in its portal, a partner sees the documents issued to it — number, kind, amount, status and a PDF link — and nothing else. A queued, failed or never-issued document is not shown, and the PDF always comes through the platform, so no one needs an InvoiceOcean login.",
    },
    {
      type: "callout",
      tone: "info",
      title: "If invoicing is switched off",
      text: "On a server where invoicing has not been switched on, these screens still show the documents already issued, but nothing new is created and the issue button explains why. Switching it on is a deployment setting (INVOICEOCEAN_ENABLED), described in the deployment guide.",
    },
    {
      type: "links",
      items: [
        { label: "Receivables: what buyers owe us", articleId: "fn-receivables" },
        { label: "Recording payments and refunds", articleId: "fn-payments" },
      ],
    },
  ],
} satisfies HelpArticle;
