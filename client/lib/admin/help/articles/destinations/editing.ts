import type { HelpArticle } from "../../types";

/**
 * The destination form at `/admin/destinations/new` and
 * `/admin/destinations/[id]` — both render `DestinationForm.tsx` — plus the
 * "At a glance" sidebar on the edit page and `DestinationDangerZone.tsx`.
 * Encodes the field rules from `server/validation/normalize.js` and
 * `lib/admin/destinations.ts`, the read-only slug on edit, the parent-move
 * re-filing of every descendant, the position set by Google place search
 * (`components/geo/LocationField.tsx`: prefills an empty name and the
 * country, map drag, typed coordinates, Clear), the retired public
 * destinations section, and the hard delete refused with `blockedBy` while
 * anything is still filed inside.
 */
export const article = {
  id: "ds-editing",
  title: "Creating and editing a destination",
  summary:
    "The one form behind a new place and an existing one: the fields, the map pin, what moving a place does to everything inside it, and how deletion is refused.",
  category: "destinations",
  roles: ["ADMIN"],
  routes: [
    { pattern: "/admin/destinations/new", section: "create" },
    { pattern: "/admin/destinations/[id]", section: "edit" },
  ],
  keywords: ["new destination", "add country", "parent", "sits inside", "slug", "country code", "time zone", "map pin", "latitude", "longitude", "tagline", "delete destination"],
  related: ["ds-register", "ht-create", "pb-slugs-and-seo"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Destinations", "[place]"] },
    {
      type: "paragraph",
      text: "A new place and an existing one use the same form. It saves when you press the button and not before: there is no autosave, and leaving the page with changes unsaved does not warn you.",
    },
    { type: "heading", id: "create", text: "Creating a destination" },
    {
      type: "steps",
      items: [
        "On the register press **Add destination**.",
        "Type the **Name**. The **Slug** fills itself from the name as you type; you can overwrite it.",
        "Choose the **Type**. It starts as City. A country needs no parent; anything else needs one.",
        "Pick **Sits inside** — the place this one is filed in. Only places at least as broad are offered: a city can sit in a region or a country, never in a resort.",
        "Check the **Country code** and **Time zone**. Both follow the parent until you edit them by hand.",
        "Press **Create destination**. The new place's page opens.",
      ],
    },
    {
      type: "paragraph",
      text: "The hint under the button says what is required: a name, a slug and somewhere to sit are the minimum. The button stays disabled until they are there.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "table",
      columns: ["Field", "Rule"],
      rows: [
        ["Name", "Required. Up to 120 characters."],
        ["Slug", "Required. Lowercase letters, numbers and hyphens, 2–120 characters, unique across all destinations."],
        ["Type", "`COUNTRY`, `REGION`, `CITY` or `RESORT`. Default City. A parent must be as broad as this place or broader."],
        ["Sits inside", "The parent. Required for everything except a country. Choosing Country clears it. A place can never be filed inside itself or its own descendants."],
        ["Country code", "Two letters, upper case. Default `GE`; inherited from the parent until edited. Required for a country."],
        ["Time zone", "A list of five zones, default `Asia/Tbilisi`."],
        ["Featured", "A checkbox. Counted on the register; renders nowhere public today."],
        ["Latitude / Longitude", "Optional, but as a pair: both or neither. Stored to six decimal places."],
        ["Tagline", "Up to 200 characters."],
        ["Summary", "Up to 500 characters."],
        ["Cover image / Hero image", "A plain path or URL, up to 500 characters. Not an upload — these fields do not use the image library."],
        ["Description", "One paragraph per line, up to 40 paragraphs."],
        ["Ideal for", "One entry per line, up to 20."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "The slug is fixed once created",
      text: "On an existing destination the **Slug** field is read-only. A destination's slug is a path segment for everything inside it, so it is set once, at creation.",
    },
    { type: "heading", id: "map", text: "Placing it on the map" },
    {
      type: "paragraph",
      text: "Optional. Under **Where it is**, search for the place and choose it from the suggestions: the pin drops there and the coordinates are stored for you. If **Name** was still empty it fills in from the place, and the **Country code** follows the place until you edit it by hand. Drag the pin to refine, or open **Enter coordinates by hand** to type a pair. A place without a pin shows as `Not placed` on the register.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Clearing the pin",
      text: "**Clear** on the card under the search box takes the pin off the map. On an existing destination the form then warns **Saving now takes this destination off the map** — save, and the register shows it as `Not placed` again.",
    },
    { type: "heading", id: "edit", text: "Editing a destination" },
    {
      type: "paragraph",
      text: "Open a place from the register, change the fields and press **Save destination**. The sidebar shows **At a glance** — slug, type, path, country, time zone, coordinates, featured and **Hotels here and below**, which counts every hotel filed in this place and in everything inside it — and **Inside this destination**, a list of links to its children.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Moving a place moves everything inside it",
      text: "Changing **Sits inside** re-files every descendant: each child, grandchild and hotel underneath gets a new path. The control looks like any other select, and the form only warns — it does not ask twice.",
    },
    {
      type: "callout",
      tone: "info",
      title: "The editorial fields render nowhere yet",
      text: "The public destinations section is retired, so **Tagline**, **Summary**, **Cover image**, **Hero image**, **Description** and **Ideal for** are stored but not shown anywhere on the site today.",
    },
    { type: "heading", id: "delete", text: "Deleting a destination" },
    {
      type: "steps",
      items: [
        "At the foot of the place's page find the **Delete this destination** panel. If the place has children the panel already says so.",
        "Press the delete button, then confirm with **Delete [name]** — or **Cancel**.",
      ],
    },
    {
      type: "paragraph",
      text: "The delete is refused while anything is still filed inside the place — hotels, child destinations, tours or experiences. The message names what is left, for example **Still attached: 3 hotels, 2 destinations inside it. Move or remove them first.**",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "There is no archive for destinations: delete removes the place for good. Nothing inside it is deleted with it — that is why the delete waits until the place is empty.",
    },
    {
      type: "links",
      items: [
        { label: "Destinations register", articleId: "ds-register" },
        { label: "Slugs, URLs and automatic SEO", articleId: "pb-slugs-and-seo" },
      ],
    },
  ],
} satisfies HelpArticle;
