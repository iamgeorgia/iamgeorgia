import type { HelpArticle } from "../../types";

/**
 * The do-not list: every action that commits or cannot be undone, with
 * whether it asks first, whether it can be reversed and who is told.
 * Encodes the three confirmation idioms (native `confirm` / `prompt`,
 * two-step inline, typed confirmation), the unguarded controls (Mark as…,
 * Confirm on a part or a requirement, package Archive and Delete, Remove
 * block, Reopen closed dates, the channel and B2C switches, Bulk pricer with
 * Overwrite), the terminal archives, and the outbox topics behind each.
 */
export const article = {
  id: "rf-dangerous-actions",
  title: "Dangerous actions — the do-not list",
  summary: "Every button that acts the moment it is clicked, every action that cannot be undone, and who is told when you use it.",
  category: "reference",
  keywords: ["dangerous", "irreversible", "undo", "confirm", "delete", "archive", "cancel", "permanent", "warning", "careful", "mistake"],
  related: ["rf-troubleshooting", "rf-common-tasks-dispatcher", "dp-who-is-told-what", "dp-assigning-a-driver"],
  blocks: [
    {
      type: "paragraph",
      text: "Some buttons in the panel act the moment they are clicked, with no dialog in between. Some actions cannot be undone, whether or not they asked first. Some send an email to a guest, a driver or a partner as a side effect. This is the whole list. Read it once; the columns tell you what to check before your finger moves.",
    },
    {
      type: "table",
      columns: ["Action", "Screen", "Asks first?", "Can it be undone?", "Who is told"],
      rows: [
        ["**Cancel booking**", "Hotel booking", "Inline two-step: **Cancel booking**, then **Confirm cancellation**", "No", "Guest and property"],
        ["**Confirm** a requirement", "Hotel booking", "No", "No — the row offers no buttons afterwards", "—"],
        ["**Confirm** a part", "Order", "No", "No", "—"],
        ["**Decline** a required part", "Order", "Modal with a required reason", "No — it cancels the whole order and releases every part", "Buyer and partner, with your reason word for word"],
        ["**Cancel order**", "Order", "Inline two-step", "No", "Buyer"],
        ["**Confirm request**", "Tour booking", "No", "No", "Traveller — the voucher is sent"],
        ["**Decline**", "Tour booking", "Inline, with a required reason", "No — the seats are released", "Traveller or agency, with your reason word for word"],
        ["**Cancel booking**", "Tour booking", "Inline two-step", "No", "Traveller and operator"],
        ["**Mark as…**", "Dispatch, transfer booking", "No — choosing an option fires at once", "Only where the leg machine allows a backward move", "Partner, for arrived, on board and completed"],
        ["**Cancel leg**", "Dispatch, transfer booking", "Browser confirm", "No", "Driver, through the withdrawn assignment"],
        ["**Unassign**", "Dispatch, transfer booking", "Browser prompt for a reason", "The leg can be assigned again", "Driver"],
        ["**Confirmed by phone — mark as accepted**", "Assign dialog", "No", "—", "Partner is told the driver is assigned"],
        ["**Remove block**", "Schedule", "No", "Add it again", "—"],
        ["**Reopen** closed dates", "Route", "No", "Close them again", "—"],
        ["**Reprice in bulk** with **Overwrite fares that are already set**", "Routes", "No", "No", "—"],
        ["**Save fares**", "Route", "No", "The grid is replaced; re-enter what was there", "—"],
        ["Moving a pick-up point's pin", "Pick-up point", "No", "Move it back", "— (every unpriced route through it is repriced)"],
        ["**Public** / **Trade only** switch", "Vehicle classes", "No — it flips from the list row", "Flip it back", "—"],
        ["**Retire**", "Extras", "No", "**Offer it again**", "—"],
        ["**Archive**", "Hotel, tour, service", "Browser confirm", "No — permanent", "—"],
        ["**Archive**", "Package", "No", "No — permanent", "—"],
        ["**Delete**", "Package (draft only)", "No", "No", "—"],
        ["**Delete**", "Hotel, tour", "Browser confirm", "No — images go with it", "—"],
        ["**Delete**", "Destination, service", "Inline two-step", "No", "—"],
        ["**Delete car** / **Delete driver**", "Fleet car, driver (administrators only)", "Type the plate or the surname", "No — takes photographs, documents and the driver's login with it", "—"],
        ["**Deactivate driver** with **Send any upcoming jobs back to dispatch**", "Driver", "A reason is required", "The driver can be reactivated, but the withdrawn assignments stay withdrawn", "Driver, for each withdrawn job"],
        ["**Approve**", "Partner", "No", "Suspend later", "Partner is emailed"],
        ["**Suspend**", "Partner", "A reason is required", "**Reinstate partner**", "Nobody is emailed; every open session ends"],
        ["**Delete partner**", "Partner", "Type the Partner ID", "No — the Partner ID is never reissued", "—"],
        ["**Public sale (B2C)** and **Featured** switches", "Hotel, tour, package, service", "No", "Flip it back", "—"],
        ["Changing a service's slug", "Service", "No", "Change it back — but shared links to the old address are already broken", "—"],
        ["Moving a destination's parent", "Destination", "No", "Move it back — every descendant is refiled each time", "—"],
        ["Editing a verified kosher certificate", "Hotel kosher", "The form warns", "Verify it again", "—"],
      ],
    },
    {
      type: "heading",
      id: "before-you-cancel",
      text: "Before you cancel anything",
    },
    {
      type: "list",
      items: [
        "Read the quote the screen shows first — **Cancelling now costs** and **Refund to guest** (or **to the buyer**, **to traveller**). It is read off the terms frozen when the booking was made, and it is what the customer will be charged.",
        "Read the reason box's label. **Reason (optional, kept internally)** is never shown to the customer. **Why it cannot run** and **Why it cannot be done** are sent to the buyer or agency word for word, and the button stays disabled until you have written something.",
        "On an order, look at whether the part is required before you decline it. The modal tells you which outcome applies: declining a required part cancels the whole order.",
        "A cancellation emails the customer and the supplier from the outbox a few seconds after the screen says it is done. There is no un-cancel.",
      ],
    },
    {
      type: "heading",
      id: "prefer-reversible",
      text: "Prefer the reversible action",
    },
    {
      type: "list",
      items: [
        "**Take off sale**, not **Archive**, when a hotel, tour, package or service should stop selling for a while. Off sale keeps everything and publishes again in one click; archiving is final.",
        "Closed dates, not **Archive**, when a route should stop selling for a season. A route can also be unpublished and published again with its fares intact.",
        "**Retire** a pick-up point only when the place itself is gone. Routes through a retired point stay on sale; to stop a journey being sold, archive the route.",
        "**Trade only**, not **Archive**, when a vehicle class should leave the public site. Archiving takes it out of search everywhere and closes the public channel; it comes back trade-only.",
        "**Suspend**, not **Delete partner**. Suspending ends their access straight away and can be reversed; deleting removes the company, its accounts, its bank details and its invitations, and the Partner ID is never reissued.",
        "**Deactivate**, not **Delete driver**; **Take off the road** or **Archive**, not **Delete car**. Deleting is only possible before the first job and takes the files with it.",
      ],
    },
    {
      type: "heading",
      id: "two-browser-dialogs",
      text: "Two browser dialogs",
    },
    {
      type: "paragraph",
      text: "Two controls on the dispatch board use the browser's own plain dialogs rather than the panel's. **Unassign** opens a prompt asking **Why is the driver being taken off?** — type a reason and confirm; closing the prompt or leaving it blank does nothing, silently. **Cancel leg** opens a confirm reading **Cancel this leg only? The booking stays until every leg is done.** — it records the fixed reason \"Cancelled by operations\", and it cannot be undone. Read both before you click through them.",
    },
  ],
} satisfies HelpArticle;
