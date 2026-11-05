"use client";

import { BedDouble, Boxes, CarFront, Compass, ConciergeBell, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { HotelSearchPanel } from "./HotelSearchPanel";
import { PackageQuotePanel } from "./PackageQuotePanel";
import { ServicePickPanel } from "./ServicePickPanel";
import { TourSearchPanel } from "./TourSearchPanel";
import { TransferQuotePanel } from "./TransferQuotePanel";
import { stepCardClass, type StepProps } from "./wizard";
import { formatStay, formatStayDate } from "@/lib/admin/bookings";
import {
  WIZARD_MAX_ITEMS,
  isCartBooking,
  labelOf,
  mixedCurrencies,
  wizardProductLabels,
  type ServiceSelection,
  type WizardProduct,
} from "@/lib/admin/manualBooking";
import { formatServiceDates } from "@/lib/admin/services";
import { formatDeparture } from "@/lib/admin/tours";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Step 2: what is being booked.
 *
 * One tab per product, each a search made as the buyer — a partner's own
 * prices and product access apply through `X-Act-As-Partner` — and the
 * chosen offer's token is what the booking carries. One line goes to its
 * product's own route; several lines, or a package, are booked as one
 * CUSTOM order (the cart at the desk), and the Review step prices them
 * together.
 */

const TABS: { value: WizardProduct; icon: LucideIcon }[] = [
  { value: "HOTEL", icon: BedDouble },
  { value: "TRANSFER", icon: CarFront },
  { value: "TOUR", icon: Compass },
  { value: "SERVICE", icon: ConciergeBell },
  { value: "PACKAGE", icon: Boxes },
];

/** One line that says what was chosen, for the chip here and the Review step. */
export function describeSelection(selection: ServiceSelection): { title: string; detail: string } {
  switch (selection.product) {
    case "HOTEL":
      return {
        title: labelOf(selection),
        detail: `${selection.ratePlanName} · ${formatStay(selection.checkIn, selection.checkOut, selection.nights)} · ${selection.rooms} ${
          selection.rooms === 1 ? "room" : "rooms"
        }, ${selection.adults} ${selection.adults === 1 ? "adult" : "adults"}${
          selection.childAges.length > 0 ? `, ${selection.childAges.length} ${selection.childAges.length === 1 ? "child" : "children"}` : ""
        }`,
      };
    case "TRANSFER":
      return {
        title: labelOf(selection),
        detail: `${selection.vehicleName} · ${selection.tripType === "RETURN" ? "return" : "one way"} · ${formatStayDate(
          selection.pickupAt.slice(0, 10),
        )} · ${selection.passengers} ${selection.passengers === 1 ? "passenger" : "passengers"}`,
      };
    case "TOUR":
      return {
        title: labelOf(selection),
        detail: `${formatDeparture(selection.date, selection.endDate)} · ${selection.adults} ${selection.adults === 1 ? "adult" : "adults"}${
          selection.childAges.length > 0 ? `, ${selection.childAges.length} ${selection.childAges.length === 1 ? "child" : "children"}` : ""
        }`,
      };
    case "SERVICE":
      return {
        title: labelOf(selection),
        detail: `${formatServiceDates(selection.date, selection.date, selection.days)}${selection.time ? ` at ${selection.time}` : ""} · ${
          selection.pax
        } ${selection.pax === 1 ? "person" : "people"} · qty ${selection.quantity}`,
      };
    case "PACKAGE":
      return {
        title: labelOf(selection),
        detail: `${formatStayDate(selection.startDate)} – ${formatStayDate(selection.endDate)} · ${selection.components.length} ${
          selection.components.length === 1 ? "component" : "components"
        } · ${selection.adults} ${selection.adults === 1 ? "adult" : "adults"}${
          selection.childAges.length > 0 ? `, ${selection.childAges.length} ${selection.childAges.length === 1 ? "child" : "children"}` : ""
        }`,
      };
  }
}

export function ServiceStep({ state, setState, errors, clearError }: StepProps) {
  const [tab, setTab] = useState<WizardProduct>(state.items[state.items.length - 1]?.product ?? "HOTEL");
  // The pickers show until something is chosen, and again on "Add another".
  const [adding, setAdding] = useState(false);
  const asPartnerId = state.buyer.mode === "PARTNER" && state.buyer.partnerId ? state.buyer.partnerId : null;

  const choose = (selection: ServiceSelection) => {
    clearError("selection");
    setState((current) => ({ ...current, items: [...current.items, selection] }));
    setAdding(false);
  };

  const remove = (index: number) => {
    clearError("selection");
    clearError(`items.${index}`);
    setState((current) => ({ ...current, items: current.items.filter((_, at) => at !== index) }));
  };

  const picking = state.items.length === 0 || adding;
  const full = state.items.length >= WIZARD_MAX_ITEMS;
  const mixed = mixedCurrencies(state.items);
  const cart = isCartBooking(state);

  return (
    <div className="flex flex-col gap-4">
      {asPartnerId ? (
        <p className="text-[0.8125rem] text-muted">
          Searching as <span className="font-medium text-ink">{state.buyer.partnerLabel ?? "the partner"}</span>: the prices and the inventory
          are theirs.
        </p>
      ) : (
        <p className="text-[0.8125rem] text-muted">Searching as the desk: trade inventory at the default markup.</p>
      )}

      {state.items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Chosen">
          {state.items.map((selection, index) => {
            const chosen = describeSelection(selection);
            const problem = errors[`items.${index}`];
            return (
              <li
                key={index}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-sm border px-4 py-3",
                  problem ? "border-error/60 bg-error/5" : "border-brand bg-brand-soft",
                )}
              >
                <div className="min-w-0">
                  <p className={cn("text-[0.75rem] font-semibold tracking-wide uppercase", problem ? "text-error-text" : "text-brand-text")}>
                    {wizardProductLabels[selection.product]}
                    {state.items.length > 1 ? ` · line ${index + 1}` : " chosen"}
                  </p>
                  <p className="text-[0.875rem] font-medium text-ink">{chosen.title}</p>
                  <p className="text-[0.75rem] text-muted">{chosen.detail}</p>
                  {selection.product === "PACKAGE" && (
                    <ul className="mt-1 text-[0.75rem] text-muted">
                      {selection.components.map((component) => (
                        <li key={component.slotIndex}>
                          {component.label}: {component.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                  {problem && (
                    <p role="alert" className="mt-1 text-[0.75rem] font-medium text-error-text">
                      {problem}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[0.9375rem] font-semibold text-ink tabular-nums">{formatMoney(selection.totalCents, selection.currency)}</span>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label={`Remove ${chosen.title}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[0.8125rem] font-medium text-muted hover:border-error hover:text-error-text"
                  >
                    <Trash2 size={14} aria-hidden />
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {state.items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.8125rem] text-muted">
            {cart
              ? `${state.items.length === 1 ? "A package is" : `These ${state.items.length} lines are`} booked as one order, with one approval and one invoice.`
              : "One line: booked on its own register."}
            {mixed.length > 0 && <span className="block text-error-text">One booking settles in one currency; these are in {mixed.join(" and ")}.</span>}
          </p>
          {!picking && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={full}
              title={full ? `One booking takes up to ${WIZARD_MAX_ITEMS} items.` : undefined}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-ink/20 px-3 text-[0.8125rem] font-semibold text-ink hover:border-ink disabled:pointer-events-none disabled:opacity-50"
            >
              <Plus size={14} aria-hidden />
              Add another
            </button>
          )}
        </div>
      )}

      {errors.selection && (
        <p role="alert" className="text-[0.8125rem] text-error-text">
          {errors.selection}
        </p>
      )}

      {picking && (
        <>
          <div role="tablist" aria-label="Product" className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-[0.8125rem] font-medium transition-colors",
                  tab === value ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                <Icon size={15} aria-hidden />
                {wizardProductLabels[value]}
              </button>
            ))}
            {adding && (
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="ms-auto self-center text-[0.8125rem] font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Cancel
              </button>
            )}
          </div>

          <div className={stepCardClass} role="tabpanel">
            {tab === "HOTEL" && <HotelSearchPanel asPartnerId={asPartnerId} onChoose={choose} />}
            {tab === "TRANSFER" && <TransferQuotePanel asPartnerId={asPartnerId} onChoose={choose} />}
            {tab === "TOUR" && <TourSearchPanel asPartnerId={asPartnerId} onChoose={choose} />}
            {tab === "SERVICE" && <ServicePickPanel asPartnerId={asPartnerId} onChoose={choose} />}
            {tab === "PACKAGE" && <PackageQuotePanel asPartnerId={asPartnerId} onChoose={choose} />}
          </div>
        </>
      )}
    </div>
  );
}
