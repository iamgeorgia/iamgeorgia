import type { HelpArticle } from "../../types";

/**
 * Vehicle classes: the register at `/admin/transfers/vehicles`
 * (`transfers/vehicles/page.tsx`, `TransferVehicleChannel.tsx`), the create
 * form (`NewTransferVehicleForm.tsx`), the shared fieldset
 * (`TransferVehicleFields.tsx`), the editor and `TransferVehicleDangerZone.tsx`.
 * Encodes: no search, filters or paging; the Channel cell as a one-click
 * Public / Trade only switch; the supplier gate; four create-only fields
 * (Class, Body, Sold as, Supplier); trade-only by default; the fallback-fare
 * formula max(minimum, km × rate) + airport fee applied only where a route
 * has no price; eight on-board features; English-only copy; archive never
 * delete, archiving clearing the public channel and restore coming back
 * trade-only.
 */
export const article = {
  id: "tc-vehicle-classes",
  title: "Vehicle classes",
  summary: "The categories a traveller buys — Economy, Comfort, Minivan and so on — with their capacity, fallback fare, features and sales channel.",
  category: "transfers-catalogue",
  roles: ["ADMIN"],
  routes: [
    { pattern: "/admin/transfers/vehicles", section: "register" },
    { pattern: "/admin/transfers/vehicles/new", section: "create" },
    { pattern: "/admin/transfers/vehicles/[id]", section: "edit" },
  ],
  keywords: ["vehicle class", "economy", "comfort", "minivan", "per km", "minimum fare", "airport fee", "trade only", "public", "channel", "capacity", "seats", "bags", "supplier", "archive"],
  related: ["tc-pricing-model", "tc-route-editing", "fd-add-car", "pt-register", "pb-b2c-vs-trade"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Transfers", "Vehicle classes"] },
    {
      type: "paragraph",
      text: "A vehicle class is what a traveller buys: a promise of a certain size, comfort and set of features at a certain price. A fleet car is what actually turns up. Classes are few — a handful, not hundreds — so this register has no search, no filters and no paging.",
    },
    { type: "heading", id: "register", text: "The register" },
    {
      type: "list",
      items: [
        "Three cards: **Classes on sale**, **Open to the public** (the rest are trade-only) and **Largest vehicle** by seats.",
        "Columns: Class (name, then `class · private or shared, per seat · supplier`), Seats, Bags, Per km, Minimum and Channel.",
        "The per-kilometre and minimum figures only apply where a route has no price of its own.",
        "Archived classes read **Archived** in the Channel column and cannot be switched.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "The Channel cell is a live switch. One click flips a class between **Public** and **Trade only** from the table row, with no confirmation — and Public means it is on sale to every website visitor from that moment.",
    },
    { type: "heading", id: "create", text: "Adding a class" },
    {
      type: "paragraph",
      text: "A class belongs to a transfer supplier, and a supplier is a partner. With no supplier on file the form is replaced by a warning telling you to add the supplier as a partner first.",
    },
    {
      type: "steps",
      items: [
        "Choose the **Class** (Economy, Comfort, Minivan, Van, Group, 4x4 or VIP), the **Body** (sedan, SUV, minivan, van or bus), **Sold as** (**Private — whole vehicle** or **Shared — per seat**) and the **Supplier**.",
        "Fill in the shared fields below; a name, a vehicle example, a summary, a slug, a per-kilometre rate and a minimum fare are all needed before the button wakes up.",
        "Tick **Sell this class to the public** if website visitors should see it. Left unticked, the class is created trade-only — bookable by partners, invisible to the public.",
        "Save. You land on the class's page.",
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "**Class**, **Body**, **Sold as** and **Supplier** are set once and cannot be changed afterwards; they are not on the editor. If one is wrong, archive the class and create another.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "definitions",
      items: [
        { term: "Identity", description: "**Name**, **Vehicle example** (always read as \"or similar\") and **Summary**." },
        {
          term: "Capacity",
          description: "**Passengers** (1 to 80), **Large bags** and **Cabin bags**. These are a hard search constraint: a party that does not fit is never offered the class.",
        },
        {
          term: "Fallback fare",
          description: "**Per km (GEL)**, **Minimum (GEL)** — required and greater than zero — and **Airport fee (GEL)**. The fare is `max(minimum, km × rate) + airport fee`, and it applies only where a route has no price of its own.",
        },
        {
          term: "On board",
          description: "Eight features: air conditioning, Wi-Fi, child seat, English-speaking driver, meet and greet, flight tracking, bottled water and free waiting. Each one is a promise — tick only what every car in the class delivers.",
        },
        {
          term: "Copy",
          description: "**Description**, **Included**, **Not included** and **Pick-up procedure**, one item per line. English only; there is no translations screen.",
        },
        { term: "Recommended rank", description: "0 to 999, lower first. Sets the order classes are offered in." },
      ],
    },
    {
      type: "paragraph",
      text: "Example: Comfort, per km 2.50, minimum 40, airport fee 10. A 12 km journey from the airport with no curated fare costs `max(40, 30) + 10` = 50 GEL; a 60 km one costs `150 + 10` = 160 GEL.",
    },
    { type: "heading", id: "edit", text: "Editing a class" },
    {
      type: "paragraph",
      text: "The class's page carries the same fields except the four fixed at creation, which the sidebar lists for reference, and the public-channel checkbox, which lives on the register's Channel switch instead so there is only one place that flips it.",
    },
    { type: "heading", id: "archive", text: "Archiving a class" },
    {
      type: "paragraph",
      text: "A class is never deleted. Archiving takes it off search everywhere: press the archive button, then confirm with **Archive {name}**. A restore brings it back.",
    },
    {
      type: "callout",
      tone: "info",
      title: "Note",
      text: "Archiving clears the public channel as a side effect, so a restored class comes back trade-only. Switch it to **Public** again on the register if it should be.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "Careful",
      text: "When a class is public, the panel suggests switching the channel to trade-only instead of archiving. That takes it off the website but leaves partners able to book it.",
    },
    {
      type: "links",
      items: [
        { label: "How a transfer fare is computed", articleId: "tc-pricing-model" },
        { label: "Adding a car", articleId: "fd-add-car" },
      ],
    },
  ],
} satisfies HelpArticle;
