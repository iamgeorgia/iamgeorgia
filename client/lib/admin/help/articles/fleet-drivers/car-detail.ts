import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/fleet/[id]` (`fleet/[id]/page.tsx`, `FleetVehicleEditor.tsx`,
 * `FleetGallery.tsx`, `FleetDocuments.tsx` → `DocumentsPanel.tsx`,
 * `FleetVehicleDangerZone.tsx`). Encodes: everything editable including Sold
 * as; photographs with a star for Main and a browser confirm on remove;
 * document types, Label and Valid until, signed audited links, expiry only
 * colouring the line, remove via browser confirm with the file kept; the
 * read-only Drivers list; Take off the road with no confirm; Put on the road;
 * Archive car two-click and refused with upcoming jobs; Delete car for
 * administrators only, typed plate, never on a job, taking photographs and
 * documents with it.
 */
export const article = {
  id: "fd-car-detail",
  title: "A car: details, photographs, documents, status",
  summary: "The car's page — editing it, keeping its photographs and documents, taking it on and off the road, and archiving or deleting it.",
  category: "fleet-drivers",
  routes: ["/admin/transfers/fleet/[id]"],
  keywords: ["car", "photographs", "main photo", "documents", "insurance", "registration", "technical inspection", "valid until", "expired", "off the road", "on the road", "archive", "delete", "plate"],
  related: ["fd-fleet-register", "fd-add-car", "fd-driver-detail", "fd-verification-documents", "md-documents", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Fleet", "[car]"] },
    {
      type: "paragraph",
      text: "A car's page has three panels — **Details**, **Photographs** and **Documents** — and a sidebar with **At a glance**, the read-only **Drivers** list and the status actions.",
    },
    { type: "heading", id: "details", text: "Details" },
    {
      type: "paragraph",
      text: "Everything from the create form is editable here, including **Operated by**, **Body** and **Sold as** — unlike a vehicle class, where those are fixed. The hint under **Sold as** reads: dispatch checks the booked class against this; an upgrade is an override.",
    },
    { type: "heading", id: "photographs", text: "Photographs" },
    {
      type: "steps",
      items: [
        "Upload one or more JPEG, PNG, WebP or AVIF files.",
        "Press the star on the picture that should lead; it gains a **Main** ribbon and becomes the thumbnail in the register.",
        "Remove a picture with its remove button; the browser asks **Remove this photograph?** first.",
      ],
    },
    { type: "heading", id: "documents", text: "Documents" },
    {
      type: "paragraph",
      text: "Four types: **Registration**, **Insurance**, **Technical inspection** and **Other**. Each document has a **Type**, a **Label** and a **Valid until** date, and is uploaded from the panel. Documents are never public: opening one fetches a short-lived link, and every opening is written to the audit trail. Removing one asks the browser's confirmation and leaves the file in the media library.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "Expiry is cosmetic. When **Valid until** has passed the line turns red and reads **expired**, and that is all — nothing blocks dispatch, nothing badges the register, and nobody is reminded. Check the dates yourself.",
    },
    { type: "heading", id: "drivers", text: "Drivers" },
    {
      type: "paragraph",
      text: "The sidebar lists the drivers eligible to take this car, marking the one who has it as **Primary** and any who are **deactivated**. It is read-only here: the link is set from each driver's page.",
    },
    { type: "heading", id: "status", text: "On and off the road" },
    {
      type: "definitions",
      items: [
        {
          term: "Take off the road",
          description: "Sets the car `INACTIVE`. It is kept on file with its drivers, photographs and documents, but is not offered to dispatch.",
        },
        {
          term: "Put on the road",
          description: "Sets the car `ACTIVE` again (also from a draft or an archived car, provided its plate is free).",
        },
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Take off the road** acts on one click with no confirmation. The car vanishes from the dispatch board's choices immediately.",
    },
    { type: "heading", id: "archive", text: "Archive" },
    {
      type: "paragraph",
      text: "**Archive car** retires the car from the fleet: press it, then confirm with **Archive {plate}**. While any job is still ahead the archive is refused and the panel lists the blocking jobs by booking reference and time window — reassign them first.",
    },
    { type: "heading", id: "delete", text: "Delete" },
    {
      type: "paragraph",
      text: "**Delete car** is for administrators only and appears only to them. It is possible only while the car has never been on a job; otherwise archive it. To confirm, type the registration plate back exactly as it reads.",
    },
    {
      type: "callout",
      tone: "danger",
      title: "Irreversible",
      text: "Deleting a car takes its photographs and documents with it. There is no undo; a car that has ever done a job cannot be deleted at all.",
    },
    {
      type: "links",
      items: [
        { label: "Verifying drivers and keeping documents", articleId: "fd-verification-documents" },
        { label: "A driver: profile, documents, cars, verification, login, deactivation", articleId: "fd-driver-detail" },
      ],
    },
  ],
} satisfies HelpArticle;
