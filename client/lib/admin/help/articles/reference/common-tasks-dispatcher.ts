import type { HelpArticle } from "../../types";

/**
 * A cookbook for dispatchers: the operational jobs on the dispatch board,
 * the schedule, the fleet and driver screens and the ratings queue.
 * Encodes the Assign dialog (candidates, car choice, "Confirmed by phone"),
 * Reassign and Unassign (the browser prompt), the no-show path and its
 * correction, the one backward move out of COMPLETED, schedule blocks and
 * the browser-timezone caveat, the 24-hour phone reveal, the fleet danger
 * zone, rating moderation and the `?page=` workaround on transfer bookings.
 */
export const article = {
  id: "rf-common-tasks-dispatcher",
  title: "Common tasks for dispatchers",
  summary: "Step-by-step recipes for the dispatch board, the schedule, the fleet and driver screens and the ratings queue.",
  category: "reference",
  keywords: ["how to", "recipe", "task", "cookbook", "steps", "assign", "reassign", "unassign", "no-show", "block", "phone", "rating"],
  related: ["gs-quick-start-dispatcher", "dp-assigning-a-driver", "dp-leg-statuses", "dp-schedule", "rf-dangerous-actions", "rf-troubleshooting"],
  blocks: [
    {
      type: "paragraph",
      text: "Each recipe names the screens and the buttons in the order you press them, and ends with the article that explains the screen in full. Everything here is open to a dispatcher's account as well as an administrator's.",
    },
    {
      type: "heading",
      id: "cover-an-unassigned-leg",
      text: "Cover an unassigned leg",
    },
    { type: "where", path: ["Sidebar", "Operations", "Dispatch"] },
    {
      type: "steps",
      items: [
        "On the dispatch board, set the status filter to **Needs a driver** — or click through from the **Need a driver** card — and find the leg. With the date filters empty the board shows every leg, so narrow by date on a busy day.",
        "Click **Assign**. The dialog lists every driver with an active car of the booked class, marked **Free at this time** or with the job or block that clashes, and says how many are free.",
        "Choose the driver, then a car — their usual one is pre-selected, a car too small for the party is greyed out — or **Decide later** to let the driver pick.",
        "Tick **Confirmed by phone — mark as accepted** only if you have actually spoken to the driver. Otherwise leave it: they accept in their own panel, and the leg shows as **Offered** until they do.",
        "Add a **Note for the driver** if there is one and click **Offer the job**. The driver is notified in their panel and by email.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Assigning a driver", articleId: "dp-assigning-a-driver" }],
    },
    {
      type: "heading",
      id: "reassign",
      text: "Reassign when a driver drops out",
    },
    {
      type: "steps",
      items: [
        "Find the leg on the board and click **Reassign** — the same dialog opens.",
        "Choose the new driver and car as above and click **Reassign**.",
        "The previous driver's offer is withdrawn and they are told by email and in their panel; the new driver is offered the job.",
      ],
    },
    {
      type: "heading",
      id: "unassign",
      text: "Take a driver off a leg",
    },
    {
      type: "steps",
      items: [
        "Click **Unassign** on the leg. The browser opens a plain prompt: **Why is the driver being taken off?**",
        "Type the reason and confirm. Closing the prompt or leaving it blank does nothing, and the panel does not say so.",
        "The leg returns to **Needs a driver** and the driver is told their assignment has been withdrawn.",
      ],
    },
    {
      type: "heading",
      id: "handle-a-no-show",
      text: "Handle a no-show",
    },
    {
      type: "steps",
      items: [
        "The leg must be **At the pick-up** (`ARRIVED`) first. If the driver has not marked it, choose **At the pick-up** in **Mark as…** yourself. Each choice in that menu fires at once, with no confirmation.",
        "Choose **No-show reported** (`NO_SHOW_REPORTED`). The passenger can still turn up at this point.",
        "Once it is settled, choose **No-show** (`NO_SHOW`). That is final; nothing can be done to the leg afterwards.",
        "If the passenger did turn up while the leg was still **No-show reported**, choose **At the pick-up** again — the one correction the machine allows — and carry on to **Passenger on board**.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Leg statuses", articleId: "dp-leg-statuses" }],
    },
    {
      type: "heading",
      id: "correct-completed",
      text: "Correct a leg marked completed by mistake",
    },
    {
      type: "steps",
      items: [
        "Open the leg's **Mark as…** menu. From **Completed**, the only option offered is **Passenger on board** — the one backward move out of a finished leg.",
        "Choose it. The leg is live again at `ON_BOARD`; from there the only way forward is **Completed** once more.",
        "Bear in mind the partner was told \"Transfer completed\" the first time, and will be told again.",
      ],
    },
    {
      type: "heading",
      id: "block-a-day",
      text: "Block a driver's day off or a car's service",
    },
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Schedule"] },
    {
      type: "steps",
      items: [
        "On the Schedule, pick the driver or the car from the resource list. Their diary for the next fourteen days appears.",
        "Under **Block time**, choose the reason (**Day off**, **Sick**, **Maintenance** or **Other**), set **From** and **To**, add a note, and click **Add block**. There is no confirmation.",
        "The server refuses a block that overlaps a job already assigned. Reassign the job first, then add the block.",
        "To lift a block, click the bin icon on its row under **Blocks in this window**. It is removed at once, without asking, and the driver or car is offerable again.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Times are read in your browser's clock",
      text: "The diary is shown in Tbilisi time, but the **From** and **To** you type are read in the time zone of the computer you are using. If you are working from another zone, the block lands at the wrong hour.",
    },
    {
      type: "links",
      items: [{ label: "The schedule", articleId: "dp-schedule" }],
    },
    {
      type: "heading",
      id: "find-a-drivers-phone",
      text: "Find a driver's phone number",
    },
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Drivers"] },
    {
      type: "steps",
      items: [
        "Open **Drivers**, search by name, phone or email, and click the driver.",
        "The number is under **At a glance** in the sidebar, and in the **How dispatch reaches them** section of the profile.",
        "The partner and the passenger are shown it only shortly before pick-up — within 24 hours — in the message that tells them the driver is assigned. Before that, it is yours alone.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The driver's page", articleId: "fd-driver-detail" }],
    },
    {
      type: "heading",
      id: "put-a-car-back-on-the-road",
      text: "Put a car back on the road",
    },
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Fleet"] },
    {
      type: "steps",
      items: [
        "Open **Fleet**, filter by **Off the road** if needed, and click the car.",
        "In the panel at the bottom of the page click **Put back on the road**. The car is on the candidate list again at once.",
        "**Take off the road** is the reverse and is also one click. An archived car can be restored the same way, provided no other car now carries its plate.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The car's page", articleId: "fd-car-detail" }],
    },
    {
      type: "heading",
      id: "publish-or-reject-a-rating",
      text: "Publish or reject a rating",
    },
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Ratings"] },
    {
      type: "steps",
      items: [
        "Open **Ratings**. The **Waiting for a look** tab lists comments that have not yet been shown anywhere.",
        "Read the comment and click **Publish** or **Reject**. Either acts at once, and either can be changed later from the **Published** or **Rejected** tab.",
        "A rejected rating's score is left out of the driver's average as well as its words.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Driver ratings", articleId: "dp-ratings" }],
    },
    {
      type: "heading",
      id: "page-two-of-transfer-bookings",
      text: "Reach page 2 of transfer bookings",
    },
    { type: "where", path: ["Sidebar", "Operations", "Transfer bookings"] },
    {
      type: "steps",
      items: [
        "The Transfer bookings register has no **Previous** or **Next** buttons; it only says `Page 1 of N` at the foot of the list.",
        "Add `?page=2` to the end of the address in the browser bar and press Enter. Change the number for any other page.",
        "For a particular booking, search the dispatch board by reference instead — every leg links to its booking.",
      ],
    },
    {
      type: "links",
      items: [{ label: "The transfer bookings register", articleId: "bk-transfer-bookings-register" }],
    },
  ],
} satisfies HelpArticle;
