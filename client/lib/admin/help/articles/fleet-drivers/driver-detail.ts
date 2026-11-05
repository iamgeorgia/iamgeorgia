import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/drivers/[id]` (`drivers/[id]/page.tsx`, `DriverEditor.tsx`,
 * `DriverPhoto.tsx`, `DriverDocuments.tsx`, `DriverVehicles.tsx`,
 * `DriverVerification.tsx`, `DriverAccount.tsx`, `DriverDangerZone.tsx`).
 * Encodes: the profile editor with the house-provider hint; the public photo
 * with an unconfirmed Remove; five private document types; cars ticked with
 * one Primary, archived cars hidden unless ticked, saved as a whole; the
 * verification Set to / Note / Record with no confirmation and leaving
 * Verified clearing who and when; the three-state Login panel with the link
 * shown under PASSWORD LINK and Copy link, each new link stopping the last;
 * deactivation with a required reason and the "Send any upcoming jobs back
 * to dispatch" checkbox, ending the login and all sessions; Reactivate;
 * Delete for administrators only, typed surname, before the first job,
 * removing login, photo and documents and freeing the email.
 */
export const article = {
  id: "fd-driver-detail",
  title: "A driver: profile, documents, cars, verification, login, deactivation",
  summary: "The driver's page — editing the profile, keeping documents, choosing cars, recording verification, issuing the login, and deactivating or deleting.",
  category: "fleet-drivers",
  routes: ["/admin/transfers/drivers/[id]"],
  keywords: ["driver", "photo", "documents", "licence", "cars", "primary car", "verification", "verified", "login", "activation link", "password link", "copy link", "deactivate", "reactivate", "delete"],
  related: ["fd-verification-documents", "fd-add-driver", "fd-car-detail", "dp-assigning-a-driver", "gs-accounts", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Drivers", "[driver]"] },
    {
      type: "paragraph",
      text: "The driver's page has **Profile**, **Documents** and **Cars** in the main column, and **Photo**, **At a glance**, **Verification**, **Login** and the status actions in the sidebar. The header carries the verification badge and, where it applies, a **Deactivated** pill.",
    },
    { type: "heading", id: "profile", text: "Profile" },
    {
      type: "paragraph",
      text: "The supplier select and the same three fieldsets as the create form: who they are, how dispatch reaches them, and the internal fields. The hint under the supplier reads: the platform's own drivers belong to the house provider.",
    },
    { type: "heading", id: "photo", text: "Photo" },
    {
      type: "paragraph",
      text: "The photo is public — a passenger sees it with the driver's initial. **Upload** or **Replace** it from the sidebar.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Remove** on the photo acts at once, with no confirmation.",
    },
    { type: "heading", id: "documents", text: "Documents" },
    {
      type: "paragraph",
      text: "Five types: **Driving licence**, **ID document**, **Medical certificate**, **Background check** and **Other**, each with a label and a **Valid until** date. They are private, staff-only, and never part of what the driver or a partner sees. Opening one uses a short-lived link that is written to the audit trail; an expired date only turns the line red.",
    },
    { type: "heading", id: "cars", text: "Cars" },
    {
      type: "steps",
      items: [
        "Tick each car the driver may take.",
        "Choose one **Primary** — the radio wakes up once its car is ticked. The dispatch screen pre-fills it.",
        "Press **Save cars**. The list is replaced as a whole.",
      ],
    },
    {
      type: "paragraph",
      text: "This is eligibility and a default, not a schedule. Archived cars are hidden unless the driver already had one ticked.",
    },
    { type: "heading", id: "verification", text: "Verification" },
    {
      type: "paragraph",
      text: "The panel shows the current state and, once verified, who verified the driver and when. **Set to** offers **Not checked**, **Checks in progress**, **Verified** and **Rejected**; the **Note** says what was checked and is kept in the audit trail, not on the profile. **Record** writes it.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Record** has no confirmation. Moving away from Verified clears who verified the driver and when. An unverified driver can still be assigned a job, but only with an override that is written to the audit trail.",
    },
    { type: "heading", id: "login", text: "Login" },
    {
      type: "definitions",
      items: [
        {
          term: "No login yet",
          description: "The panel reads that the login is not created yet and the driver can still be dispatched to by phone. Fill in **Login email** (prefilled from the contact email) and press **Create login and send the link**.",
        },
        {
          term: "Waiting for a password",
          description: "The email and status are shown with **Send a new activation link** underneath.",
        },
        { term: "Active", description: "The driver has chosen a password. No actions." },
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "After either button the link appears on screen under **PASSWORD LINK** with a **Copy link** button, whether or not the email went out. If the panel says the link could not be emailed, copy it and send it yourself.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "Every new link stops the previous one working. Do not send a second before the driver has tried the first.",
    },
    { type: "heading", id: "deactivate", text: "Deactivate and reactivate" },
    {
      type: "steps",
      items: [
        "Press **Deactivate driver**. A **Reason** field appears; the button stays disabled until it is filled.",
        "Tick **Send any upcoming jobs back to dispatch** if the driver has jobs ahead. Without it, the panel lists the blocking jobs by booking reference and pick-up time and refuses.",
        "Confirm. With the box ticked, every live assignment is withdrawn and each leg goes back to unassigned on the dispatch board.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "Deactivating ends the driver's login and every open session at once. **Reactivate** restores the profile in one click, and the panel shows the reason and date recorded when it was deactivated.",
    },
    { type: "heading", id: "delete", text: "Delete" },
    {
      type: "paragraph",
      text: "**Delete driver** is for administrators only and appears only to them. It is possible only before the driver's first job; afterwards deactivate instead. To confirm, type the driver's surname.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "Deleting removes the login, the photo and every document, and frees the email address for someone else. There is no undo.",
    },
    {
      type: "links",
      items: [
        { label: "Verifying drivers and keeping documents", articleId: "fd-verification-documents" },
        { label: "Assigning a driver", articleId: "dp-assigning-a-driver" },
        { label: "Accounts: who creates them, and where", articleId: "gs-accounts" },
      ],
    },
  ],
} satisfies HelpArticle;
