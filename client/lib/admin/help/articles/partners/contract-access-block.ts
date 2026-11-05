import type { HelpArticle } from "../../types";

/**
 * Contract, platform terms, product access, block and terminate. Written from
 * the partner detail page (PartnerContractPanel, PartnerProductAccessPanel,
 * PartnerActions) and the portal terms page. Encodes: approval needs a
 * contract on file unless marked not required; a new terms version locks the
 * portal until the owner accepts; no access rows means everything, DENY hides,
 * any ALLOW makes an allow-list; block is reversible, terminate is final.
 */
export const article = {
  id: "pt-contract-access-block",
  title: "Contract, terms, product access, block and terminate",
  summary: "File a partner's contract, what happens when the platform terms change, limit what a partner may sell, and the difference between blocking and terminating.",
  category: "partners",
  keywords: ["contract", "pdf", "signed", "terms", "accept", "version", "product access", "allow", "deny", "block", "unblock", "terminate", "blocked", "terminated"],
  related: ["pt-lifecycle", "pt-detail-review"],
  blocks: [
    { type: "heading", id: "contract", text: "The contract" },
    {
      type: "paragraph",
      text: "A partner cannot be approved until a signed contract is on file. Open the partner, find the **Contract** panel, choose the signed PDF, enter the date it was signed (and a version if you track one) and press **Upload contract**. Uploading again replaces the file. **Open contract** shows the current PDF in a new tab through a short-lived link.",
    },
    {
      type: "paragraph",
      text: "If a partner genuinely needs no contract, use **This partner does not need a contract** and give a reason. The reason is recorded. You can switch the requirement back on the same way.",
    },
    {
      type: "callout",
      tone: "info",
      text: "If you press Approve without a contract the page says so and points you to the Contract panel. Filing contracts needs the **File partner contracts** permission.",
    },
    { type: "heading", id: "terms", text: "Platform terms" },
    {
      type: "paragraph",
      text: "Partners accept the platform terms on the last step of registration. When a new version of the terms is published, every partner's owner must accept it before the portal works again. Until then the partner sees the **Platform terms** page, and bookings are refused with a message that links there. Only the owner can accept; other team members are told to ask the owner. The partner's page shows which version they accepted.",
    },
    { type: "heading", id: "access", text: "What a partner may sell" },
    {
      type: "list",
      items: [
        "No rows: the partner sees and can book everything.",
        "A **Deny** row hides that product from the partner.",
        "Any **Allow** row for a kind of product (hotels, tours, services, packages, vehicle classes) turns that kind into an allow-list: only the allowed products show.",
      ],
    },
    {
      type: "paragraph",
      text: "Pick a kind of product, search for the product, choose Allow or Deny, add a note if useful, press **Add to the list**, then **Save changes**. Saving replaces the whole list. You need the **Set what a partner may sell** permission to edit it; without it the list is read-only.",
    },
    { type: "heading", id: "block", text: "Block or terminate" },
    {
      type: "table",
      columns: ["", "Block", "Terminate"],
      rows: [
        ["Effect", "Sign-in and booking are refused straight away.", "The relationship ends for good."],
        ["Reversible", "Yes — **Unblock partner**.", "No."],
        ["From", "Approved or suspended.", "Any status except terminated."],
        ["You must give", "A reason.", "A reason, and the partner's ID typed to confirm."],
        ["Records", "Kept.", "Kept: bookings and ledger entries stay for the books."],
      ],
    },
    {
      type: "paragraph",
      text: "A partner with bookings or ledger entries cannot be deleted. The page tells you to terminate instead. Blocked partners see \"Your company's access has been blocked. Contact us.\" when they try to sign in; terminated ones see that their company no longer has an account.",
    },
    {
      type: "links",
      items: [
        { label: "Partner statuses", articleId: "pt-lifecycle" },
        { label: "A partner: review, invitations, history, delete", articleId: "pt-detail-review" },
      ],
    },
  ],
} satisfies HelpArticle;
