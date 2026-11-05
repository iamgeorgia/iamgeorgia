"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { describeSelection } from "./ServiceStep";
import { stepCardClass, type StepProps } from "./wizard";
import { AdminDefinitionList } from "@/components/admin/AdminPage";
import { guestTitleLabel } from "@/lib/admin/bookings";
import { customerKindLabels } from "@/lib/admin/customers";
import {
  adjustmentCentsFrom,
  cartItemsOf,
  hasProduct,
  isCartBooking,
  manualChannelLabels,
  singleSelection,
  wizardCatalogueCents,
  wizardCurrency,
  wizardProductLabels,
  wizardTotalCents,
  type ServiceSelection,
} from "@/lib/admin/manualBooking";
import { describeError } from "@/lib/api/client";
import { quoteDeskCart } from "@/lib/api/manualBookings";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CustomOrderItemInput, CustomOrderQuote, CustomOrderQuoteItem } from "@/types/order";

/**
 * Step 5: everything read back before it is sent. Each block names the step
 * it came from, so a wrong detail is one click from its field.
 *
 * A cart — several lines, or a package — is priced here by
 * `POST /orders/custom/quote`: every line's price today, a package's lines
 * under their package, and the combined total. A line whose price moved
 * shows both figures; a line that went can be removed on the spot, and the
 * quote runs again. One product keeps the figure its search gave.
 */
