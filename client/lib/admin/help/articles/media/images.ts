import type { HelpArticle } from "../../types";

/**
 * Images everywhere in the panel. The shared upload contract
 * (`client/lib/api/media.ts`, `server/services/media/upload.service.js`):
 * JPEG/PNG/WebP/AVIF up to 10 MB, real bytes sniffed with `file-type`,
 * sequential uploads, EXIF stripped, renditions made, alt text set at upload
 * and never editable, no captions, no reorder UI. Detach versus delete from
 * the `onDelete: Restrict` joins and `hotel.service.js`. Per screen:
 * `GalleryManager.tsx` + `RoomGalleries.tsx` (nine categories fixed at
 * upload, "Add to room…" shares the reference), `TourGalleryManager.tsx` and
 * `PackageGalleryManager.tsx` (no categories, editorial path shown until an
 * upload exists), fleet photographs and the driver photo. Dispatchers reach
 * only the fleet and driver categories and cannot delete from the library
 * (`admin.media.routes.js`).
 */
export const article = {
  id: "md-images",
  title: "Images: limits, cover, detach vs delete",
  summary: "What an upload must be, how the cover is chosen, why alt text cannot be edited, and the difference between removing an image and deleting it.",
  category: "media",
  roles: ["ADMIN", "DISPATCHER"],
  routes: [
    { pattern: "/admin/hotels/[slug]/images", section: "hotels" },
    { pattern: "/admin/tours/[slug]/images", section: "tours" },
    { pattern: "/admin/packages/[slug]/images", section: "packages" },
  ],
  keywords: ["upload", "photo", "gallery", "cover", "make cover", "jpeg", "png", "webp", "avif", "10 mb", "alt text", "caption", "reorder", "remove image", "delete image", "category", "room gallery", "car photo", "driver photo"],
  related: ["md-documents", "fd-car-detail", "fd-driver-detail"],
  blocks: [
    {
      type: "paragraph",
      text: "Every image in the panel — a hotel gallery, a room gallery, a tour, a package, a car, a driver's photo — goes through one upload path with one set of rules. What differs per screen is how the images are grouped and what removing one means there.",
    },
    { type: "heading", id: "rules", text: "The rules for every upload" },
    {
      type: "list",
      items: [
        "JPEG, PNG, WebP or AVIF, up to 10 MB each.",
        "The file's real bytes are checked, not its name or declared type. A file that is not what it claims to be is refused.",
        "Several files can be chosen at once; they upload one at a time, in order.",
        "Location and camera data (EXIF) are stripped, and the platform makes its own renditions — thumbnail, card, gallery and original — in modern formats.",
        "The first image uploaded becomes the cover unless another is chosen. Press the star, or **Make cover** where the screen has a link instead, to choose a different one.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "No alt text, captions or reordering",
      text: "Alt text is set automatically at upload — from the property name and category, or the tour or package name — and cannot be edited. There is no caption field and no way to reorder a gallery. Choosing the cover is the only ordering control.",
    },
    { type: "heading", id: "detach-delete", text: "Removing versus deleting" },
    {
      type: "definitions",
      items: [
        {
          term: "Removing an image from a screen",
          description: "The trash button, after a browser confirmation, detaches the image from that gallery. The file itself stays in the library, and any other place that shows the same image keeps it.",
        },
        {
          term: "Deleting the record",
          description: "Deleting a whole property, tour or package removes its image files for good — but only the files nothing else still uses.",
        },
      ],
    },
    { type: "heading", id: "hotels", text: "Hotels" },
    {
      type: "steps",
      items: [
        "Choose a **Category** — Exterior, Lobby, Restaurant, Pool, Spa, Room, Bathroom, View or Facilities. It applies to the next upload.",
        "Press **Upload images** and pick the files. Each lands in the gallery under the chosen category.",
        "Press the star on the tile that should be the cover; it shows a **Cover** pill.",
        "To show a gallery image on a room as well, use **Add to room…** on its tile.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "The category is fixed at upload",
      text: "Once an image is uploaded its category cannot be changed from the panel. To recategorise, remove it and upload it again under the right category.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Add to room shares the image, it does not copy it",
      text: "**Add to room…** puts the same image in the room's gallery. Removing it from the property gallery leaves it on the room, and removing it from the room leaves it on the property — remove from each place separately.",
    },
    {
      type: "paragraph",
      text: "Below the property gallery, each room type has its own **Room galleries** section with **Upload to this room**, its own cover star and its own trash button. Until the property has room types the section reads **No room types yet — add rooms first…**. An empty property gallery reads **Nothing yet. A property needs at least one image before it can be published.**",
    },
    { type: "heading", id: "tours", text: "Tours" },
    {
      type: "paragraph",
      text: "The tour gallery works the same way without categories: upload, then **Make cover** on the tile that should lead, and a trash button that asks **Remove this image from the tour?**. While the tour still has an editorial image path from its details screen and no uploads, the screen says **Showing the editorial image … until something is uploaded.** — the first upload takes precedence. The publish checklist wants a cover, which can be either the editorial path or an upload.",
    },
    { type: "heading", id: "packages", text: "Packages" },
    {
      type: "paragraph",
      text: "Identical to tours: no categories, **Make cover**, and a trash button that asks **Remove this image from the package?**. The editorial image path on the package's details screen is shown until an upload exists, and the gallery cover wins over it once there is one.",
    },
    { type: "heading", id: "fleet", text: "Fleet" },
    {
      type: "paragraph",
      text: "A car carries its photographs on its own page. The star marks the **Main** photograph — the one shown wherever the car is listed. Removing a photograph asks the browser for confirmation first.",
    },
    { type: "heading", id: "driver-photo", text: "Driver photo" },
    {
      type: "paragraph",
      text: "A driver has one photo, with **Upload**, **Replace** and **Remove**. It is a public image — travellers see it when the driver is assigned to their transfer.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Remove asks nothing",
      text: "**Remove** on the driver photo has no confirmation. One click and the photo is gone from the driver; upload it again to restore it.",
    },
    {
      type: "paragraph",
      text: "Dispatchers can upload fleet photographs and driver photos but cannot delete a file from the library — that is an administrator's action.",
    },
    {
      type: "links",
      items: [
        { label: "Private documents", articleId: "md-documents" },
        { label: "A car's page", articleId: "fd-car-detail" },
        { label: "A driver's page", articleId: "fd-driver-detail" },
      ],
    },
  ],
} satisfies HelpArticle;
