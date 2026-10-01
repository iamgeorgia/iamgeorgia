import type { HelpArticle } from "../../types";

/**
 * The schedule at `/admin/transfers/schedule` (`(panel)/transfers/schedule/page.tsx`,
 * `ScheduleView.tsx`). Encodes the Drivers/Cars picker, the 14-day default
 * window, the day-grouped diary with "Blocked · reason" and job entries,
 * the Block time form and its refusal while a job sits inside, the
 * one-click Remove block, and the time-zone mismatch: the diary renders in
 * Asia/Tbilisi while From/To are read in the browser's own zone.
 */
export const article = {
  id: "dp-schedule",
  title: "Schedule: diaries and blocks",
  summary: "One driver's or one car's diary — jobs and blocks — and how to block time off for a day off, sickness or maintenance.",
  category: "dispatch",
  roles: ["ADMIN", "DISPATCHER"],
  routes: ["/admin/transfers/schedule"],
  keywords: ["schedule", "diary", "block", "day off", "sick", "maintenance", "busy", "availability", "time zone", "Tbilisi", "remove block"],
  related: ["dp-assigning-a-driver", "dp-dispatch-board", "fd-drivers-register", "fd-fleet-register", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Schedule"] },
    {
      type: "paragraph",
      text: "The schedule shows who is busy when, for one driver or one car at a time. It reads the same occupancy the assignment modal checks, so what appears here is exactly what dispatch will refuse to double-book. It is also where time is blocked off — a day off, a service — so a resource is not offered.",
    },
    {
      type: "heading",
      id: "reading",
      text: "Reading a diary",
    },
    {
      type: "steps",
      items: [
        "Choose a resource from the picker. It lists **Drivers** (active ones) and **Cars** (active and inactive). Choosing a driver clears any car, and the other way round.",
        "Set **From** and **To**. The window defaults to today plus fourteen days.",
        "Read the diary, grouped by day. Each entry shows its time range and either **Blocked · {reason}** in grey or **{reference} · {passenger} · {status}** for a job.",
      ],
    },
    {
      type: "paragraph",
      text: "Before a resource is chosen the screen reads **Choose a driver or a car to see their diary.**; a quiet window reads **Nothing in this window.**",
    },
    {
      type: "heading",
      id: "add-block",
      text: "Blocking time",
    },
    {
      type: "steps",
      items: [
        "With a resource chosen, go to the **Block time** panel.",
        "Pick a **Reason**: **Day off**, **Sick**, **Maintenance** or **Other**.",
        "Set **From** and **To** as date and time. **Add block** stays disabled until both are set.",
        "Optionally add a **Note**, then press **Add block**. The block appears in the diary at once and the resource is no longer offered for anything inside it.",
      ],
    },
    {
      type: "paragraph",
      text: "A block is refused while a job already sits inside it. Move or reassign the job first, then block the time.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "The diary is in Tbilisi time; the form is in yours",
      text: "The diary is displayed in Asia/Tbilisi time, but **From** and **To** are read in your browser's own time zone. Working from a computer set to another zone, a block typed as 09:00 lands at a different hour in the diary. Set the computer's clock to Tbilisi time before blocking, or check the diary after saving.",
    },
    {
      type: "heading",
      id: "remove-block",
      text: "Removing a block",
    },
    {
      type: "paragraph",
      text: "Each row under **Blocks in this window** carries a trash icon labelled **Remove block**. One click removes it.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "No confirmation",
      text: "The block is gone the moment you click, and the driver or car becomes assignable for that time at once. Add it again if the click was a slip.",
    },
    {
      type: "links",
      items: [
        { label: "Assigning or reassigning a driver", articleId: "dp-assigning-a-driver" },
        { label: "The dispatch board", articleId: "dp-dispatch-board" },
      ],
    },
  ],
} satisfies HelpArticle;
