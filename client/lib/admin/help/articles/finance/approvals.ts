import type { HelpArticle } from "../../types";

/**
 * `/admin/finance/approvals` (`ApprovalsBrowser`) and
 * `/admin/finance/approvals/[id]` (`ApprovalDecision`), plus the "Ask for
 * approval" buttons on a payable, a receivable and the Payments screen
 * (`ApprovalRequestActions`). Encodes: which changes need a second person
 * (refunds, setting a supplier amount by hand, writing off, moving a due
 * date), who may ask and who may decide, why nobody approves their own
 * request, withdrawing, and what a failed approval looks like.
 */
export const article = {
  id: "fn-approvals",
  title: "Approvals: changes that need a second person",
  summary: "Which money changes must be approved by someone else, how to ask for one, and how to decide.",
  category: "finance",
  routes: ["/admin/finance/approvals", "/admin/finance/approvals/[id]"],
  keywords: [
    "approval",
    "approve",
    "reject",
    "second person",
    "four eyes",
    "refund",
    "write off",
    "waive",
    "override",
    "due date",
    "request",
    "withdraw",
  ],
  related: ["fn-payables", "fn-receivables", "fn-payments"],
  blocks: [
    { type: "where", path: ["Sidebar", "Finance", "Approvals"] },
    {
      type: "paragraph",
      text: "Some changes move money or forgive a debt, and a mistake in them is costly. For those, one person **asks** and a different person **decides**. Nothing happens until the second person approves. The list of requests is under **Approvals**, and the sidebar shows how many are waiting.",
    },
    { type: "heading", id: "what-needs-approval", text: "What needs a second person" },
    {
      type: "table",
      columns: ["Change", "Where you ask for it"],
      rows: [
        ["**Refund** — money paid back to a buyer, or received back from a supplier", "A receivable with money due back, or **Ask to refund** on Payments"],
        ["**Supplier amount override** — setting what a supplier is owed by hand, or handing it back to their terms", "A payable"],
        ["**Supplier write-off** — forgiving what is left to pay a supplier", "A payable"],
        ["**Due date change** — giving a buyer more or less time on one item", "A receivable"],
        ["**Write-off** — forgiving what a buyer still owes", "A receivable"],
      ],
    },
    {
      type: "paragraph",
      text: "Recording a payment that really happened, and adding a note, do not need approval.",
    },
    { type: "heading", id: "asking", text: "How to ask" },
    {
      type: "steps",
      items: [
        "Open the payable, receivable or Payments screen. Where you cannot do the change yourself, the buttons read **Ask to …** instead of the plain action.",
        "Fill in the same details you would for the direct action, and write the **Reason**. It is required, and the person deciding reads it first.",
        "Press **Request approval**. A notice appears with the request's reference, such as `APR-000012`, linking to it.",
      ],
    },
    {
      type: "paragraph",
      text: "You can follow your request on the Approvals screen. While it is waiting you can change your mind with **Withdraw my request**.",
    },
    { type: "heading", id: "deciding", text: "How to decide" },
    {
      type: "steps",
      items: [
        "Open **Approvals**. It shows what is waiting; use the filters for requests already decided.",
        "Open a request. It shows exactly what would change, the reason, and who asked.",
        "Press **Approve** or **Reject**, add a note if it helps, and confirm. Approving makes the change straight away.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "You cannot approve your own request",
      text: "Someone who asks never decides on that same request, even if they are allowed to approve other people's. This is the point of the check: two people have looked at the change. If you are the only person who can approve, ask a colleague with that permission.",
    },
    { type: "heading", id: "when-it-fails", text: "If approving does not work" },
    {
      type: "paragraph",
      text: "Between asking and deciding, things can change: the item may have been paid, written off, or cancelled in the meantime. If the change can no longer be made, the request stays **Waiting** and a red message at the top says why. Fix the cause and approve again, or reject it.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Doing it directly",
      text: "A few people are allowed to make these changes without asking. They see the plain buttons instead. That is a deliberate permission set by a super admin, and the change is still recorded in the audit log.",
    },
  ],
} satisfies HelpArticle;
