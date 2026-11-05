import type { HelpArticle } from "../../types";

/**
 * The three translation screens: `TourTranslationsEditor.tsx` (eleven
 * fields), `PackageTranslationsEditor.tsx` (name, summary, description) and
 * `ServiceTranslationsEditor.tsx` on the service page (name, summary,
 * description, included). English is the base row and `en` is rejected as a
 * translation locale; a blank field falls back to English field by field.
 * Hotels, destinations, room types, transfer routes, points and vehicle
 * classes have no translation screen in the panel.
 */
export const article = {
  id: "pb-translations",
  title: "Translations (ka / ru / he)",
  summary: "How the Georgian, Russian and Hebrew versions of a page are written, what happens to a field left blank, and which records cannot be translated from the panel.",
  category: "publishing",
  routes: [
    { pattern: "/admin/tours/[slug]/translations", section: "tours" },
    { pattern: "/admin/packages/[slug]/translations", section: "packages" },
  ],
  keywords: ["translation", "translate", "georgian", "russian", "hebrew", "locale", "language", "ka", "ru", "he", "fallback", "english"],
  related: ["pb-slugs-and-seo", "tr-hub", "pk-hub", "sv-editing"],
  blocks: [
    {
      type: "paragraph",
      text: "The public site speaks four languages: English, Georgian, Russian and Hebrew. Every record is written in English first; the other three are translations layered over it, one screen per record, one tab per language.",
    },
    { type: "heading", id: "how-it-works", text: "How it works" },
    {
      type: "list",
      items: [
        "English is the base. It is written on the record's own screens and cannot be translated into — there is no English tab.",
        "The translation screen has three tabs: **ქართული**, **Русский** and **עברית**.",
        "Each field's placeholder is the English text, so you always see what you are translating.",
        "A field left blank shows the English on the public page. The fallback is per field: one untranslated field does not blank the page or fall the whole page back to English.",
        "Each tab has its own **Save**. Saving Georgian does not save an unsaved Russian tab.",
      ],
    },
    {
      type: "steps",
      items: [
        "Open the record's **Translations** tile.",
        "Choose a language tab.",
        "Fill the fields worth translating; leave the rest blank to show the English.",
        "Press **Save** on that tab. Repeat for the other languages.",
      ],
    },
    { type: "heading", id: "tours", text: "Tours" },
    {
      type: "paragraph",
      text: "Eleven fields: **Title**, **Region**, **Length label**, **Group size**, **Meeting point**, **Summary**, **Description**, **Highlights**, **Important information**, **Included** and **Not included**. Numbers — days, ages, prices — are not language and stay on the details screen.",
    },
    { type: "heading", id: "packages", text: "Packages" },
    {
      type: "paragraph",
      text: "Three fields: **Name**, **Summary** and **Description**. As the screen says, facts — nights, dates, party limits, the adjustment — are not language and are not here.",
    },
    { type: "heading", id: "services", text: "Services" },
    {
      type: "paragraph",
      text: "A service has no hub; its translations sit on the service page itself, under the form. Four fields: **Name**, **Summary**, **Description** and **Included**.",
    },
    { type: "heading", id: "not-translatable", text: "What cannot be translated from the panel" },
    {
      type: "callout",
      tone: "info",
      title: "No translation screen for hotels or destinations",
      text: "Hotels, destinations, room types, transfer routes, pick-up points and vehicle classes have no translations screen. Their English text is what every language shows.",
    },
    {
      type: "links",
      items: [
        { label: "Slugs, URLs and automatic SEO", articleId: "pb-slugs-and-seo" },
        { label: "Services", articleId: "sv-editing" },
      ],
    },
  ],
} satisfies HelpArticle;
