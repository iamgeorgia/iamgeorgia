import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/routes/[id]` (`transfers/routes/[id]/page.tsx`,
 * `TransferPriceGrid.tsx`, `TransferRouteEditor.tsx`, `TransferStopsEditor.tsx`,
 * `TransferBlackouts.tsx`, `TransferRouteDangerZone.tsx`). Encodes: the
 * publish checklist (NO_PRICES, NO_TITLE, NO_SUMMARY) with only missing prices
 * blocking publish; the fares grid typed in lari and stored as rounded tetri,
 * saved as a whole, a blank one-way removing the class and a blank return
 * meaning twice one-way; the editor with no slug field and no translations
 * screen; intermediate stops with a 30-minute default wait; inclusive closed
 * dates with an unconfirmed Reopen; archive as a two-click action with no
 * delete, and Restore as a draft keeping the fares.
 */
export const article = {
  id: "tc-route-editing",
  title: "Editing a route: fares, details, stops, closed dates, archive",
  summary: "Everything on a route's page — the price grid, the details editor, intermediate stops, closed-date windows, publishing and archiving.",
  category: "transfers-catalogue",
  roles: ["ADMIN"],
  routes: ["/admin/transfers/routes/[id]"],
  keywords: ["fares", "price grid", "one way", "return", "publish", "unpublish", "stops", "via", "closed dates", "blackout", "reopen", "archive", "restore", "checklist"],
  related: ["tc-route-create", "tc-pricing-model", "tc-vehicle-classes", "tc-routes-register", "pb-checklists", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Routes", "[route]"] },
    {
      type: "paragraph",
      text: "A route's page is one scrolling screen with four panels — **Fares**, **The route itself**, **Stops** and **Closed dates** — and a sidebar headed **The journey** that lists the two ends, distance, journey time, tier, category, status and public URL, with the archive action underneath. Each panel saves on its own.",
    },
    { type: "heading", id: "checklist", text: "The publish checklist" },
    {
      type: "paragraph",
      text: "A banner at the top lists what the route still lacks before it can be sold: no prices, no title, or no summary. Only missing prices actually blocks **Publish route**; a route with fares but no title or summary can be published, and the banner keeps reminding you.",
    },
    { type: "heading", id: "fares", text: "Fares" },
    {
      type: "paragraph",
      text: "The grid has a row per vehicle class and two columns, **One way** and **Return**. Type amounts in lari; they are stored as whole tetri, rounded. Every class on the grid that has a one-way fare is sold on this route at that price. A class with no one-way fare is not on the grid at all: it falls back to the distance engine using the class's own per-kilometre rate and minimum.",
    },
    {
      type: "steps",
      items: [
        "Type the **One way** fare for each class you want to price by hand.",
        "Leave **Return** blank to charge twice one-way, or type a return fare of your own.",
        "Press **Save fares**. The whole grid is written at once.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Save fares** replaces the whole grid, not the cells you touched. Clearing a class's one-way fare removes that class from the route, and its price falls back to the distance engine without any further prompt. A blank return means twice one-way, not no return.",
    },
    {
      type: "paragraph",
      text: "Example: Economy one-way 80, return blank; Comfort one-way 120, return 200. A traveller sees Economy at 80 GEL each way and 160 GEL return, and Comfort at 120 GEL or 200 GEL return.",
    },
    { type: "heading", id: "details", text: "The route itself" },
    {
      type: "list",
      items: [
        "**Title** and **Summary** — the public name and the sentence under it.",
        "**Description** — one paragraph per line.",
        "**Hero image path** — the picture at the top of the public page.",
        "**Sales tier**, **Category** and **Show on the transfers landing page** — the same choices as when the route was created.",
        "**Distance (km)** and **Journey time (minutes)** — both must be positive whole numbers, or the save is refused with a message.",
        "The save button only wakes up once something has changed.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "There is no slug field here, deliberately: the slug is part of a URL that may already be indexed and linked, and changing it would turn that URL into a 404. There is also no translations screen — route copy is entered in English only.",
    },
    { type: "heading", id: "stops", text: "Stops" },
    {
      type: "paragraph",
      text: "Stops are the intermediate places a route calls at; the two ends are the route itself and are not listed here. Each stop has a name and a **Wait N min** dwell, thirty minutes when first added. The order of the list is the order of the journey — use the move up and move down buttons — and the list is written as a whole with **Save stops**. Routes with stops show a **via …** line in the register.",
    },
    { type: "heading", id: "closed-dates", text: "Closed dates" },
    {
      type: "paragraph",
      text: "A closed-dates window takes the route off sale between two dates without unpublishing it — a road closure, a festival, a season the journey does not run.",
    },
    {
      type: "steps",
      items: [
        "Set **Closed from** and **Closed until**. Both dates are inclusive: closing 1 to 3 January keeps all three days off sale.",
        "Add a **Reason** if it helps whoever reads the list later. It is optional.",
        "Press **Close these dates**.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Reopen** beside a window deletes it immediately. There is no confirmation, and the route is back on sale for those dates the moment you click.",
    },
    { type: "heading", id: "publish", text: "Publish and unpublish" },
    {
      type: "paragraph",
      text: "**Publish route** and **Unpublish route** sit beside **Save fares** and act with one click. Publishing is refused only while the route has no fares; the message names what is missing. Unpublishing keeps every fare, stop and closed date, so it is the right way to pause a journey you expect to sell again.",
    },
    { type: "heading", id: "archive", text: "Archive" },
    {
      type: "paragraph",
      text: "A route cannot be deleted, because bookings refer to it. **Archive** is the end of the product: press it, then confirm with **Archive this route** (or **Cancel**). The route leaves search and sale everywhere. An archived route offers **Restore as a draft**, which brings it back as `DRAFT` with its fares intact, ready to be published again.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "When the route is `ACTIVE` the panel suggests unpublishing it or adding a closed-dates window instead. Both are reversible with one click; archiving is not — restoring returns a draft you have to publish again.",
    },
    {
      type: "links",
      items: [
        { label: "How a transfer fare is computed", articleId: "tc-pricing-model" },
        { label: "Vehicle classes", articleId: "tc-vehicle-classes" },
        { label: "Routes register and the bulk pricer", articleId: "tc-routes-register" },
      ],
    },
  ],
} satisfies HelpArticle;
