import type { HelpArticle } from "../../types";

/**
 * Pick-up points: the register at `/admin/transfers/points`
 * (`transfers/points/page.tsx`, `TransferPointSearch.tsx`), the shared form
 * for `/new` and `/[id]` (`TransferPointForm.tsx` over
 * `components/geo/LocationField.tsx`), the detail sidebar and
 * `TransferPointDangerZone.tsx`. Encodes: no paging; retired rows dimmed but
 * listed; the slug read-only on edit; IATA only for airports; five time
 * zones; the position required and set by Google place search (which
 * prefills empty name, region and kind), refined on the map, or typed under
 * "Enter coordinates by hand"; the same place refused twice; coordinates
 * being the fare wherever a route has no curated price; "Routes named after
 * it" being a name search; retire (not delete) with routes staying on sale,
 * and Put back in service.
 */
export const article = {
  id: "tc-points",
  title: "Pick-up points",
  summary: "The places a transfer starts or ends — finding, adding, editing and retiring them, and why their coordinates matter to the fare.",
  category: "transfers-catalogue",
  routes: [
    { pattern: "/admin/transfers/points", section: "register" },
    { pattern: "/admin/transfers/points/new", section: "create" },
    { pattern: "/admin/transfers/points/[id]", section: "edit" },
  ],
  keywords: ["pickup", "pick-up point", "airport", "IATA", "coordinates", "latitude", "longitude", "map", "pin", "place search", "google", "already registered", "retire", "in service", "time zone", "region"],
  related: ["tc-route-create", "tc-pricing-model", "tc-routes-register", "tc-route-editing"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Pick-up points"] },
    {
      type: "paragraph",
      text: "A pick-up point is a named place with a pin on the map: an airport, a city, a resort, a hotel, a landmark or a station. Routes join two of them, and the distance between their pins is what prices any journey that has no curated fare of its own.",
    },
    { type: "heading", id: "register", text: "The register" },
    {
      type: "list",
      items: [
        "Three cards: **Points in service**, **Airports** and **Shown first** (the points ticked to appear at the top of the picker).",
        "**Search a place, a region or an airport code** filters the list as you type. There is no paging — the whole list is shown.",
        "Columns: Place (name, then `slug · IATA · shown first`), Kind, Region, Coordinates to four decimal places, Timezone and Status.",
        "Retired points stay in the list, dimmed, with a grey **Retired** pill beside the green **In service** of the others — so a place that has vanished from the public picker can still be found and put back.",
      ],
    },
    { type: "heading", id: "create", text: "Adding a point" },
    {
      type: "table",
      columns: ["Field", "What to enter"],
      rows: [
        ["Name", "The place as a traveller would say it. Required."],
        ["Slug", "The URL segment. Built from the name as you type; editable here, but not later."],
        ["Kind", "Airport, City, Resort, Hotel, Landmark or Station."],
        ["IATA code", "Three letters, airports only. The field is disabled for every other kind."],
        ["Region", "The region the place is in. Required."],
        ["Time zone", "One of five zones."],
        ["Show first in the picker", "Tick to list the point at the top of the public picker."],
        ["Where it is", "Required. Search for the place and choose it from the suggestions; the pin and the coordinates are set for you. Drag the pin to refine, or open **Enter coordinates by hand** to type a pair."],
      ],
    },
    {
      type: "steps",
      items: [
        "Search for the place under **Where it is** and pick it from the list. If **Name**, **Region** or **Kind** were still empty or at their default, they fill in from what Google knows — an airport becomes Airport, and the slug follows the name.",
        "Check the **Name** and **Slug**; reword the name if the traveller would say it differently.",
        "Confirm the **Kind**. For an airport, type the three-letter **IATA code**.",
        "Set the **Region** and **Time zone**.",
        "Drag the pin until it sits on the pick-up spot — the terminal forecourt, not the runway. If the map fails to load, or this site has no Google key, the coordinate fields under **Enter coordinates by hand** still work.",
        "Save. You land on the point's page.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "One place, one point",
      text: "If the place you chose is already a point in service, saving is refused with **That place is already registered as {slug}**. Open that point instead of making a second one: two points for one terminal would quote a journey of zero kilometres between them.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "A point's coordinates are the fare wherever a route through it has no curated price. A mistyped digit or a pin dragged to the wrong side of town silently reprices every unpriced journey through that point — check the pin before saving, on create and on every edit.",
    },
    { type: "heading", id: "edit", text: "Editing a point" },
    {
      type: "paragraph",
      text: "The point's page shows the same form, with one difference: the **Slug** is read-only, because it is already part of linked URLs. Changing the **Kind** away from Airport clears the IATA code. The sidebar, **At a glance**, lists the slug, kind, IATA, status, time zone, coordinates, whether it is shown first or found on search, and **Routes named after it** — a count that opens the routes register searched for the point's name.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "**Routes named after it** is a name search, not a list of routes that actually touch the point, so the count can be off in either direction.",
    },
    { type: "heading", id: "retire", text: "Retiring a point" },
    {
      type: "paragraph",
      text: "A point is never deleted, because routes refer to it. Retiring takes it out of the public picker and out of search: press the retire button, then confirm with **Retire {name}**. A retired point offers **Put back in service**, which reverses it in one click.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "Routes through a retired point stay on sale. If a journey should stop being sold, archive the route rather than retiring one end of it.",
    },
    {
      type: "links",
      items: [
        { label: "How a transfer fare is computed", articleId: "tc-pricing-model" },
        { label: "Adding a route", articleId: "tc-route-create" },
      ],
    },
  ],
} satisfies HelpArticle;
