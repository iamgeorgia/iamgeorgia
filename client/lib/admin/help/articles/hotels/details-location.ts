import type { HelpArticle } from "../../types";

/**
 * Two tabs of the property hub. Details & policies at
 * `/admin/hotels/[slug]/details` (`HotelDetailsEditor.tsx`): four clock
 * fields, the three descriptions with their limits, the policies fieldset
 * and house rules, the amenities checkbox grid, one Save and no dirty
 * warning. Location at `/admin/hotels/[slug]/location`
 * (`HotelLocationEditor.tsx` over `components/geo/LocationField.tsx`): the
 * address fields, the Google place search that sets the pin and offers the
 * address, the map (click, drag, reverse-geocoded), the folded-away
 * coordinate fields, Clear, and the no-key / map-failure fallbacks. Every one
 * of these is a publish blocker in `hotel.service.js`.
 */
export const article = {
  id: "ht-details-location",
  title: "Details, policies and location",
  summary: "The words guests read and the pin on the map: check-in times, descriptions, policies, amenities, address and coordinates — all of them needed before publishing.",
  category: "hotels",
  routes: [
    { pattern: "/admin/hotels/[slug]/details", section: "details" },
    { pattern: "/admin/hotels/[slug]/location", section: "location" },
  ],
  keywords: ["check-in", "check-out", "short description", "summary", "description", "policies", "house rules", "amenities", "address", "postal code", "map", "place search", "google", "latitude", "longitude", "pin"],
  related: ["ht-hub", "ht-publish-checklist", "md-images"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Hotels", "[property]", "Details & policies"] },
    {
      type: "paragraph",
      text: "Two tabs of the hub hold everything a guest reads about the property and where it is. Both save explicitly and both feed the publish checklist: a property cannot go on sale until each of these screens is complete.",
    },
    { type: "heading", id: "details", text: "Details & policies" },
    {
      type: "table",
      columns: ["Section", "What goes in it"],
      rows: [
        ["Check-in and check-out", "Four clock fields — the earliest and latest check-in, the earliest and latest check-out."],
        ["Descriptions", "**Short description**, up to 300 characters — one sentence for search cards. **Summary**, up to 500 characters. **Description**, in paragraphs."],
        ["Policies guests read", "The policy fields, plus house rules as a list — one rule per line."],
        ["Amenities", "A grid of checkboxes grouped by category. Tick what the property offers."],
      ],
    },
    {
      type: "steps",
      items: [
        "Fill the clock fields for check-in and check-out.",
        "Write the three descriptions. The short one is what a search card shows, so keep it to one sentence.",
        "Complete the policies and add any house rules.",
        "Tick at least one amenity.",
        "Press **Save**. The button shows **Saved.** when the server has taken it.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Leaving the page loses unsaved edits without warning",
      text: "There is no autosave and no unsaved-changes prompt. If you navigate away before pressing **Save**, the edits are gone.",
    },
    { type: "heading", id: "location", text: "Location" },
    {
      type: "paragraph",
      text: "The Location tab holds **Street address** and **Postal code** on the left, and **On the map** on the right: a search box, a card naming the chosen place, a Google map with the pin, and a folded-away **Enter coordinates by hand** section. The map opens on the property's pin, or on the whole of Georgia when it has none yet.",
    },
    {
      type: "steps",
      items: [
        "Type the property's name or address into the search box and choose it from the suggestions. The pin drops there, the card shows the address Google holds, and the coordinates are stored — you never type them.",
        "If **Street address** or **Postal code** was empty, the search fills it in. Reword it freely: the address guests are given is yours, the pin is the position.",
        "Drag the pin, or click the map, if it is not on the entrance. The card updates to the address at the new spot.",
        "Press **Save location**.",
      ],
    },
    {
      type: "list",
      items: [
        "**Clear** on the card takes the pin off the map; saving then removes the property's position, and the screen warns you before you do.",
        "**Enter coordinates by hand** is for a spot search cannot find, or a pair a supplier sent. Typing there keeps the pin alone and drops the address on the card; both figures are needed, or neither.",
        "If the box reads **Place search is not configured on this deployment**, this site has no Google key: the map is off and the coordinate section is open for you to type into.",
        "If the map reads **The map could not be loaded. Reload the page to try again.**, the coordinate section still works — type and save without the map.",
        "Coordinates are stored to six decimal places.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "All of this blocks publishing",
      text: "Address, coordinates, short description, description, complete policies, check-in and check-out times and at least one amenity are each an item on the publish checklist. A property missing any of them cannot be put on sale.",
    },
    {
      type: "links",
      items: [
        { label: "Getting a hotel on sale", articleId: "ht-publish-checklist" },
        { label: "Images: limits, cover, detach vs delete", articleId: "md-images" },
      ],
    },
  ],
} satisfies HelpArticle;
