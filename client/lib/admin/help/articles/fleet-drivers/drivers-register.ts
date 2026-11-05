import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/drivers` (`transfers/drivers/page.tsx`, `DriversBrowser.tsx`).
 * Encodes: the description "A profile can be dispatched to by phone before it
 * has a login."; stat cards Active drivers, Verified, Awaiting checks; search
 * by name, phone or email; the Verification and Active filters; the columns
 * with the Login values — / Pending / Active / Off.
 */
export const article = {
  id: "fd-drivers-register",
  title: "Drivers register",
  summary: "Every driver profile on file — searching, filtering by verification and activity, and reading the Login column.",
  category: "fleet-drivers",
  keywords: ["drivers", "driver list", "verified", "awaiting checks", "deactivated", "login", "pending", "phone", "languages"],
  routes: ["/admin/transfers/drivers"],
  related: ["fd-add-driver", "fd-driver-detail", "fd-verification-documents", "fd-fleet-register", "dp-assigning-a-driver"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Drivers"] },
    {
      type: "paragraph",
      text: "A driver is a profile first and an account second: a profile can be dispatched to by phone before it has a login. This register lists every profile, active or deactivated, with its verification state and whether a login exists.",
    },
    { type: "heading", id: "cards", text: "The three cards" },
    {
      type: "table",
      columns: ["Card", "What it counts"],
      rows: [
        ["Active drivers", "Profiles that have not been deactivated."],
        ["Verified", "Profiles whose checks have been recorded as `VERIFIED`."],
        ["Awaiting checks", "Profiles still `UNVERIFIED` or with checks `PENDING`."],
      ],
    },
    { type: "heading", id: "finding", text: "Finding a driver" },
    {
      type: "list",
      items: [
        "The search box matches name, phone or email.",
        "**Verification** narrows to **Not checked**, **Checks in progress**, **Verified** or **Rejected**.",
        "The active filter shows **Active and deactivated**, **Active** only or **Deactivated** only.",
      ],
    },
    { type: "heading", id: "columns", text: "The columns" },
    {
      type: "definitions",
      items: [
        { term: "Driver", description: "Photo (or a placeholder), name and phone, with a **Deactivated** pill where it applies." },
        { term: "Works for", description: "The supplier the driver belongs to." },
        { term: "Languages", description: "The languages ticked on the profile." },
        { term: "Verification", description: "The verification badge." },
        {
          term: "Login",
          description: "`—` when no login has been created; **Pending** when a login exists but no password has been chosen yet; **Active** once it has; **Off** when the driver has been deactivated.",
        },
      ],
    },
    {
      type: "links",
      items: [
        { label: "Adding a driver", articleId: "fd-add-driver" },
        { label: "A driver: profile, documents, cars, verification, login, deactivation", articleId: "fd-driver-detail" },
      ],
    },
  ],
} satisfies HelpArticle;