export function ReviewStep({
  state,
  setState,
  onEdit,
  refreshKey = 0,
}: Pick<StepProps, "state" | "setState"> & {
  onEdit: (step: 0 | 1 | 2 | 3) => void;
  /** Bumped by the wizard to price the cart again (after a PRICE_CHANGED refusal). */
  refreshKey?: number;
}) {
  const { buyer, items, travellers, terms } = state;
  const currency = wizardCurrency(state);
  const cart = isCartBooking(state);
  const single = singleSelection(state);
  const adjustment = adjustmentCentsFrom(terms.adjustmentAmount, currency);

  const [bump, setBump] = useState(0);
  // The last answer, stamped with the request that produced it: the quote
  // shows while its lines are the current ones, and "pricing" is the gap
  // between the request the screen wants and the one it has.
  const [answer, setAnswer] = useState<{ requestKey: string; itemsKey: string; quote: CustomOrderQuote | null; error: string | null }>({
    requestKey: "",
    itemsKey: "",
    quote: null,
    error: null,
  });

  // The lines as the server will see them: the effect keys on their content,
  // not on the state object, so a keystroke on nothing the cart carries does
  // not ask the server again.
  const itemsKey = useMemo(() => (cart ? JSON.stringify(cartItemsOf(state)) : ""), [cart, state]);
  const asPartnerId = buyer.mode === "PARTNER" && buyer.partnerId ? buyer.partnerId : null;
  const lead = travellers.lead;
  const leadKey = `${lead.firstName.trim()}|${lead.lastName.trim()}|${lead.email.trim()}`;
  const requestKey = itemsKey ? `${itemsKey}|${leadKey}|${asPartnerId ?? ""}|${refreshKey}|${bump}` : "";

  useEffect(() => {
    if (!requestKey) return;
    let stale = false;
    const [firstName, lastName, email] = leadKey.split("|");
    quoteDeskCart(
      {
        items: JSON.parse(itemsKey) as CustomOrderItemInput[],
        ...(firstName && lastName && email ? { leadGuest: { firstName, lastName, email } } : {}),
      },
      { asPartnerId },
    )
      .then((found) => {
        if (!stale) setAnswer({ requestKey, itemsKey, quote: found, error: null });
      })
      .catch((caught: unknown) => {
        if (!stale) {
          setAnswer({ requestKey, itemsKey, quote: null, error: describeError(caught, "The lines could not be priced. The figures below are from the searches.") });
        }
      });
    return () => {
      stale = true;
    };
  }, [requestKey, itemsKey, leadKey, asPartnerId]);

  const quote = cart && answer.itemsKey === itemsKey ? answer.quote : null;
  const quoteError = cart && answer.itemsKey === itemsKey ? answer.error : null;
  const quoting = cart && answer.requestKey !== requestKey;

  const remove = (index: number) => setState((current) => ({ ...current, items: current.items.filter((_, at) => at !== index) }));

  const buyerLine =
    buyer.mode === "PARTNER"
      ? `Partner · ${buyer.partnerLabel ?? buyer.partnerId}`
      : buyer.mode === "CUSTOMER"
        ? `Customer · ${buyer.customerLabel ?? buyer.customerId}`
        : `New ${customerKindLabels[buyer.newCustomer.kind].toLowerCase()} · ${buyer.newCustomer.name} (${buyer.newCustomer.email})`;

  const person = (title: string, first: string, last: string) => `${guestTitleLabel(title)}${first} ${last}`.trim();

  const block = (title: string, step: 0 | 1 | 2 | 3, items: { label: string; value: React.ReactNode }[], extra?: React.ReactNode) => (
    <section className={stepCardClass}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
        <button type="button" onClick={() => onEdit(step)} className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline">
          Edit
        </button>
      </div>
      {items.length > 0 && <AdminDefinitionList className="mt-3" items={items} />}
      {extra}
    </section>
  );

  // The figure the total reads: the quote's current prices for a cart, the search's for one product.
  const priced = quote?.available ? quote.totals.sellTotalCents : null;
  const catalogue = priced ?? wizardCatalogueCents(state);
  const total = wizardTotalCents(state, catalogue);
  const chosen = single ? describeSelection(single) : null;

  return (
    <div className="flex flex-col gap-5">
      {block("Buyer", 0, [{ label: "Booked for", value: buyerLine }])}

      {single
        ? block("Service", 1, [
            { label: "Product", value: wizardProductLabels[single.product] },
            { label: "What", value: chosen?.title ?? "—" },
            { label: "Details", value: chosen?.detail ?? "—" },
          ])
        : block(
            "Services",
            1,
            [],
            <CartLines
              items={items}
              quote={quote}
              quoting={quoting}
              error={quoteError}
              currency={currency}
              onRemove={remove}
              onRefresh={() => setBump((current) => current + 1)}
            />,
          )}

      {block("Travellers", 2, [
        {
          label: "Lead",
          value: `${person(travellers.lead.title, travellers.lead.firstName, travellers.lead.lastName)} · ${travellers.lead.email}${
            travellers.lead.phone ? ` · ${travellers.lead.phone}` : ""
          }`,
        },
        ...(travellers.extras.length > 0
          ? [
              {
                label: "Others",
                value: (
                  <span className="block text-start">
                    {travellers.extras.map((traveller, index) => (
                      <span key={index} className="block">
                        {person(traveller.title, traveller.firstName, traveller.lastName)}
                        <span className="text-muted">
                          {" "}
                          · {traveller.type.toLowerCase()}
                          {traveller.type !== "ADULT" && traveller.age ? `, ${traveller.age}` : ""}
                        </span>
                      </span>
                    ))}
                  </span>
                ),
              },
            ]
          : []),
        ...(hasProduct(state, "TRANSFER", "PACKAGE")
          ? [
              { label: "Flights", value: [travellers.flightOutbound, travellers.flightReturn].filter(Boolean).join(" / ") || "—" },
              { label: "Doors", value: [travellers.pickupAddress, travellers.dropoffAddress].filter(Boolean).join(" → ") || "—" },
            ]
          : []),
        ...(hasProduct(state, "TOUR") && travellers.pickupNote ? [{ label: "Pick-up", value: travellers.pickupNote }] : []),
        ...(travellers.specialRequests ? [{ label: "Requests", value: travellers.specialRequests }] : []),
      ])}

      {block("Terms", 3, [
        { label: "Channel", value: terms.channel ? manualChannelLabels[terms.channel] : "—" },
        { label: "Manager", value: terms.assignedManagerLabel ?? "Nobody yet" },
        { label: "Confirmation", value: terms.confirmNow ? "Confirmed at once" : "Waits in the approvals queue" },
        ...(terms.internalNotes.trim() ? [{ label: "Internal notes", value: terms.internalNotes.trim() }] : []),
      ])}

      <section className={stepCardClass}>
        <h3 className="text-[0.9375rem] font-semibold text-ink">Total</h3>
        <AdminDefinitionList
          className="mt-3"
          items={[
            {
              label: priced !== null ? "Current price" : "Catalogue price",
              value: catalogue === null ? "—" : formatMoney(catalogue, currency),
            },
            ...(adjustment !== null
              ? [
                  {
                    label: adjustment < 0 ? "Discount" : "Supplement",
                    value: (
                      <span>
                        {formatMoney(adjustment, currency)}
                        {terms.adjustmentReason.trim() && <span className="block text-[0.75rem] font-normal text-muted">{terms.adjustmentReason.trim()}</span>}
                      </span>
                    ),
                  },
                ]
              : []),
            { label: "Buyer pays", value: <span className="text-[1rem]">{total === null ? "—" : formatMoney(total, currency)}</span> },
          ]}
        />
        {hasProduct(state, "SERVICE") && (
          <p className="mt-3 text-[0.75rem] text-subtle">
            {single ? "The service price is an estimate; the final total is set when the booking is made." : "A service's price is set when the booking is made."}
          </p>
        )}
        {cart && adjustment !== null && (
          <p className="mt-3 text-[0.75rem] text-subtle">The adjustment applies to the whole order and is spread over its standalone lines by the server.</p>
        )}
      </section>
    </div>
  );
}

