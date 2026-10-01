import type { HelpArticle } from "../../types";

/**
 * Verification and documents across drivers and cars, drawn from
 * `DriverVerification.tsx`, `DocumentsPanel.tsx`, `lib/admin/fleet.ts`
 * document types and the dispatch override. Encodes: VERIFIED as the tick a
 * partner sees; the "Driver not yet verified" override at assignment,
 * audited; the four states; private documents opened via signed links written
 * to the audit trail; the document types for cars and drivers; expiry being
 * cosmetic; a suggested routine.
 */
export const article = {
  id: "fd-verification-documents",
  title: "Verifying drivers and keeping documents",
  summary: "What the verification states mean, what dispatch does with them, how private documents are kept, and a routine for checks.",
  category: "fleet-drivers",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["verification", "verified", "not checked", "checks in progress", "rejected", "override", "documents", "licence", "insurance", "expiry", "expired", "audit"],
  related: ["fd-driver-detail", "fd-car-detail", "dp-assigning-a-driver", "md-documents"],
  blocks: [
    {
      type: "paragraph",
      text: "Verification is a record that somebody checked a driver's papers. It changes what a partner sees and what dispatch has to override, but nothing in the panel checks a document for you.",
    },
    { type: "heading", id: "states", text: "The four states" },
    {
      type: "table",
      columns: ["State", "Meaning"],
      rows: [
        ["`UNVERIFIED` — Not checked", "Nobody has recorded a check yet. Every new profile starts here."],
        ["`PENDING` — Checks in progress", "Somebody is working through the papers. Counted as awaiting checks on the register."],
        ["`VERIFIED` — Verified", "The checks passed. The partner sees a tick beside the driver, and the page records who verified and when."],
        ["`REJECTED` — Rejected", "The checks failed. Nothing prevents the profile existing, but it should not be assigned."],
      ],
    },
    {
      type: "paragraph",
      text: "Dispatch treats `VERIFIED` as the normal case. Assigning any other driver to a job needs the **Driver not yet verified** override on the dispatch screen, and that override is written to the audit trail with the assignment.",
    },
    { type: "heading", id: "documents", text: "Documents" },
    {
      type: "list",
      items: [
        "Driver documents: **Driving licence**, **ID document**, **Medical certificate**, **Background check**, **Other**.",
        "Car documents: **Registration**, **Insurance**, **Technical inspection**, **Other**.",
        "Each has a label and a **Valid until** date, and is kept on the driver's or the car's page.",
        "Documents are private and never public. Opening one fetches a short-lived signed link, and every opening is written to the audit trail with who opened it.",
        "Removing a document asks the browser's confirmation; the file stays in the media library.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "Expiry is cosmetic. A document past its **Valid until** date turns red and reads **expired** on the page, and nothing else happens: dispatch is not blocked, the registers show no badge, and nobody is reminded.",
    },
    { type: "heading", id: "routine", text: "A routine that works" },
    {
      type: "steps",
      items: [
        "Open the driver's page and upload the licence, ID and any certificate the supplier provides, with the real **Valid until** dates.",
        "Open each document once and check it against the profile — name, date of birth, licence number.",
        "In **Verification**, set **Verified** and write in the **Note** what was checked and against what. Press **Record**.",
        "Put the earliest **Valid until** date in your own calendar; the panel will not remind you.",
        "When a paper expires or a check fails, set **Checks in progress** or **Rejected** with a note. Moving away from Verified clears who verified and when, so the note is the record.",
      ],
    },
    {
      type: "links",
      items: [
        { label: "A driver: profile, documents, cars, verification, login, deactivation", articleId: "fd-driver-detail" },
        { label: "A car: details, photographs, documents, status", articleId: "fd-car-detail" },
      ],
    },
  ],
} satisfies HelpArticle;
