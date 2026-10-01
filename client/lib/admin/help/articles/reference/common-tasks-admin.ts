import type { HelpArticle } from "../../types";

/**
 * A cookbook for administrators: the dozen tasks that come up most, each as
 * a short numbered recipe naming the screens and buttons, and the article
 * that explains it. Encodes the hub → Publishing panel → checklist flow,
 * Take off sale versus Archive, the order-part Confirm/Decline asymmetry,
 * the frozen cancellation quote, the fare grid and the bulk pricer's
 * Overwrite box, the partner → class → car → driver → link → verify →
 * login chain, the copyable activation link, the partner review buttons,
 * route closed dates, the translation tabs and the B2C switch.
 */
export const article = {
  id: "rf-common-tasks-admin",
  title: "Common tasks for administrators",
  summary: "Step-by-step recipes for the jobs an administrator does most — from putting a hotel on sale to onboarding a transport supplier.",
  category: "reference",
  roles: ["ADMIN"],
  keywords: ["how to", "recipe", "task", "cookbook", "steps", "publish", "cancel", "reprice", "onboard", "approve", "translate"],
  related: ["gs-quick-start-admin", "rf-common-tasks-dispatcher", "rf-dangerous-actions", "rf-troubleshooting"],
  blocks: [
    {
      type: "paragraph",
      text: "Each recipe names the screens and the buttons in the order you press them, and ends with the article that explains the screen in full. The steps assume you are signed in as an administrator.",
    },
    {
      type: "heading",
      id: "put-a-hotel-on-sale",
      text: "Put a hotel on sale",
    },
    {
      type: "steps",
      items: [
        "Open **Inventory → Hotels** and click the property. Its hub opens, with a **Publishing** panel in the sidebar listing what is still missing.",
        "Work through the tiles the list points at: **Rooms & rates** (at least one active room with an active rate plan), **Inventory & pricing**, **Images** (at least one, with a cover), **Details & policies** (descriptions, policies, check-in and check-out times, an amenity) and **Location** (address and a pin).",
        "If the kosher level is `PARTIAL` or `FULL`, add and verify a whole-property or kitchen certificate under **Kosher**.",
        "Back on the hub, when the Publishing list is empty, **Publish** is enabled. Click it.",
        "Decide separately whether to switch on **Public sale (B2C)**. Publishing alone sells to the trade only.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Getting a hotel on sale — the checklist", articleId: "ht-publish-checklist" }],
    },
    {
      type: "heading",
      id: "take-a-hotel-off-sale",
      text: "Take a hotel off sale without losing anything",
    },
    {
      type: "steps",
      items: [
        "Open the hotel's hub from **Inventory → Hotels**.",
        "In the **Publishing** panel click **Take off sale**. It acts at once and reports \"Taken off sale. Existing bookings are unaffected.\"",
        "The hotel is now `Off sale`: still editable, invisible to buyers, and **Publish** brings it back whenever you like.",
        "Do not use **Archive** for this. Archiving is permanent and the hotel can never be edited or sold again.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The hotel hub", articleId: "ht-hub" }, { label: "Draft, on sale, off sale, archived", articleId: "pb-statuses" }],
    },
    {
      type: "heading",
      id: "answer-an-order-part",
      text: "Answer an on-request order part",
    },
    {
      type: "steps",
      items: [
        "Open **Operations → Orders**. The **On request** chip shows how many are waiting; click it to list them. A row whose deadline has passed is tinted red with an \"overdue\" line.",
        "Open the order. Each part still waiting shows **Confirm** and **Decline** on its row, and the page says when the answer is due.",
        "**Confirm** commits the part at once — there is no dialog.",
        "**Decline** opens a dialog that first tells you the consequence: for a required part, the whole order is cancelled at no charge; for an optional one, only that part is dropped. Write **Why it cannot run** — the buyer and the agency read it word for word — then confirm.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The order detail screen", articleId: "bk-order-detail" }],
    },
    {
      type: "heading",
      id: "cancel-a-hotel-booking",
      text: "Cancel a hotel booking and know what the guest is charged",
    },
    {
      type: "steps",
      items: [
        "Open **Operations → Hotel bookings** and find the booking by reference, guest name or email.",
        "Read the **Cancellation terms** panel and, in the **Actions** panel, the live quote: **Cancelling now costs** and **Refund to guest**. Both come from the terms frozen at booking; a later change to the hotel's policy does not apply.",
        "On a booking with more than one room, the terms panel shows the first room's windows only. Check each room's **Free cancellation until** line before quoting.",
        "Click **Cancel booking**, add a reason if you want one on file (it is internal — the guest never sees it), then **Confirm cancellation**.",
        "The result line states the charge. The rooms go back on sale, and the guest and the property are emailed. There is no undo.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The hotel booking detail screen", articleId: "bk-hotel-booking-detail" }],
    },
    {
      type: "heading",
      id: "reprice-a-route",
      text: "Reprice a transfer route — one, or many at once",
    },
    {
      type: "steps",
      items: [
        "For one route: open **Inventory → Transfers → Routes**, click the route, and use the **Fares** panel. Type the fare in lari for each vehicle class, one-way and return.",
        "A blank one-way fare removes that class from the route, so it falls back to the distance engine; a blank return means twice the one-way fare.",
        "Click **Save fares**. The whole grid is replaced by what is on screen.",
        "For many routes: on the Routes register click **Reprice in bulk**. Choose a tier or a category (there is no \"everything\"), at least one vehicle class, **Per kilometre** or **Flat fare**, the amount, and optionally a floor.",
        "Leave **Overwrite fares that are already set** unticked to fill only the gaps. Run it; the panel reports how many fares it wrote and how many it left alone.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Overwrite replaces hand-set fares",
      text: "With **Overwrite fares that are already set** ticked, every curated fare on every matching route is replaced with the formula's figure, with no confirmation and no undo. Tick it only when that is exactly what you mean.",
    },
    {
      type: "links",
      items: [{ label: "Editing a route", articleId: "tc-route-editing" }, { label: "How transfers are priced", articleId: "tc-pricing-model" }],
    },
    {
      type: "heading",
      id: "onboard-a-transport-supplier",
      text: "Onboard a transport supplier end to end",
    },
    {
      type: "steps",
      items: [
        "**Network → Partners → Add a partner**: register the company with type Transport and approve it — either at once with **Create and approve at once**, or after they have completed a registration link.",
        "**Inventory → Transfers → Vehicle classes → new**: create the class the supplier sells (its class, body, whether it is sold private or per seat, and the supplier are fixed at creation). The form refuses to open until a supplier exists.",
        "**Transfers → Fleet → Add car**: the car belongs to the supplier and is sold as the class. Leave **Available to dispatch straight away** ticked for it to be on the road at once.",
        "**Transfers → Drivers → Add driver**: name, phone, languages, and **Works for** the supplier. No login is created here.",
        "On the driver's page, under **Cars**, tick the car, choose it as **Primary**, and **Save cars**. Under **Verification**, set **Verified** with a note of what was checked and click **Record**.",
        "Under **Login**, enter the login email and click **Create login and send the link**. The driver is now on the dispatch board's candidate list for that class.",
      ],
    },
    {
      type: "links",
      items: [
        { label: "Registering a partner", articleId: "pt-registering" },
        { label: "Vehicle classes", articleId: "tc-vehicle-classes" },
        { label: "Adding a car", articleId: "fd-add-car" },
        { label: "Adding a driver", articleId: "fd-add-driver" },
      ],
    },
    {
      type: "heading",
      id: "driver-login-link",
      text: "Issue or re-send a driver's login link",
    },
    {
      type: "steps",
      items: [
        "Open **Inventory → Transfers → Drivers** and click the driver. The **Login** panel is in the sidebar.",
        "With no account yet: check the **Login email** (it is prefilled from the contact email but is a separate thing) and click **Create login and send the link**.",
        "With an account waiting for a password: click **Send a new activation link**. Every new link stops the previous one working.",
        "The link is shown on screen under **Password link** with a **Copy link** button. If the panel says the link could not be emailed, copy it and send it yourself — the account exists either way.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The driver's page", articleId: "fd-driver-detail" }],
    },
    {
      type: "heading",
      id: "approve-or-reject-a-partner",
      text: "Approve or reject a partner application",
    },
    {
      type: "steps",
      items: [
        "Open **Network → Applications**. **Awaiting your decision** are complete; **Still being filled in** have opened their link but not finished.",
        "Open the application and read the **Completeness** note: approval needs the legal entity, registration number, address, country, phone and email.",
        "**Approve** acts on one click with no confirmation, emails the partner, and gives them full access straight away.",
        "**Reject** asks for a **Reason, shown to the partner** (they are emailed it) and an optional **Internal note, never sent**, then **Confirm rejection**. A rejected partner can later be reinstated.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Reviewing a partner", articleId: "pt-detail-review" }, { label: "The applications queue", articleId: "pt-applications" }],
    },
    {
      type: "heading",
      id: "close-a-route-for-a-season",
      text: "Close a mountain route for a season",
    },
    {
      type: "steps",
      items: [
        "Open the route from **Inventory → Transfers → Routes** and scroll to **Closed dates**.",
        "Enter **Closed from** and **Closed until** — both days inclusive — and a reason if you want one, then click **Close these dates**. The route leaves search for those dates and returns by itself afterwards.",
        "To open it early, click **Reopen** on the row. It acts at once, with no confirmation.",
        "Do not archive the route for this. Archiving ends the product; a closed window is a calendar entry.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Editing a route", articleId: "tc-route-editing" }],
    },
    {
      type: "heading",
      id: "why-publish-is-disabled",
      text: "Find why Publish is disabled",
    },
    {
      type: "steps",
      items: [
        "Open the hub of the hotel, tour, package or service. The **Publishing** panel lists every item still missing; **Publish** stays disabled until that list is empty.",
        "Each item names a tile: open it, fill in what is asked, and come back. The list is recomputed every time the hub loads.",
        "For a transfer route, the checklist is a banner at the top of the route page. Only missing fares block publishing; a missing title or summary is listed but does not.",
        "If a publish is refused anyway, the message \"Not ready to publish: …\" lists what changed since the page loaded.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Publish checklists", articleId: "pb-checklists" }],
    },
    {
      type: "heading",
      id: "translate-a-tour",
      text: "Translate a tour",
    },
    {
      type: "steps",
      items: [
        "Open the tour from **Inventory → Tours** and click the **Translations** tile.",
        "Pick a language tab — Georgian, Russian or Hebrew. English is the base and cannot be translated into.",
        "Each field shows the English text as its placeholder. Fill in the title, region, length, group size, meeting point, summary, description and the four lists; a field left blank shows the English on the public page.",
        "Click the save button for that language, then repeat for the next tab. Each language saves separately.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Translations", articleId: "pb-translations" }, { label: "The tour hub", articleId: "tr-hub" }],
    },
    {
      type: "heading",
      id: "sell-a-package-to-the-public",
      text: "Make a package sell to the public",
    },
    {
      type: "steps",
      items: [
        "Open the package from **Inventory → Packages**. Clear the Publishing checklist: a summary, at least one required part under **Parts**, a cover (an editorial image or an uploaded one), and a value on any adjustment.",
        "Check the **Kosher eligibility** panel if the package is sold as kosher; a blocker there stops it selling as kosher.",
        "Click **Publish**. The package is now on sale to the trade.",
        "Switch on **Sell to the public**. It acts the moment it is clicked. **Feature** on its own does nothing until the package is published.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The package checklist", articleId: "pk-publish-checklist" }, { label: "Public sale and the trade", articleId: "pb-b2c-vs-trade" }],
    },
  ],
} satisfies HelpArticle;