// --- the cart's lines ---------------------------------------------------------

/** The quote's lines by the position of the item that produced them. */
const linesByIndex = (quote: CustomOrderQuote | null): Map<number, CustomOrderQuoteItem[]> => {
  const map = new Map<number, CustomOrderQuoteItem[]>();
  if (!quote?.available) return map;
  for (const line of quote.items) map.set(line.index, [...(map.get(line.index) ?? []), line]);
  return map;
};

/** A package's lines arrive prefixed with its name; under its own heading that is noise. */
const lineLabel = (label: string, selection: ServiceSelection) =>
  selection.product === "PACKAGE" && label.startsWith(`${selection.packageName} · `) ? label.slice(selection.packageName.length + 3) : label;

function CartLines({
  items,
  quote,
  quoting,
  error,
  currency,
  onRemove,
  onRefresh,
}: {
  items: ServiceSelection[];
  quote: CustomOrderQuote | null;
  quoting: boolean;
  error: string | null;
  currency: string;
  onRemove: (index: number) => void;
  onRefresh: () => void;
}) {
  const lines = linesByIndex(quote);
  const gone = new Map(quote && !quote.available && quote.reason === "UNAVAILABLE" ? quote.items.map((entry) => [entry.index, entry]) : []);
  const mixed = quote && !quote.available && quote.reason === "MIXED_CURRENCY" ? quote.currencies : null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted" aria-live="polite">
          {quoting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Pricing the lines…
            </span>
          ) : quote?.available ? (
            quote.priceChanged ? (
              <span className="font-medium text-warning-text">A price has moved since the search. The current figures are shown.</span>
            ) : (
              `${items.length} ${items.length === 1 ? "line" : "lines"}, priced today.`
            )
          ) : mixed ? (
            <span className="font-medium text-error-text">One booking settles in one currency; these lines are in {mixed.join(" and ")}.</span>
          ) : gone.size > 0 ? (
            <span className="font-medium text-error-text">
              {gone.size === 1 ? "A line" : `${gone.size} lines`} can no longer be booked. Remove {gone.size === 1 ? "it" : "them"}, or search again.
            </span>
          ) : (
            (error ?? "Priced by the searches.")
          )}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={quoting}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[0.75rem] font-medium text-ink hover:border-ink disabled:opacity-50"
        >
          <RefreshCw size={12} className={cn(quoting && "animate-spin")} aria-hidden />
          Refresh prices
        </button>
      </div>

      <ul className={cn("mt-3 divide-y divide-line rounded-sm border border-line", quoting && "opacity-60 transition-opacity")}>
        {items.map((selection, index) => {
          const chosen = describeSelection(selection);
          const own = lines.get(index) ?? null;
          const went = gone.get(index) ?? null;
          const now = own ? own.reduce((sum, line) => sum + line.lineTotalCents, 0) : null;
          const moved = own?.some((line) => line.priceChanged) ?? false;
          return (
            <li key={index} className={cn("flex flex-col gap-2 px-4 py-3", went && "bg-error/5")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{wizardProductLabels[selection.product]}</p>
                  <p className="text-[0.875rem] font-medium text-ink">{chosen.title}</p>
                  <p className="text-[0.75rem] text-muted">{chosen.detail}</p>
                  {went && (
                    <p role="alert" className="mt-1 text-[0.75rem] font-medium text-error-text">
                      No longer available{went.reason ? ` (${went.reason.toLowerCase().replace(/_/g, " ")})` : ""}.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-end tabular-nums">
                    {now !== null && moved && (
                      <span className="block text-[0.75rem] text-muted line-through">{formatMoney(selection.totalCents, currency)}</span>
                    )}
                    <span className={cn("text-[0.9375rem] font-semibold", went ? "text-muted line-through" : "text-ink")}>
                      {formatMoney(now ?? selection.totalCents, currency)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {own && own.length > 1 && (
                <ul className="ms-4 border-s border-line ps-3 text-[0.75rem] text-muted">
                  {own.map((line) => (
                    <li key={line.slotIndex} className="flex items-baseline justify-between gap-3 py-0.5">
                      <span className="min-w-0 truncate">
                        {lineLabel(line.label, selection)}
                        {line.priceChanged && <span className="ms-1 text-warning-text">· moved</span>}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {line.adjustmentCents !== 0 ? `${formatMoney(line.currentCents, currency)} ${formatMoney(line.adjustmentCents, currency)} = ` : ""}
                        {formatMoney(line.lineTotalCents, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
