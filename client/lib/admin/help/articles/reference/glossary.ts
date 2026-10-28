import type { HelpArticle } from "../../types";

/**
 * The panel's vocabulary. Encodes the reference prefixes (`BKG-`, `ORD-`,
 * `TUR-`, `TRF-`, `PTR-`), the money model (net, sell, markup in basis
 * points, minor units), the trade/public channel split, the supplier →
 * partner → provider relationship, curated fares versus the distance engine,
 * the lifecycle statuses, the kosher levels and the derived "certified"
 * flag, and the operational terms from dispatch and the schedule.
 */
export const article = {
  id: "rf-glossary",
  title: "Glossary",
  summary: "What the panel means by a word — references, money, channels, statuses, kosher levels and the terms used on the dispatch board.",
  category: "reference",
  keywords: ["glossary", "terms", "definitions", "vocabulary", "meaning", "bps", "basis points", "tetri", "net", "markup", "slug", "outbox", "b2b", "b2c"],
  related: ["bk-statuses-glossary", "dp-leg-statuses", "rf-search-filters"],
  blocks: [
    {
      type: "heading",
      id: "references",
      text: "References",
    },
    {
      type: "definitions",
      items: [
        { term: "`BKG-`", description: "A hotel booking. Found on the Hotel bookings register." },
        { term: "`ORD-`", description: "An order — a whole trip bought as one thing. Found on the Orders register." },
        { term: "`TUR-`", description: "A tour booking. Found on the Tour bookings register." },
        { term: "`TRF-`", description: "A transfer booking. Found on the Transfer bookings register and, leg by leg, on the dispatch board." },
        { term: "`PTR-`", description: "A partner's Partner ID. It is never reissued, even after the partner is deleted, and it is the reference a partner quotes over the phone." },
      ],
    },
    {
      type: "heading",
      id: "bookings-and-parts",
      text: "Bookings and their parts",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Booking and leg",
          description: "A transfer booking is what the customer bought; a leg is one journey inside it. A return transfer is one booking with two legs, and each leg is dispatched, driven and marked separately. The booking stays open until every leg is done.",
        },
        {
          term: "Order, part and slot",
          description: "An order is a package or a built-to-order trip sold whole. Each thing inside it — a hotel stay, a transfer, a tour, a service — is a part with its own status, and a package's parts are defined as slots on the package. A required part cannot be dropped by the buyer; an optional one can.",
        },
        {
          term: "On request and instant confirmation",
          description: "An instantly confirmed product is committed the moment it is booked. An on-request product is written as pending, its capacity is claimed, and somebody has to answer within the deadline — that is the queue on the Orders and Tour bookings registers.",
        },
        {
          term: "Rate plan and room type",
          description: "A room type is what a guest sleeps in. A rate plan is the terms it is sold on — board, cancellation policy, payment policy. One room sold with two boards is one room type and two rate plans, never two rooms.",
        },
        {
          term: "Board codes",
          description: "`RO` room only, `BB` bed and breakfast, `HB` half board, `HB+` half board plus, `FB` full board, `FB+` full board plus, `AI` all inclusive, `UAI` ultra all inclusive.",
        },
      ],
    },
    {
      type: "heading",
      id: "money",
      text: "Money",
    },
    {
      type: "definitions",
      items: [
        { term: "Net", description: "What the supplier is paid — the cost. Nightly prices, tour tiers and service units are entered as net." },
        { term: "Sell", description: "What the buyer pays. Usually derived from the net by the buyer's markup; a tier or a service can fix a sell price instead, which then wins over the markup." },
        { term: "Margin and markup", description: "Margin is sell minus net, shown beside a booking's money as an amount and a rate. Markup is the rate applied to the net to reach the sell; a partner's commission rate is used as its markup." },
        { term: "bps (basis points)", description: "A rate stored as a whole number of hundredths of a percent, so `1000` is 10 % and `1250` is 12.5 %. Used because 12.5 % cannot be stored exactly as a decimal." },
        { term: "Minor units", description: "Money is stored as whole tetri (or cents), never as a decimal of lari. The panel shows lari and converts for you; when a form asks for an amount in lari, `12.50` is what you type." },
      ],
    },
    {
      type: "heading",
      id: "channels",
      text: "Channels and suppliers",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Trade / B2B",
          description: "Sales to partners — agencies and other companies signed in to the partner portal. Everything is on the trade channel by default once published.",
        },
        {
          term: "Public sale / B2C",
          description: "Sales to anonymous visitors on the public site. A separate switch on each hotel, tour, package, service and vehicle class; off by default.",
        },
        {
          term: "Supplier, partner, provider",
          description: "A supplier is the company that delivers the product. In the panel every supplier is registered as a partner. A transfer supplier is a partner that also has a provider record, which is what vehicle classes, cars and drivers hang off — hence \"add the supplier as a partner first\".",
        },
        {
          term: "Vehicle class and fleet car",
          description: "A vehicle class is what is sold — Economy, Comfort, Minivan and so on, with a seat count, a bag count and a fallback fare. A fleet car is a physical vehicle with a plate, sold as one class and driven by the drivers linked to it.",
        },
        {
          term: "Curated fare and distance engine",
          description: "A curated fare is a price typed into a route's grid for one class and direction. Where a route has no curated fare for a class, the distance engine prices it from the class's per-kilometre rate, minimum fare and airport fee, using the distance between the two pick-up points' pins.",
        },
      ],
    },
    {
      type: "heading",
      id: "statuses",
      text: "Product statuses and publishing",
    },
    {
      type: "definitions",
      items: [
        { term: "Draft", description: "Being set up. Invisible everywhere, including search." },
        { term: "On sale", description: "Published — visible in search and bookable on the trade channel, and on the public channel if that switch is on." },
        { term: "Off sale", description: "Temporarily withdrawn with **Take off sale**. Still editable, invisible to buyers, and can be published again." },
        { term: "Archived", description: "Closed permanently. Bookings against it remain readable, but the record cannot be edited or put back on sale. A transfer route is the exception: it can be restored as a draft." },
        { term: "Publish checklist", description: "The list of what a product still lacks before it can go on sale, shown in the Publishing panel of its hub. **Publish** stays disabled until the list is empty." },
        { term: "Slug", description: "The last part of a public address, such as `/hotels/rooms-tbilisi`. Lowercase letters, numbers and hyphens. Changing it breaks every link already shared, because there is no redirect from the old one." },
        { term: "Editorial image and uploaded cover", description: "An editorial image is a path to a picture already on the site, typed into the details screen. An uploaded cover is one of the gallery images marked as the cover. Once anything is uploaded, the uploaded cover wins." },
      ],
    },
    {
      type: "heading",
      id: "kosher",
      text: "Kosher",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Kosher level",
          description: "A hotel's declared level of kosher service: `NONE`, `ON_REQUEST`, `KOSHER_FRIENDLY`, `PARTIAL` or `FULL`. A hotel at `PARTIAL` or `FULL` cannot be published until it holds a verified certificate.",
        },
        {
          term: "Certified",
          description: "Not a box anybody ticks. A hotel is certified when it holds a verified, unexpired certificate whose scope is the whole property or the kitchen. A restaurant-only or Passover-only certificate does not make it certified, and editing a verified certificate withdraws its verification.",
        },
      ],
    },
    {
      type: "heading",
      id: "operations",
      text: "Dispatch and the network",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Verification (driver)",
          description: "The recorded result of checking a driver: not checked, checks in progress, verified or rejected. `VERIFIED` is what a partner sees as a tick. Offering a job to an unverified driver needs an override.",
        },
        {
          term: "Override (dispatch)",
          description: "Your recorded say-so to assign against one of the rules the Assign dialog enforces — an unverified driver, a car of a different class from the one booked, or a car the driver does not usually take. Each override used is stored on the assignment and audited.",
        },
        {
          term: "Block (schedule)",
          description: "A window in a driver's or a car's diary during which dispatch will not offer them a job — a day off, sickness, a service. Refused while a job already sits inside the window.",
        },
        {
          term: "Closed dates (route)",
          description: "A window during which a transfer route is removed from search — a mountain road shut for the season. Both dates are inclusive. Also called a blackout.",
        },
        {
          term: "Audit trail",
          description: "The record of who did what and when, written in the same transaction as the change. A partner's audit trail is shown as **History** on its page and survives the partner's deletion; the transfer actions, driver verifications and rating decisions are audited too.",
        },
        {
          term: "Outbox",
          description: "Emails and in-app notices are not sent from the button you press. They are queued and a background job sends them a few seconds later, retrying on failure — so a message can arrive shortly after the screen has already said the action is done.",
        },
      ],
    },
  ],
} satisfies HelpArticle;
