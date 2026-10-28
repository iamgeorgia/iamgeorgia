import type { HelpArticle } from "../../types";

/**
 * The dispatch board at `/admin/transfers/dispatch` (`(panel)/transfers/dispatch/page.tsx`,
 * `DispatchBoard.tsx`, `LegActions.tsx`, `lib/admin/dispatch.ts`). Encodes
 * the three tiles, the filters with no default window and a page size of
 * 50, the table columns, and the four per-leg actions and their guards:
 * Assign/Reassign through the modal; Mark as… applying on selection with no
 * confirmation and notifying the partner for ARRIVED/ON_BOARD/COMPLETED;
 * Unassign through a browser prompt that aborts silently; Cancel leg through
 * a browser confirm with the fixed reason "Cancelled by operations".
 */
export const article = {
  id: "dp-dispatch-board",
  title: "The dispatch board",
  summary: "Every leg, who is on it and what happens next — the filters, the table, and the four actions on a leg with what each one sends.",
  category: "dispatch",
  routes: ["/admin/transfers/dispatch"],
  keywords: ["dispatch", "leg", "assign", "reassign", "unassign", "mark as", "cancel leg", "driver", "needs a driver", "flight", "board"],
  related: ["dp-assigning-a-driver", "dp-leg-statuses", "dp-who-is-told-what", "bk-transfer-booking-detail", "dp-schedule", "gs-quick-start-dispatcher"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Dispatch"] },
    {
      type: "paragraph",
      text: "The board lists legs, not bookings: a one-way journey is one leg, a journey with a return is two, and each gets its own driver, car and status. This is where a driver is put on a leg and where the leg is moved through its day. For a dispatcher it is the landing screen.",
    },
    {
      type: "heading",
      id: "tiles",
      text: "The three tiles",
    },
    {
      type: "table",
      columns: ["Tile", "What it counts"],
      rows: [
        ["Legs", "Every leg on the board — labelled **Legs in window** once a date filter is set."],
        ["Need a driver", "Legs in `UNASSIGNED`."],
        ["Waiting for an answer", "Legs in `ASSIGNED` — **Offered, not yet accepted**."],
      ],
    },
    {
      type: "heading",
      id: "filters",
      text: "Narrowing the board",
    },
    {
      type: "steps",
      items: [
        "Type in the search box to match a booking reference or a passenger name.",
        "Set **From** and **To** to keep only legs picking up between the two dates.",
        "Choose a status from the select — **Every status**, or one of the ten leg states.",
        "Page with **Previous** and **Next**; the line **1–50 of N** shows where you are. The page size is 50.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "There is no default date window",
      text: "The board opens showing every leg there is, past and future, until you narrow it. On a busy account set **From** to today before reading the tiles, or they count history as well.",
    },
    {
      type: "heading",
      id: "columns",
      text: "What each row shows",
    },
    {
      type: "list",
      items: [
        "**Pick-up** — the time in the pick-up point's own time zone, with a flight-number line beneath it when one was given.",
        "**Journey** — from and to, linked to the booking; underneath, the reference, **return** for a return leg, the lead passenger and the partner.",
        "**Party** — passengers and bags.",
        "**Status** — the leg's badge.",
        "**Driver** — the driver (linked) and their car as make, model and plate, or **No car yet** when the driver is to choose one.",
        "**Actions** — the controls below.",
      ],
    },
    {
      type: "paragraph",
      text: "An empty board reads **Nothing to dispatch in this window.**",
    },
    {
      type: "heading",
      id: "assign",
      text: "Assign or reassign",
    },
    {
      type: "paragraph",
      text: "**Assign** appears on a leg with no driver; **Reassign** on one that has. Both open the assignment modal, where you choose a driver, a car and whether the job is already accepted. Reassigning withdraws the previous driver's offer. The modal is described step by step in its own article.",
    },
    {
      type: "heading",
      id: "mark-as",
      text: "Mark as…",
    },
    {
      type: "paragraph",
      text: "The **Mark as…** select moves a leg through its day: on the way, at the pick-up, passenger on board, completed, no-show reported, and so on. It offers only the moves the server allows from the leg's current status, so an illegal move can never be chosen.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Applies the moment you choose",
      text: "Choosing an option in **Mark as…** changes the leg at once — there is no confirmation. Marking a leg `ARRIVED`, `ON_BOARD` or `COMPLETED` also notifies the partner. A slip on the select is a live change; the only way back is a backward move the machine permits.",
    },
    {
      type: "heading",
      id: "unassign",
      text: "Unassign",
    },
    {
      type: "steps",
      items: [
        "Press **Unassign** on a leg that holds a driver and may still go back to `UNASSIGNED`.",
        "The browser opens a plain prompt reading **Why is the driver being taken off?** Type the reason and press OK.",
        "The leg returns to **Needs a driver**. The driver is told in-app and by email that the job has been withdrawn.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      text: "The prompt is the browser's own, not a panel dialog. Pressing Cancel in it, or leaving it blank, does nothing — the leg is untouched and no message appears.",
    },
    {
      type: "heading",
      id: "cancel-leg",
      text: "Cancel leg",
    },
    {
      type: "steps",
      items: [
        "Press **Cancel leg**. The browser asks **Cancel this leg only? The booking stays until every leg is done.**",
        "Press OK. The leg becomes `CANCELLED` and any driver on it is told the job has been withdrawn.",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "A cancelled leg is terminal — nothing can move it again. The reason recorded is always **Cancelled by operations**; there is nowhere to write your own. Only this leg is cancelled: a return leg on the same booking stays as it was.",
    },
    {
      type: "links",
      items: [
        { label: "Assigning or reassigning a driver", articleId: "dp-assigning-a-driver" },
        { label: "Leg statuses and where they can go", articleId: "dp-leg-statuses" },
        { label: "Who is told what", articleId: "dp-who-is-told-what" },
      ],
    },
  ],
} satisfies HelpArticle;
