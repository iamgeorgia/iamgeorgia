import type { HelpArticle } from "../../types";

/**
 * The dispatcher's day. Their sidebar has six screens; this walks them in
 * the order they are used. Mirrors the dispatcher list in `quickStart.ts`.
 */
export const article = {
  id: "gs-quick-start-dispatcher",
  title: "Quick start for dispatchers",
  summary: "The six screens a dispatcher works, in the order of a working day — the board, an assignment, a leg's statuses, a diary, the fleet, the ratings queue.",
  category: "getting-started",
  keywords: ["quick start", "dispatcher", "first day", "onboarding", "checklist", "board"],
  related: ["dp-dispatch-board", "dp-assigning-a-driver", "rf-common-tasks-dispatcher", "rf-dangerous-actions"],
  blocks: [
    {
      type: "paragraph",
      text: "Signing in as a dispatcher lands you on the dispatch board, and the sidebar lists only the transfer operations screens. Everything you need is within two clicks of the board.",
    },
    {
      type: "steps",
      items: [
        "**Read the board.** Every leg — a return journey is two legs — soonest first, with its status and who is on it. Narrow it by date; the board shows every leg on the platform until you do.",
        "**Assign a driver.** **Assign** on a leg lists the drivers with an active car of the booked class and whether each is free. Choose a car or leave it to the driver; tick **Confirmed by phone** only if they really have said yes.",
        "**Move a leg through its day.** The **Mark as…** menu offers only the moves the server allows from where the leg is. It applies the moment you choose — there is no confirmation — and the partner is told when the driver arrives, the passenger boards, and the transfer completes.",
        "**Check a diary and block time.** The Schedule shows one driver's or one car's jobs and blocks for a fortnight. A block — a day off, a service — is refused while a job sits inside it.",
        "**Keep fleet and drivers current.** A car off the road is not offered; a deactivated driver is not offered. Documents and verification live on each record; a driver's login link is issued from their page.",
        "**Moderate ratings.** Scores count at once; the words a passenger wrote wait in the queue for a look before a partner sees them.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Two controls on the board act at once",
      text: "**Mark as…** applies on selection, and **Cancel leg** ends the leg for good after one browser confirm. Both are covered in the do-not list.",
    },
    {
      type: "links",
      items: [
        { label: "The dispatch board", articleId: "dp-dispatch-board" },
        { label: "Common tasks for dispatchers", articleId: "rf-common-tasks-dispatcher" },
        { label: "Dangerous actions — the do-not list", articleId: "rf-dangerous-actions" },
      ],
    },
  ],
} satisfies HelpArticle;
