import type { HelpArticle } from "../../types";

/**
 * The desk at `/admin/bookings/new` (`components/admin/booking-desk/`,
 * `lib/admin/manualBooking.ts`): the five steps, searching as the buyer,
 * the price adjustment and confirm-now capabilities, and the refusals.
 */
export const article = {
  id: "bk-desk-create-booking",
  title: "Creating a booking at the desk",
  summary: "A booking taken by phone, by email, through another agency or in person — for a partner or a customer without an account — in five steps. One service, several, or a package.",
  category: "bookings",
  routes: ["/admin/bookings/new"],
  keywords: ["create booking", "manual booking", "desk", "phone", "email", "walk-in", "external agency", "price adjustment", "discount", "confirm now", "channel", "X-Act-As-Partner", "package", "several services", "cart", "custom order", "add another"],
  related: ["bk-customers", "bk-finding-bookings", "bk-booking-approvals"],
  blocks: [
    { type: "where", path: ["Sidebar", "Operations", "Hotel bookings", "Create booking"] },
    {
      type: "paragraph",
      text: "**Create booking** sits on every register of bookings and on the overview's approval queue, for anyone holding **Bookings: handle**. It makes the same booking the website or a partner would — the same products, the same prices, the same ledger and the same approval step — and records who it was for and how it came in.",
    },
    {
      type: "heading",
      id: "buyer",
      text: "Step 1 — Buyer",
    },
    {
      type: "list",
      items: [
        "**Existing partner** — the booking is made *as* the agency: its own prices, its product access, its commission and its credit limit all apply, and the search on the next step is made as that partner. Only approved partners can be chosen.",
        "**Existing customer** — somebody the desk has booked for before. The lead traveller on step 3 starts from their details.",
        "**New customer** — a person, or a company with a contact, described here. The customer is created when the booking is made and kept even if the booking is refused, so a second attempt does not type them in again.",
      ],
    },
    {
      type: "heading",
      id: "service",
      text: "Step 2 — Service",
    },
    {
      type: "paragraph",
      text: "One tab per product. A **Hotel** is a property, dates and a party, then every room and rate on sale. A **Transfer** is two points, a date and time (and a return), a party and its bags, then every vehicle that can carry them. A **Tour** is a tour, a window of up to 62 days and a party, then every departure that can be sold. A **Service** has no inventory: pick it, say when and for how many, and the server prices it when the booking is made. A **Package** is a package, a start date and a party, then every slot resolved and priced — the other allowed choices for a slot can be picked and an optional slot left out, and the whole package is added as one line. Choosing an offer carries its price into the booking; changing the buyer afterwards clears the list, because an offer is priced for the buyer it was searched for.",
    },
    {
      type: "paragraph",
      text: "**Several services in one booking.** After the first line, **Add another** reopens the tabs; each line shows what was chosen, its price and **Remove**. One line is booked on its own register, exactly as before. Two or more lines, or any package, are booked as **one order** — one approval, one invoice, one reference (`ORD-…`) — with every part readable on its own register underneath. Up to twenty lines, all in one currency.",
    },
    {
      type: "callout",
      tone: "info",
      title: "A package in the order",
      text: "A package is flattened into its components when the order is made, each keeping the package's name and its share of the package discount. It costs in the order what it costs on its own; the desk's adjustment does not touch it.",
    },
    {
      type: "heading",
      id: "travellers",
      text: "Step 3 — Travellers",
    },
    {
      type: "paragraph",
      text: "The lead is the person the voucher and the invoice are addressed to; a title (Mr, Mrs, Ms, Miss, Master) prints before the name. Other guests or travellers are named for the supplier, with a child's age as the price was computed for it. A transfer takes the flight per leg and the pick-up and drop-off addresses; a tour takes a pick-up note. With several lines the same flights and doors go on every transfer (and on a package's transfer) and the pick-up note on every tour.",
    },
    {
      type: "heading",
      id: "terms",
      text: "Step 4 — Terms",
    },
    {
      type: "list",
      items: [
        "**Channel** — phone, email, external agency or direct. It becomes the booking's source, and the registers can filter on it.",
        "**Assigned manager** and **Internal notes** — who is handling the booking and what the desk wants to remember. Both can be changed later on the booking's **Desk** panel. Notes are never shown to the buyer or the supplier.",
        "**Adjustment** — a signed amount on top of the catalogue price (`-50` is a discount, `120` a supplement), with a reason that is audited. Needs **Bookings: override price**; the field is read-only otherwise. The supplier's cost and the cancellation terms still read the catalogue price; only what the buyer pays changes. On an order of several lines it applies to the whole order and the server spreads it over the standalone lines (a package keeps its own discount and takes none of it).",
        "**Confirm now** — needs **Bookings: approve**. Otherwise the booking waits in the approvals queue like any other.",
      ],
    },
    {
      type: "heading",
      id: "review",
      text: "Step 5 — Review",
    },
    {
      type: "paragraph",
      text: "Everything read back, each block with an **Edit** link to its step, and the total: the catalogue price plus the adjustment. An order of several lines is priced again here, today: each line's current price, a package's parts under the package, a moved price with the old figure struck through, and a line that went marked with **Remove**. **Refresh prices** asks again. **Create booking** makes it and opens the booking's own page — the order's page for several lines. A double-click cannot make two bookings.",
    },
    {
      type: "heading",
      id: "refusals",
      text: "When the booking is refused",
    },
    {
      type: "table",
      columns: ["Message", "What happened"],
      rows: [
        ["The price of what you chose has moved", "The offer was re-priced between the search and the booking. **Search again** returns to step 2 with the current price."],
        ["What you chose can no longer be booked", "It sold out or was withdrawn meanwhile. Search again."],
        ["One line (or N lines) can no longer be booked", "On an order of several lines, each line in the way is marked on step 2. Remove it, or search for it again; the rest of the list stays."],
        ["The price of a line has moved", "A line's price moved since its search. **Refresh prices** shows the current figures on the Review step; replace the moved line to book at them."],
        ["Everything in one booking settles in one currency", "The lines are priced in different currencies. An order settles in one; remove the odd line out."],
        ["Changing priceAdjustment is not part of your role", "The adjustment needs **Bookings: override price**. Clear it, or ask somebody who holds it."],
        ["This partner is not active", "Only an approved partner can be booked for. Check its status on the partner's page."],
        ["Not a member of staff", "The assigned manager must be an active staff account."],
        ["A field is marked on an earlier step", "The server refused a value; the wizard reopens the step that owns it with the message beside the field."],
      ],
    },
    {
      type: "links",
      items: [
        { label: "Customers", articleId: "bk-customers" },
        { label: "Booking approvals", articleId: "bk-booking-approvals" },
        { label: "Open the desk", href: "/admin/bookings/new" },
      ],
    },
  ],
} satisfies HelpArticle;
