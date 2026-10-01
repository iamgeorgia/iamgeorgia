import type { HelpArticle } from "../../types";

/**
 * `/admin/transfers/fleet/new` (`fleet/new/page.tsx`, `NewFleetVehicleForm.tsx`,
 * `FleetVehicleFields.tsx`). Encodes: the supplier-and-class gate; Operated
 * by, Sold as, Body; the car fields with the plate matched regardless of
 * spacing and the VIN internal only; capacity as a hard rule at dispatch;
 * on-board features including wheelchair accessible; public description and
 * staff-only notes; "Available to dispatch straight away" ticked by default
 * (ACTIVE) or unticked (draft); lands on the car's page.
 */
export const article = {
  id: "fd-add-car",
  title: "Adding a car",
  summary: "Putting a physical car on file under a supplier and a vehicle class, ready for dispatch or held as a draft.",
  category: "fleet-drivers",
  roles: ["ADMIN", "DISPATCHER"],
  routes: ["/admin/transfers/fleet/new"],
  keywords: ["new car", "add car", "plate", "VIN", "make", "model", "capacity", "wheelchair", "operated by", "sold as", "draft"],
  related: ["fd-fleet-register", "fd-car-detail", "fd-driver-detail", "dp-assigning-a-driver"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Fleet", "Add a car"] },
    {
      type: "paragraph",
      text: "A car belongs to a supplier and is sold as a vehicle class, so both must already be on file. Until there is one of each, the form is replaced by a warning saying so. Archived classes are not offered.",
    },
    { type: "heading", id: "fields", text: "The form" },
    {
      type: "definitions",
      items: [
        { term: "Operated by", description: "The supplier that runs the car." },
        { term: "Sold as", description: "The vehicle class the car is dispatched as. Dispatch checks the booked class against this." },
        { term: "Body", description: "Sedan, SUV, minivan, van or bus." },
        {
          term: "The car",
          description: "**Make** and **Model** (required); **Registration plate** (required — matched however it is spelt, spaces and dashes do not make it a different car); **Colour**; **Year**; **VIN**, which is internal and never shown to partners or passengers.",
        },
        {
          term: "Capacity",
          description: "**Passenger seats** and **Large bags** (required) and **Cabin bags**. A hard rule at dispatch: a job that does not fit is not offered this car.",
        },
        {
          term: "On board",
          description: "The same features as a vehicle class, plus **Wheelchair accessible**.",
        },
        {
          term: "Notes",
          description: "**Description** is public. **Internal notes** are for staff only.",
        },
        {
          term: "Available to dispatch straight away",
          description: "Ticked by default: the car is created `ACTIVE`. Untick it to create a draft that stays off the road until you put it on.",
        },
      ],
    },
    { type: "heading", id: "creating", text: "Creating it" },
    {
      type: "steps",
      items: [
        "Choose **Operated by** and **Sold as**.",
        "Type the **Make**, **Model** and **Registration plate**. The button stays disabled until all three and the two selects are filled.",
        "Set the capacity honestly — dispatch enforces it.",
        "Untick **Available to dispatch straight away** if the car is not yet ready.",
        "Save. You land on the car's page, where photographs and documents are added.",
      ],
    },
    {
      type: "paragraph",
      text: "Example: Operated by the house provider, Sold as Comfort, Toyota Camry, plate `AB-123-CD`, 3 seats, 3 large bags. Typing `AB123CD` later in the register search finds the same car.",
    },
    {
      type: "links",
      items: [
        { label: "A car: details, photographs, documents, status", articleId: "fd-car-detail" },
        { label: "Fleet register", articleId: "fd-fleet-register" },
      ],
    },
  ],
} satisfies HelpArticle;
