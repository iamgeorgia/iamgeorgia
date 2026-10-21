import type { HelpArticle } from "../../types";

/**
 * The customers register at `/admin/customers` and a customer's page
 * (`CustomersBrowser.tsx`, `CustomerForm.tsx`, `lib/admin/customers.ts`).
 */
export const article = {
  id: "bk-customers",
  title: "Customers",
  summary: "The people and companies the desk books for when the buyer has no partner account: finding one, adding one, and what their page shows.",
  category: "bookings",
  routes: ["/admin/customers", "/admin/customers/[id]"],
  keywords: ["customer", "walk-in", "guest", "company", "tax id", "billing", "buyer", "no account", "desk"],
  related: ["bk-desk-create-booking", "bk-finding-bookings"],
  blocks: [
    { type: "where", path: ["Sidebar", "Network", "Customers"] },
    {
      type: "paragraph",
      text: "A partner is a company with an account, a contract and a credit line. A **customer** is everyone else the desk takes a booking for: a person who rang up, a company that emailed, a traveller at the counter. A customer has no login; the desk books on their behalf, and the invoice is addressed to them.",
    },
    {
      type: "heading",
      id: "register",
      text: "The register",
    },
    {
      type: "steps",
      items: [
        "Type in the search box to match a name, an email, a phone number or a tax ID.",
        "Pick **Individual** or **Company** to see one kind.",
        "Open a name to see the customer's details and every booking made for them.",
      ],
    },
    {
      type: "heading",
      id: "adding",
      text: "Adding a customer",
    },
    {
      type: "paragraph",
      text: "**New customer** opens a dialog (it needs **Bookings: handle**). A **Company** is the buyer with a **Contact person** to speak to; an **Individual** is the person themselves. The **Tax ID**, the **Billing address**, the **City** and the two-letter **Country** are what the invoice prints as the buyer, so fill in what the invoice will need. **Notes** are for the desk only. A customer can also be described inline on the first step of **Create booking**, which creates them in the same breath.",
    },
    {
      type: "heading",
      id: "page",
      text: "A customer's page",
    },
    {
      type: "list",
      items: [
        "**Bookings** — every booking made for this customer across hotels, transfers, tours, services and orders, newest first, each linked to its own page.",
        "**Details** — what the desk recorded. **Edit details** changes them; a change does not alter invoices already issued, which froze the buyer as printed.",
        "**Create booking** — opens the desk with this customer already chosen and the lead traveller prefilled.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Where a customer appears elsewhere",
      text: "On a booking's page the **Desk** panel names the customer and links here. In Finance, a customer who owes money is the receivable's debtor, and gets its own client record at the invoicing provider.",
    },
    {
      type: "links",
      items: [
        { label: "Creating a booking at the desk", articleId: "bk-desk-create-booking" },
        { label: "Open the register", href: "/admin/customers" },
      ],
    },
  ],
} satisfies HelpArticle;
