import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/drivers/new` (`drivers/new/page.tsx`, `NewDriverForm.tsx`,
 * `DriverFields.tsx`). Encodes: the supplier gate; Works for; the three
 * fieldsets (Who they are, How dispatch reaches them, Internal) with their
 * hints; 16 languages defaulting to Georgian and English; the Contact email
 * not being the login; no login created here; lands on the driver's page.
 */
export const article = {
  id: "fd-add-driver",
  title: "Adding a driver",
  summary: "Creating a driver profile under a supplier — the public, contact and internal fields, and why no login is created yet.",
  category: "fleet-drivers",
  routes: ["/admin/transfers/drivers/new"],
  keywords: ["new driver", "add driver", "works for", "languages", "phone", "contact email", "licence", "date of birth", "internal notes"],
  related: ["fd-drivers-register", "fd-driver-detail", "fd-verification-documents", "gs-accounts"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Drivers", "Add a driver"] },
    {
      type: "paragraph",
      text: "Every driver works for a supplier, so one must be on file before the form appears; otherwise a warning takes its place. The form creates a profile only — the login is issued later, from the driver's page.",
    },
    { type: "heading", id: "fields", text: "The form" },
    {
      type: "paragraph",
      text: "**Works for** picks the supplier. The rest is in three groups, split by who gets to see it.",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Who they are",
          description: "Public. **First name** and **Last name** (a passenger sees the initial only), **Years driving**, **About**, and **Languages** — sixteen to tick, with Georgian and English ticked by default.",
        },
        {
          term: "How dispatch reaches them",
          description: "**Phone**, shown to the partner and the passenger shortly before pick-up. **Contact email**, for correspondence.",
        },
        {
          term: "Internal",
          description: "Staff only, never in the driver's own view: **Licence number**, **Licence expires**, **Date of birth** and **Internal notes**.",
        },
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Contact email** is not the login. The login email is set when the account is created, in the **Login** panel on the driver's page — it is prefilled from this address but can differ.",
    },
    { type: "heading", id: "creating", text: "Creating it" },
    {
      type: "steps",
      items: [
        "Choose **Works for**.",
        "Type the **First name**, **Last name** and **Phone**. The button stays disabled until all three and the supplier are filled.",
        "Tick the languages the driver actually speaks; untick Georgian or English if they do not.",
        "Save. You land on the driver's page, where the photo, documents, cars, verification and login are added.",
      ],
    },
    {
      type: "paragraph",
      text: "Nothing is emailed and no login exists yet. The driver can be dispatched to by phone straight away; create the login when they need the driver panel.",
    },
    {
      type: "links",
      items: [
        { label: "A driver: profile, documents, cars, verification, login, deactivation", articleId: "fd-driver-detail" },
        { label: "Accounts: who creates them, and where", articleId: "gs-accounts" },
      ],
    },
  ],
} satisfies HelpArticle;
