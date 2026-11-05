import type { HelpArticle } from "../../types";

/**
 * The new-property form at `/admin/hotels/new` (`NewHotelForm.tsx`): the six
 * fields and their defaults, the slug derived from the name, the supplier
 * list limited to approved HOTEL partners, "Create draft" landing on the
 * hub, the absence of any later slug field in the panel, and the `slugify`
 * in `lib/admin/geography.ts` that turns Georgian or Cyrillic names into
 * nothing.
 */
export const article = {
  id: "ht-create",
  title: "Adding a property",
  summary: "Name it and place it: the six fields of a new draft, and the one of them you cannot change afterwards.",
  category: "hotels",
  routes: ["/admin/hotels/new"],
  keywords: ["new hotel", "create property", "draft", "slug", "star rating", "supplier", "platform-managed", "destination"],
  related: ["ht-register", "ht-hub", "ds-editing", "pb-slugs-and-seo"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels", "Add property"] },
    {
      type: "paragraph",
      text: "A property starts as a draft with a name and a place. Everything else — rooms, prices, images, policies, location — is added afterwards from its hub, and nothing is visible to anyone until it is published.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "table",
      columns: ["Field", "Rule"],
      rows: [
        ["Property name", "Required. Up to 120 characters."],
        ["Slug", "Required. Fills itself from the name as you type. Part of the public URL: lowercase letters, numbers and hyphens."],
        ["Property type", "Hotel, Boutique, Resort, Guesthouse, Lodge, Apartment, Chalet, Hostel or Villa. Default Hotel."],
        ["Official star rating", "1 to 5. Default 4."],
        ["Destination", "Required. Country and time zone are inherited from it."],
        ["Supplier", "An approved hotel partner, or **Platform-managed** when the platform sells it directly. Default Platform-managed."],
      ],
    },
    { type: "heading", id: "creating", text: "Creating the draft" },
    {
      type: "steps",
      items: [
        "Type the **Property name** and check the **Slug** it produced.",
        "Choose the **Property type** and **Official star rating**.",
        "Pick the **Destination**. The button stays disabled until one is chosen; if the place does not exist yet, create it under Destinations first.",
        "Choose a **Supplier** if a partner runs the property.",
        "Press **Create draft**. The property's hub opens with its six tiles and the publish checklist.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "The slug is set here and nowhere else",
      text: "No later screen in the panel offers a slug field for a hotel. Check it before pressing **Create draft**: it becomes the property's public address.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Georgian and Cyrillic names produce no slug",
      text: "The slug is derived from Latin letters only. A name typed in Georgian or Cyrillic slugifies to nothing — type the slug by hand, in Latin characters.",
    },
    {
      type: "links",
      items: [
        { label: "The property hub, publishing and statuses", articleId: "ht-hub" },
        { label: "Slugs, URLs and automatic SEO", articleId: "pb-slugs-and-seo" },
      ],
    },
  ],
} satisfies HelpArticle;
