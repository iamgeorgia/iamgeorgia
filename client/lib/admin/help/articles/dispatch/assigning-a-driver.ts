import type { HelpArticle } from "../../types";

/**
 * The assignment modal (`AssignDriverModal.tsx`, `lib/admin/dispatch.ts`,
 * `server/services/transfer/dispatch.service.js`). Encodes the job header,
 * the candidate rule (active car of the booked class), the free/conflict
 * lines and the 45-minute-before / 30-minute-after occupancy window, the
 * empty state and its remedy, the car list with "Too small for this party"
 * and "Decide later", the "Confirmed by phone" checkbox, the three
 * audited overrides under "This needs your say-so", the note, the footer,
 * and the hard refusals no override can pass.
 */
export const article = {
  id: "dp-assigning-a-driver",
  title: "Assigning or reassigning a driver",
  summary: "The assignment modal step by step: who is offered, what counts as a conflict, when a phone confirmation is safe to tick, and which refusals can and cannot be overridden.",
  category: "dispatch",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["assign", "reassign", "modal", "candidate", "free at this time", "conflict", "blocked", "confirmed by phone", "override", "say-so", "verified", "class", "usual car", "decide later", "offer the job"],
  related: ["dp-dispatch-board", "dp-leg-statuses", "dp-schedule", "dp-who-is-told-what", "fd-fleet-register", "fd-driver-detail", "fd-verification-documents"],
  blocks: [
    {
      type: "paragraph",
      text: "**Assign** and **Reassign** on the dispatch board — and on a transfer booking's Dispatch panel — open the same modal, titled **Assign {reference}** or **Reassign {reference}**. It opens fresh each time, so nothing from a previous job lingers.",
    },
    {
      type: "heading",
      id: "job",
      text: "The job header",
    },
    {
      type: "paragraph",
      text: "At the top: from and to, the pick-up time, the number of passengers and bags, and a chip with the vehicle class booked. Everything below is chosen against that class and that party.",
    },
    {
      type: "heading",
      id: "drivers",
      text: "Choosing a driver",
    },
    {
      type: "paragraph",
      text: "While the list loads it reads **Finding who is free…**. Only drivers with an active car of the booked class are offered; the header says **N of M free**. Each driver shows their photo or initial, name, **Verified** or **Not verified**, their provider, star average, number of completed transfers, how many cars of this class they have, and one of two lines:",
    },
    {
      type: "list",
      items: [
        "**Free at this time** with a green tick — nothing in their diary overlaps this job.",
        "The conflicts — **Blocked · 09:00–11:00** for a block, or **TRF-000123 · 08:15–10:00** for another job.",
      ],
    },
    {
      type: "paragraph",
      text: "A job occupies a driver from 45 minutes before pick-up to 30 minutes after drop-off. Anything in that window is a conflict, and the server refuses the assignment outright rather than asking for an override.",
    },
    {
      type: "callout",
      tone: "info",
      title: "When nobody is offered",
      text: "The empty state reads **No driver has a {class} car on the road.** Only drivers with an active car of the booked class are offered: link one under Fleet, or put a car back on the road, and reopen the modal.",
    },
    {
      type: "heading",
      id: "cars",
      text: "Choosing a car",
    },
    {
      type: "paragraph",
      text: "Once a driver is chosen their cars appear: make and model, plate, **Usual car** where it is the one they normally take, colour, year, seats and bags, and any conflicts. A car that cannot hold the party is disabled and reads **Too small for this party**. The last option, **Decide later**, leaves the car to the driver — the board then shows **No car yet**.",
    },
    {
      type: "heading",
      id: "accepted",
      text: "Confirmed by phone",
    },
    {
      type: "paragraph",
      text: "Ordinarily the driver receives the job as an offer and accepts it in their own panel; until then the leg reads **Offered**. Ticking **Confirmed by phone — mark as accepted** skips that step and the leg goes straight to **Accepted**.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Only tick it after the call",
      text: "With the box ticked the board shows the leg as covered and the partner is told a driver is assigned. If the driver was not actually reached, nobody is on the way and nothing will tell you.",
    },
    {
      type: "heading",
      id: "overrides",
      text: "This needs your say-so",
    },
    {
      type: "paragraph",
      text: "Some choices are refused the first time and come back with checkboxes under the heading **This needs your say-so**. Tick the one that applies and press the button again:",
    },
    {
      type: "list",
      items: [
        "**Driver not yet verified** — the driver's documents have not been checked.",
        "**Car is a different class from the one booked** — a downgrade or an upgrade on what the passenger paid for.",
        "**Car is not one the driver usually takes** — the car is not linked to this driver.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Asked once, recorded for good",
      text: "Each override is asked once and never again for that assignment, and every one used is written into the assignment's audit record with your name. Overriding a class mismatch quietly changes what the passenger gets; overriding verification puts an unchecked driver with a passenger.",
    },
    {
      type: "heading",
      id: "note-and-send",
      text: "The note, and sending",
    },
    {
      type: "steps",
      items: [
        "Optionally write a **Note for the driver** — a gate, a name to ask for, a flight to watch.",
        "Check the footer: **Sending to {name} in the {plate}**, or **, car to be decided** with **Decide later**.",
        "Press **Offer the job** — or **Reassign** on a leg that already had a driver. **Cancel** closes the modal with nothing changed.",
      ],
    },
    {
      type: "paragraph",
      text: "The driver is told in-app and by email that a transfer has been offered to them. With **Confirmed by phone** ticked, operations and the partner are told the driver is assigned instead; the partner's email carries the driver's phone number only when pick-up is within 24 hours. On a reassignment the previous driver is emailed that the job has been withdrawn.",
    },
    {
      type: "heading",
      id: "hard-refusals",
      text: "Refusals no override can pass",
    },
    {
      type: "list",
      items: [
        "The booking is not `CONFIRMED`.",
        "The driver has been deactivated.",
        "The car is not active.",
        "The car cannot hold the party.",
        "The driver or car has a conflicting block or job in the occupancy window.",
      ],
    },
    {
      type: "links",
      items: [
        { label: "The dispatch board", articleId: "dp-dispatch-board" },
        { label: "Schedule: diaries and blocks", articleId: "dp-schedule" },
        { label: "Who is told what", articleId: "dp-who-is-told-what" },
      ],
    },
  ],
} satisfies HelpArticle;
