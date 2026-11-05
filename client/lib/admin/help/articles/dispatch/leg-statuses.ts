import type { HelpArticle } from "../../types";

/**
 * The ten TransferLegStatus values with their board labels
 * (`lib/admin/dispatch.ts`) and the moves the machine allows from each
 * (`server/lib/transfer/machines.js`), in words; the closed door once the
 * passenger is on board; the two backward moves that serve as corrections;
 * and the six assignment statuses with their labels.
 */
export const article = {
  id: "dp-leg-statuses",
  title: "Leg statuses and where they can go",
  summary: "The ten states a leg passes through, the label each wears on the board, which moves are allowed from each, and the two backward moves that undo a mistake.",
  category: "dispatch",
  keywords: ["status", "leg", "UNASSIGNED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "ON_BOARD", "COMPLETED", "NO_SHOW", "NO_SHOW_REPORTED", "CANCELLED", "transition", "correction", "withdrawn"],
  related: ["dp-dispatch-board", "dp-assigning-a-driver", "bk-statuses-glossary", "bk-transfer-booking-detail"],
  blocks: [
    {
      type: "paragraph",
      text: "A leg has ten possible statuses. The board shows each under a plain label; the code value appears in filters and in this manual. The **Mark as…** select on the board offers only the moves allowed from the leg's current status, so the tables below are what you will see, not a wish list.",
    },
    {
      type: "heading",
      id: "labels",
      text: "The ten statuses",
    },
    {
      type: "table",
      columns: ["Status", "Board label", "Meaning"],
      rows: [
        ["`UNASSIGNED`", "Needs a driver", "Nobody is on it yet."],
        ["`ASSIGNED`", "Offered", "A driver has been offered the job and has not yet answered."],
        ["`ACCEPTED`", "Accepted", "The driver has taken the job — or operations accepted it for them by phone."],
        ["`EN_ROUTE`", "On the way", "The driver is heading to the pick-up."],
        ["`ARRIVED`", "At the pick-up", "The driver is at the pick-up point."],
        ["`ON_BOARD`", "Passenger on board", "The passenger is in the car."],
        ["`COMPLETED`", "Completed", "The passenger was dropped off."],
        ["`NO_SHOW_REPORTED`", "No-show reported", "The driver reports the passenger did not appear; operations has yet to confirm."],
        ["`NO_SHOW`", "No-show", "Confirmed: the passenger never appeared."],
        ["`CANCELLED`", "Cancelled", "The leg will not run."],
      ],
    },
    {
      type: "heading",
      id: "moves",
      text: "Where each status can go",
    },
    {
      type: "table",
      columns: ["From", "Allowed moves"],
      rows: [
        ["Needs a driver", "Offered or Accepted (by assigning); Cancelled."],
        ["Offered", "Accepted; back to Needs a driver (unassign); Cancelled."],
        ["Accepted", "On the way, At the pick-up, Passenger on board or Completed; back to Needs a driver; Cancelled."],
        ["On the way", "At the pick-up, Passenger on board or Completed; back to Needs a driver; Cancelled."],
        ["At the pick-up", "Passenger on board, Completed or No-show reported; back to Needs a driver; Cancelled."],
        ["Passenger on board", "Completed only."],
        ["No-show reported", "No-show; or back to At the pick-up."],
        ["Completed", "Back to Passenger on board only."],
        ["No-show", "Nothing — terminal."],
        ["Cancelled", "Nothing — terminal."],
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Once the passenger is on board, cancellation is closed",
      text: "From **Passenger on board** the only move is **Completed**. A leg cannot be cancelled or unassigned with someone in the car.",
    },
    {
      type: "heading",
      id: "corrections",
      text: "The two backward moves",
    },
    {
      type: "paragraph",
      text: "Most moves go forward. Two go back, and they exist to correct a slip on the **Mark as…** select:",
    },
    {
      type: "list",
      items: [
        "**Completed → Passenger on board** — the one way out of a terminal state. Use it when a leg was marked completed too early; from there it can be completed again once the drop-off has happened.",
        "**No-show reported → At the pick-up** — for when the passenger turned up after all. From there the leg carries on as normal.",
      ],
    },
    {
      type: "paragraph",
      text: "There is no way back from **No-show** or **Cancelled**.",
    },
    {
      type: "heading",
      id: "assignments",
      text: "Assignment statuses",
    },
    {
      type: "paragraph",
      text: "Beside the leg's status, each offer to a driver has a status of its own, shown against the driver on the board and in the diary:",
    },
    {
      type: "definitions",
      items: [
        { term: "Offered", description: "Sent to the driver, not yet answered. Occupies the driver's time." },
        { term: "Accepted", description: "The driver has the job. Occupies the driver's time." },
        { term: "Declined", description: "The driver turned it down." },
        { term: "Withdrawn", description: "Operations took the driver off — an unassign, a reassignment or a cancellation." },
        { term: "Completed", description: "The driver finished the job." },
        { term: "No-show", description: "The job ended as a no-show." },
      ],
    },
    {
      type: "paragraph",
      text: "Only **Offered** and **Accepted** count as busy time when the assignment modal looks for conflicts.",
    },
    {
      type: "links",
      items: [
        { label: "The dispatch board", articleId: "dp-dispatch-board" },
        { label: "Booking and order statuses", articleId: "bk-statuses-glossary" },
      ],
    },
  ],
} satisfies HelpArticle;
