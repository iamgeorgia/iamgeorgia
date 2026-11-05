import type { HelpArticle } from "../../types";

/**
 * Slugs and the automatic SEO. Slug rules from `server/validation/normalize.js`
 * (`^[a-z0-9]+(-[a-z0-9]+)*$`, 2–120, unique) and the create forms' own
 * `slugify`; which entity can change its slug later (services only in the
 * UI; destinations read-only; hotels, tours, packages, routes and points have
 * no field). No `SlugHistory` model exists — `client/lib/seo/slug.ts` only
 * canonicalises the current slug, so a changed slug 404s old links. Meta
 * from `client/lib/seo/metadata.ts` (155 chars), the social image from
 * `client/lib/seo/social.ts`, JSON-LD from `client/lib/seo/jsonLd.tsx`.
 */
export const article = {
  id: "pb-slugs-and-seo",
  title: "Slugs, URLs and automatic SEO",
  summary: "What a slug must look like, which records can change theirs, why changing one breaks every shared link, and what the site does for search engines without being asked.",
  category: "publishing",
  keywords: ["slug", "url", "public address", "seo", "meta title", "meta description", "open graph", "social image", "json-ld", "hreflang", "redirect", "404", "canonical"],
  related: ["pb-translations", "ht-create", "sv-editing", "ds-editing", "md-images"],
  blocks: [
    {
      type: "paragraph",
      text: "A slug is the last part of a record's public address — `/hotels/rooms-tbilisi`. It is chosen once, when the record is created, and everything a search engine or a social network needs from the page is derived from the record afterwards without any field to fill in.",
    },
    { type: "heading", id: "rules", text: "Slug rules" },
    {
      type: "list",
      items: [
        "Lowercase letters, numbers and hyphens only — no spaces, no capitals, no other characters.",
        "Between 2 and 120 characters.",
        "Unique among records of the same kind.",
        "Filled in automatically from the name as you type it on the create form. Latin letters only: a Georgian or Cyrillic name produces no slug, so type one by hand.",
      ],
    },
    { type: "heading", id: "changing", text: "Which records can change their slug" },
    {
      type: "table",
      columns: ["Record", "After creation"],
      rows: [
        ["Service", "Editable on the service form — the only one."],
        ["Destination", "Shown read-only. It is a path segment for everything filed inside it."],
        ["Hotel, tour, package", "No slug field on any screen. The slug typed at creation is final."],
        ["Transfer route, pick-up point", "No slug field."],
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "A changed slug breaks every link already shared",
      text: "There is no redirect history. The site only redirects a record's id or a wrongly-cased slug to its current slug; the old slug itself answers 404. Every link already sent to a customer, posted, or indexed by a search engine stops working the moment a service's slug is changed. Get the slug right on the create form and leave it.",
    },
    { type: "heading", id: "automatic", text: "What the site does automatically" },
    {
      type: "definitions",
      items: [
        {
          term: "Meta title and description",
          description: "Derived from the name and the summary, trimmed to 155 characters at a word boundary. There is no field to override them — write a good summary and the page has a good description.",
        },
        {
          term: "Social (Open Graph) image",
          description: "Chosen automatically when a page is shared: the gallery cover first, then the editorial image path, then the platform's own card. There is no picker.",
        },
        {
          term: "Structured data (JSON-LD)",
          description: "Hotel, tour and package pages carry schema.org data and breadcrumbs, built from the record.",
        },
        {
          term: "Languages (hreflang)",
          description: "Each page declares its English, Georgian, Russian and Hebrew versions to search engines, whether or not a translation has been written.",
        },
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Admin URLs are not public URLs",
      text: "The panel opens every record by its id, so the address bar in the panel never shows the slug. Nothing you do to an admin URL changes the public one.",
    },
    {
      type: "links",
      items: [
        { label: "Translations (ka / ru / he)", articleId: "pb-translations" },
        { label: "Images: limits, cover, detach vs delete", articleId: "md-images" },
      ],
    },
  ],
} satisfies HelpArticle;
