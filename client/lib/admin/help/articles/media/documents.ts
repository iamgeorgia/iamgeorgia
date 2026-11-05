import type { HelpArticle } from "../../types";

/**
 * Private documents: kosher certificates (`KosherDocuments.tsx`), fleet
 * documents and driver documents. The document limit (25 MB) and the
 * PDF/JPEG/PNG/WebP/AVIF accept list come from `server/config.js` and the
 * upload components; privacy from `upload.service.js` choosing visibility by
 * category; the short-lived signed link and the `PRIVATE_FILE_ACCESSED`
 * audit event from the media routes. Expiry is displayed but never enforced
 * anywhere in dispatch.
 */
export const article = {
  id: "md-documents",
  title: "Private documents",
  summary: "Certificates, registrations, licences and the like: what can be uploaded, why they never have a public address, and what the expiry date does — and does not — do.",
  category: "media",
  keywords: ["document", "pdf", "certificate", "registration", "insurance", "technical inspection", "driving licence", "id document", "medical certificate", "background check", "valid until", "expired", "private", "signed link", "audit"],
  related: ["md-images", "fd-verification-documents", "fd-car-detail", "fd-driver-detail"],
  blocks: [
    {
      type: "paragraph",
      text: "Three screens take documents rather than images: a hotel's kosher certificates, a car's documents and a driver's documents. They share one upload path and one rule — a document is private. Nothing on the public site, and no link anyone can share, ever points at one.",
    },
    { type: "heading", id: "what", text: "What goes where" },
    {
      type: "table",
      columns: ["Screen", "Document types"],
      rows: [
        ["Hotel — Kosher", "Kosher certificates, picked from the uploads when a certificate is added."],
        ["Fleet — a car", "Registration, Insurance, Technical inspection, Other."],
        ["Drivers — a driver", "Driving licence, ID document, Medical certificate, Background check, Other."],
      ],
    },
    { type: "heading", id: "uploading", text: "Uploading" },
    {
      type: "steps",
      items: [
        "Choose the **Type** of document.",
        "Give it a **Label** so it can be told apart from the others of the same type.",
        "Set **Valid until** where the document has an expiry.",
        "Pick the file: PDF, JPEG, PNG, WebP or AVIF, up to 25 MB.",
      ],
    },
    { type: "heading", id: "opening", text: "Opening a document" },
    {
      type: "paragraph",
      text: "A document has no public URL. Opening one asks the server for a short-lived signed link, which stops working on its own soon after. Every opening is written to the audit trail under the account that did it — so open documents when you need them, not out of curiosity.",
    },
    { type: "heading", id: "expiry", text: "Expiry" },
    {
      type: "callout",
      tone: "warning",
      title: "Expiry is shown, never enforced",
      text: "A document past its **Valid until** date is marked in red — **expired 12 Mar 2026** — and that is all. Nothing stops a car or driver with an expired document being dispatched, and nobody is reminded before or after the date. Checking expiries is a habit, not a feature.",
    },
    { type: "heading", id: "removing", text: "Removing" },
    {
      type: "paragraph",
      text: "**Remove** on a document asks the browser for confirmation, then detaches it from the car, driver or certificate. The file itself stays in the library.",
    },
    {
      type: "links",
      items: [
        { label: "Images: limits, cover, detach vs delete", articleId: "md-images" },
        { label: "Verification documents", articleId: "fd-verification-documents" },
      ],
    },
  ],
} satisfies HelpArticle;
