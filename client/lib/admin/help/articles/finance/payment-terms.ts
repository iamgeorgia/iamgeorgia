import type { HelpArticle } from "../../types";

/**
 * `/admin/catalogue/payment-policies` (`PaymentPoliciesManager`,
 * `PaymentPolicyEditor`), reading and writing `/api/admin/payment-policies`
 * and `PATCH /api/admin/transfers/providers/:id`. Encodes the timing matrix
 * of the checkout: PAY_NOW (card required, unpaid bookings cancelled after
 * `unpaidCancelHours`), PAY_LATER (card offered), DEPOSIT (behaves as
 * pay-now for now), PAY_AT_HOTEL (`cardOptional`), CREDIT_ACCOUNT; null means
 * the platform default.
 */
export const article = {
  id: "fn-payment-terms",
  title: "Payment terms",
  summary: "The rule that decides whether a guest must pay by card, may pay later, or settles on the spot.",
  category: "finance",
  routes: ["/admin/catalogue/payment-policies"],
  keywords: ["payment terms", "payment policy", "pay now", "pay later", "deposit", "unpaid", "auto cancel", "card optional", "checkout"],
  related: ["fn-card-payments", "fn-receivables"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Payment terms"] },
    {
      type: "paragraph",
      text: "Whether a guest has to pay by card, is allowed to pay later, or pays the driver or the property directly is a property of the thing being sold, not of the platform. A payment policy is that rule. You attach one to a tour option, a package or a transfer supplier; hotel offers keep their own picker on the rooms screen.",
    },
    { type: "heading", id: "timings", text: "What each timing does at checkout" },
    {
      type: "table",
      columns: ["Timing", "Card at checkout", "Pay later", "If unpaid"],
      rows: [
        ["Pay now", "Required", "Not offered", "Cancelled automatically after the hours you set"],
        ["Pay later", "Offered", "Offered", "Kept; finance chases as usual"],
        ["Deposit", "Required, for the full amount for now", "Not offered", "As pay now"],
        ["Pay on the spot", "Not offered, unless you tick the card option", "Offered", "Not applicable"],
        ["Credit account", "Never offered to guests", "Not applicable", "Partner terms apply"],
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Deposits are not charged as deposits yet",
      text: "A deposit policy currently charges the whole amount at checkout, exactly like pay now. The deposit percentage is stored for when split payments arrive.",
    },
    { type: "heading", id: "unpaid", text: "Cancelling unpaid bookings" },
    {
      type: "paragraph",
      text: "Only pay now and deposit policies cancel anything. **Cancel unpaid after (hours)** starts when the booking is made; a blank field means never. When the time passes with no card payment under way, the booking is cancelled, the guest is told, and the inventory goes back on sale. A guest who has already started paying is left alone until the attempt ends.",
    },
    { type: "heading", id: "default", text: "Platform default" },
    {
      type: "paragraph",
      text: "Anything without a policy uses the platform default for its kind: pay later for tours and packages, settle with the driver for transfers. Choosing **Platform default** on an item detaches its policy.",
    },
    { type: "heading", id: "frozen", text: "Edits never reach existing bookings" },
    {
      type: "paragraph",
      text: "The rule a guest agreed to is copied onto their booking when it is made. Changing or deactivating a policy affects future bookings only.",
    },
    { type: "heading", id: "using", text: "Using this screen" },
    {
      type: "steps",
      items: [
        "Pick the product kind: Tours, Packages or Transfers.",
        "Choose **New policy**, or **Edit** on an existing one. Name it so the choice is obvious when picked from a list.",
        "Pick the timing and fill the fields that appear for it.",
        "Attach it: tour options and packages have a **Payment terms** field in their editors; transfer suppliers have one in the list at the bottom of the Transfers tab.",
      ],
    },
    {
      type: "links",
      items: [{ label: "Card payments", articleId: "fn-card-payments" }],
    },
  ],
} satisfies HelpArticle;
