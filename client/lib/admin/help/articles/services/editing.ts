import type { HelpArticle } from "../../types";

/**
 * `/admin/services/[id]` — `ServiceEditor.tsx` over `ServiceFields.tsx`,
 * with `ServiceTranslationsEditor.tsx`, `ServiceActions.tsx` and
 * `ServiceDangerZone.tsx` on the same page. The fieldsets and their defaults;
 * the slug editable after create (the only entity where the UI allows it);
 * a fixed sell below net refused only in the browser; tabs ka/ru/he; Publish,
 * Take off sale, Archive (browser confirm, final); Delete two-step inline with
 * the `IN_PACKAGE` and `HAS_BOOKINGS` refusals; the three-item checklist.
 */
export const article = {
  id: "sv-editing",
  title: "Editing, translating, publishing and deleting a service",
  summary: "The one page a service has: its five fieldsets, its translations, the buttons that put it on and off sale, and the two reasons a delete is refused.",
  category: "services",
  routes: ["/admin/services/[id]"],
  keywords: ["edit service", "slug", "basis", "net", "fixed sell", "currency", "confirmation", "on request", "notice", "quantity", "cancellation terms", "kosher supervision", "certifying authority", "translation", "publish", "archive", "delete", "in package", "has bookings"],
  related: ["sv-services", "pk-parts", "pb-translations", "pb-slugs-and-seo", "rf-dangerous-actions"],
  blocks: [
    { type: "where", path: ["Sidebar", "Inventory", "Services", "[service]"] },
    {
      type: "paragraph",
      text: "Everything about a service lives on this one page: the fields, saved together with **Save service**; the translations; the **Publish**, **Take off sale** and **Archive** actions; and the delete panel at the bottom.",
    },
    { type: "heading", id: "fields", text: "The fields" },
    {
      type: "definitions",
      items: [
        {
          term: "What this service is",
          description:
            "**Name**; **Slug**; **Category** (seven, default **Kosher meal delivery**); **Destination**, where blank means **Anywhere**; **Supplier**, where blank means platform-operated; **Summary**, up to 600 characters.",
        },
        {
          term: "What a unit is, and what it costs",
          description:
            "**Priced** — **Per person**, **Per group**, **Per day** or **Per person, per day** — with the live explainer underneath; **Net per unit**; **Fixed sell per unit**, where blank means the partner's markup decides; **Currency**, default `GEL`.",
        },
        {
          term: "How it is booked",
          description:
            "**Confirmation** — **Instant**, or **On request**, whose hint reads **The booking is written PENDING and somebody has 48 hours to answer it.**; **Notice hours**, default 48; **Smallest quantity**, default 1, and **Largest quantity**, blank for no ceiling; **Cancellation terms**, required; **Time zone**; **Position** in lists.",
        },
        { term: "Kosher supervision", description: "A checkbox, and a **Certifying authority** that is cleared when the box is unticked." },
        { term: "The words", description: "**Description** (a blank line between paragraphs), **Included** one entry per line, and **Sell to the public (B2C)**." },
      ],
    },
    {
      type: "callout",
      tone: "warning",
      title: "The slug is editable here",
      text: "A service is the only entity whose slug can be changed from the panel after it is created. There is no redirect from the old address, so changing it breaks every link already shared.",
    },
    {
      type: "callout",
      tone: "info",
      text: "A fixed sell below the net is refused by the form — **A fixed sell price below the net sells the service at a loss.** — but only by the form. The server accepts it, so anything writing through the API directly can still sell at a loss.",
    },
    { type: "heading", id: "translations", text: "Translations" },
    {
      type: "paragraph",
      text: "Three tabs — `ka`, `ru`, `he` — each with **Name**, **Summary**, **Description** and **Included**, saved per tab. English is the base and cannot be translated into; a field left blank shows the English on the public page.",
    },
    { type: "heading", id: "publish", text: "Publishing, taking off sale, archiving" },
    {
      type: "steps",
      items: [
        "Clear the checklist: a summary, a net price above 0 and cancellation terms chosen.",
        "Press **Publish**. The page reads **Published. Packages can sell it.** and the service is `ACTIVE`.",
        "**Take off sale** makes it `INACTIVE`; package slots that name it stop resolving until it is published again.",
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Archive is final",
      text: "The browser asks once — **Archive … ? Packages that name it stop selling it.** — and then the service is `ARCHIVED`. The page then reads that archiving is final: the service cannot be edited or put back on sale, and there is no restore button because no such transition exists.",
    },
    { type: "heading", id: "delete", text: "Deleting" },
    {
      type: "paragraph",
      text: "The delete panel is two-step: **Delete service**, then **Delete permanently** or **Cancel**. The server refuses in two distinct cases and the page words each differently.",
    },
    {
      type: "table",
      columns: ["Refusal", "What the page says", "What to do"],
      rows: [
        ["`IN_PACKAGE`", "A package still has a slot pointing at this service. Remove that slot first, then delete.", "Open the package's **Parts**, drop the slot, save, and try again."],
        ["`HAS_BOOKINGS`", "Archive it instead — that takes it off sale without destroying anything.", "Use **Archive**; the bookings stay readable."],
      ],
    },
    {
      type: "callout",
      tone: "danger",
      title: "Delete permanently means it",
      text: "A service with no package slot and no booking is gone on the second click, with nothing to restore it from.",
    },
    {
      type: "links",
      items: [
        { label: "Services register and creating one", articleId: "sv-services" },
        { label: "Parts (slots)", articleId: "pk-parts" },
      ],
    },
  ],
} satisfies HelpArticle;
