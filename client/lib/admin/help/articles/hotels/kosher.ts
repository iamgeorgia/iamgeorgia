import type { HelpArticle } from "../../types";

/**
 * The Kosher tab at `/admin/hotels/[slug]/kosher`: `HotelKosherEditor.tsx`
 * (the profile's existence is the switch; Level; facilities written through
 * the amenity endpoint; notes; contact), `KosherCertifications.tsx`
 * (scope, verify, archive with a reason, editing a verified certificate
 * withdraws its verification) and `KosherDocuments.tsx` (private uploads
 * opened via short-lived signed links, audited). "Certified" is derived
 * from a verified, unexpired PROPERTY/KITCHEN certificate; PARTIAL and FULL
 * cannot publish without one (`hotel.service.js`). Turning the switch off
 * deletes the profile and is refused while a certificate is live.
 */
export const article = {
  id: "ht-kosher",
  title: "Kosher profile and certificates",
  summary: "How a property becomes kosher on the platform: the profile, the level, the certificates that earn the certified badge, and the private documents behind them.",
  category: "hotels",
  keywords: ["kosher", "kashrut", "certificate", "certified", "supervising authority", "hechsher", "mashgiach", "verify", "scope", "expiry", "passover", "kitchen"],
  routes: ["/admin/hotels/[slug]/kosher"],
  related: ["ht-hub", "ht-publish-checklist", "ht-register", "pk-kosher", "md-documents"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels", "[property]", "Kosher"] },
    {
      type: "paragraph",
      text: "The Kosher tab has three parts: the profile, which says what the property offers; the certificates, which prove it; and the documents the certificates point at. The green **Kosher** badge on the register and the public site is earned by a certificate, never ticked.",
    },
    { type: "heading", id: "profile", text: "The profile" },
    {
      type: "paragraph",
      text: "**This property provides Kosher services** is the switch. Turning it on creates the profile; turning it off deletes it. While a certificate is still live the server refuses to delete the profile — archive the certificate first.",
    },
    {
      type: "table",
      columns: ["Field", "What it means"],
      rows: [
        ["Level of kosher service", "`NONE`, `ON_REQUEST`, `KOSHER_FRIENDLY`, `PARTIAL` or `FULL`."],
        ["Facilities", "Checkboxes for the kosher facilities. They are written through the property's amenities, so the amenities grid on Details & policies always agrees with them."],
        ["In the property's words", "Free notes shown to guests."],
        ["Contact", "Name, email and phone of the person to ask about kosher arrangements."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "There is no Certified checkbox",
      text: "Certified is derived, not entered: a property is certified while it holds a verified, unexpired certificate whose scope is **Whole property** or **Kitchen**. A certificate scoped **Restaurant only** or **Passover only** is recorded but does not make the property certified.",
    },
    { type: "heading", id: "certificates", text: "Certificates" },
    {
      type: "table",
      columns: ["Field", "Rule"],
      rows: [
        ["Supervising authority", "Free text, as printed on the certificate. Never translated."],
        ["Certificate number", "As printed."],
        ["Scope", "**Whole property**, **Kitchen**, **Restaurant only** or **Passover only**. Only the first two count towards certified."],
        ["Certificate file", "Picked from the documents uploaded below."],
        ["Issued on", "The date on the certificate."],
        ["Expires on", "Leave empty for a certificate with no expiry."],
      ],
    },
    {
      type: "steps",
      items: [
        "Upload the certificate file under **Documents** first.",
        "Add the certificate, choosing the file, the scope and the dates.",
        "Press **Verify** once you have checked it against the authority. Only a verified certificate counts.",
        "When it lapses or is withdrawn, press **Archive** and give a reason under **Why**.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Editing a verified certificate withdraws its verification",
      text: "Any change to a verified certificate — even correcting a date — takes the verification away until it is verified again. The form warns before it submits. On a `PARTIAL` or `FULL` property that can mean it is no longer publishable, and a property already on sale loses its certified badge.",
    },
    { type: "heading", id: "documents", text: "Documents" },
    {
      type: "paragraph",
      text: "Certificate files are uploaded as private documents: PDF, JPEG, PNG, WebP or AVIF. They never have a public address. Opening one fetches a short-lived link that expires on its own, and every opening is written to the audit trail.",
    },
    { type: "heading", id: "publishing", text: "What kosher means for publishing" },
    {
      type: "callout",
      tone: "warning",
      title: "PARTIAL and FULL need a verified certificate",
      text: "A property whose level is `PARTIAL` or `FULL` cannot be published without a verified, unexpired certificate for the whole property or the kitchen. The checklist lists it as missing until one exists. The lower levels publish without a certificate.",
    },
    {
      type: "links",
      items: [
        { label: "Getting a hotel on sale", articleId: "ht-publish-checklist" },
        { label: "Private documents", articleId: "md-documents" },
        { label: "Kosher packages", articleId: "pk-kosher" },
      ],
    },
  ],
} satisfies HelpArticle;
