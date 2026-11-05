import type { HelpArticle } from "../../types";

/**
 * `/admin/tours/[slug]/details` (`TourDetailsEditor.tsx`). Every field with
 * its hint and range, the four line lists, the itinerary day builder, the
 * one **Save changes** button; no slug field; the editorial image path yields
 * to uploaded gallery images; the server refuses a child limit below the
 * infant limit.
 */
export const article = {
  id: "tr-details-itinerary",
  title: "Details and itinerary",
  summary: "The words a traveller reads, the age limits, the four lists and the day-by-day itinerary — all saved with one button.",
  category: "tours",
  routes: ["/admin/tours/[slug]/details"],
  keywords: ["description", "highlights", "included", "not included", "important information", "itinerary", "day", "meals", "overnight", "meeting point", "meeting time", "minimum age", "infant", "child", "editorial image", "cover"],
  related: ["tr-create", "tr-publish-checklist", "md-images", "pb-translations"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Tours", "[tour]", "Details & itinerary"] },
    {
      type: "paragraph",
      text: "This screen holds everything a traveller reads about the tour, in English. Translations into Georgian, Russian and Hebrew are made on their own screen and fall back to what you write here.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "table",
      columns: ["Field", "What it wants"],
      rows: [
        ["Title, Region, Category, Difficulty, Group size", "As on the create form; all editable here."],
        ["Length in days", "1 to 60. The hint says why it matters for capacity: a multi-day tour claims its departure date only."],
        ["Length as a traveller reads it", "The words shown on the public page."],
        ["Summary", "Up to 600 characters."],
        ["Description", "Paragraphs. Leave a blank line between them."],
        ["Editorial image path", "**A path under /public.** Uploaded gallery images take precedence once there are any."],
        ["Meeting point, Meeting time", "Up to 500 characters, and a wall-clock time."],
        ["Minimum age", "0 to 99. Blank means no floor."],
        ["Infants up to", "0 to 17, default 2. The oldest age that counts as an infant."],
        ["Children up to", "0 to 17, default 11. The oldest age that counts as a child. A child limit below the infant limit is refused."],
        ["Highlights, Important information, Included, Not included", "One entry per line. Blank lines are dropped."],
      ],
    },
    { type: "heading", id: "itinerary", text: "The itinerary" },
    {
      type: "steps",
      items: [
        "Add a day. Each one has a **Title**, a **What happens** text, **Meals** checkboxes and an **Overnight** field.",
        "Add as many days as the tour has. A day trip needs at least one; the publish checklist looks for it.",
        "Press **Save changes**. The button reads **Saved** when the whole screen — fields, lists and days — has been written.",
      ],
    },
    {
      type: "paragraph",
      text: "For example, a two-day Kazbegi tour has day one ending with an overnight in Stepantsminda and day two returning to Tbilisi, with lunch ticked on both.",
    },
    {
      type: "callout",
      tone: "info",
      text: "There is no slug field. The public URL was fixed when the tour was created.",
    },
    {
      type: "callout",
      tone: "info",
      text: "The editorial image path is a fallback. As soon as one image is uploaded on the **Images** screen, the gallery cover is what the public page and the publish checklist use, and the path is ignored.",
    },
  ],
} satisfies HelpArticle;
