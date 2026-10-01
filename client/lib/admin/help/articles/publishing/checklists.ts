import type { HelpArticle } from "../../types";

/**
 * The publish checklists side by side: hotel (`hotel.service.js`, twelve
 * items), tour (`tour.service.js`), package (`package.service.js`), service
 * (`service.service.js`) and transfer route. The 422 with `missing[]` is
 * rendered identically by every Actions component as "Not ready to
 * publish: …".
 */
export const article = {
  id: "pb-checklists",
  title: "Publish checklists at a glance",
  summary: "Everything Publish waits for, entity by entity, and how the refusal message reads when something is still missing.",
  category: "publishing",
  roles: ["ADMIN"],
  keywords: ["checklist", "publish", "not ready to publish", "missing", "blockers", "requirements", "go live", "422"],
  related: ["pb-statuses", "ht-publish-checklist", "tr-publish-checklist", "pk-publish-checklist", "sv-editing", "tc-route-editing"],
  blocks: [
    {
      type: "paragraph",
      text: "Each hub's **Publishing** panel lists what its record still lacks, and **Publish** stays disabled until the list is empty. The same list is checked again by the server, so nothing incomplete can slip through. Here they are together.",
    },
    { type: "heading", id: "hotel", text: "Hotel — twelve items" },
    {
      type: "steps",
      items: [
        "A street address.",
        "Coordinates.",
        "A short description.",
        "A description.",
        "Complete policies.",
        "Check-in and check-out times.",
        "At least one amenity.",
        "At least one image.",
        "A cover image.",
        "At least one active room type.",
        "At least one active rate plan on an active room.",
        "A verified kosher certificate, if the kosher level is `PARTIAL` or `FULL`.",
      ],
    },
    { type: "heading", id: "tour", text: "Tour" },
    {
      type: "steps",
      items: [
        "A summary.",
        "A description.",
        "A meeting point.",
        "At least one itinerary day.",
        "A cover — an editorial image path on the details screen, or an uploaded cover.",
        "At least one active option.",
        "A price sheet with tiers.",
        "Capacity on at least one future departure.",
      ],
    },
    { type: "heading", id: "package", text: "Package" },
    {
      type: "steps",
      items: [
        "A summary.",
        "At least one required part.",
        "A cover — an editorial image path, or an uploaded cover.",
        "If the adjustment is anything other than none, a value greater than zero.",
      ],
    },
    { type: "heading", id: "service", text: "Service" },
    {
      type: "steps",
      items: ["A summary.", "A net price greater than zero.", "Cancellation terms chosen."],
    },
    { type: "heading", id: "transfer-route", text: "Transfer route" },
    {
      type: "paragraph",
      text: "Only missing prices block a route. Everything else on it can be filled in after publishing.",
    },
    { type: "heading", id: "message", text: "The refusal" },
    {
      type: "paragraph",
      text: "If **Publish** is pressed while something is missing, the server refuses and returns the whole list. Every hub shows it the same way, in one line: **Not ready to publish: summary; meeting point; cover.** Fix the named items and press **Publish** again.",
    },
    {
      type: "links",
      items: [
        { label: "Getting a hotel on sale", articleId: "ht-publish-checklist" },
        { label: "Getting a tour on sale", articleId: "tr-publish-checklist" },
        { label: "Getting a package on sale", articleId: "pk-publish-checklist" },
      ],
    },
  ],
} satisfies HelpArticle;
