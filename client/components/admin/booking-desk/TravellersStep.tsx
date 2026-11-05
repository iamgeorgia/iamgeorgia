"use client";

import { Plus, Trash2 } from "lucide-react";

import { stepCardClass, type StepProps } from "./wizard";
import { SelectInput, TextArea, TextInput } from "@/components/admin/FormControls";
import { GUEST_TITLES, guestTitleLabels } from "@/lib/admin/bookings";
import { hasProduct, singleSelection, type PersonState, type TravellerState } from "@/lib/admin/manualBooking";
import type { BookingGuestType, GuestTitle } from "@/types/booking";

/**
 * Step 3: who is travelling.
 *
 * The lead is the person the voucher and the invoice are addressed to —
 * prefilled from the customer where one was chosen. The others are named
 * for the supplier's manifest; a child's age is what the room or the seat
 * was priced for. Transfers add the flight per leg and the doors; tours a
 * pick-up note. With several lines the sections follow the products in the
 * list: the flights and doors go on every transfer (and a package's), the
 * pick-up note on every tour.
 */

const TYPE_OPTIONS: { value: BookingGuestType; label: string }[] = [
  { value: "ADULT", label: "Adult" },
  { value: "CHILD", label: "Child" },
  { value: "INFANT", label: "Infant" },
];

const TITLE_OPTIONS: { value: GuestTitle | ""; label: string }[] = [
  { value: "", label: "—" },
  ...GUEST_TITLES.map((title) => ({ value: title, label: guestTitleLabels[title] })),
];

export function TravellersStep({ state, setState, errors, clearError }: StepProps) {
  const single = singleSelection(state);
  const product = single?.product;
  const cart = single === null;
  const { lead, extras } = state.travellers;

  const setLead = (key: keyof PersonState, value: string) => {
    clearError(`lead.${key}`);
    setState((current) => ({ ...current, travellers: { ...current.travellers, lead: { ...current.travellers.lead, [key]: value } } }));
  };

  const setField = (key: "specialRequests" | "flightOutbound" | "flightReturn" | "pickupAddress" | "dropoffAddress" | "pickupNote", value: string) => {
    clearError(key);
    setState((current) => ({ ...current, travellers: { ...current.travellers, [key]: value } }));
  };

  const setExtra = (index: number, key: keyof TravellerState, value: string) => {
    clearError(`extras.${index}.${key}`);
    setState((current) => ({
      ...current,
      travellers: {
        ...current.travellers,
        extras: current.travellers.extras.map((entry, at) => (at === index ? { ...entry, [key]: value } : entry)),
      },
    }));
  };

  const addExtra = () =>
    setState((current) => ({
      ...current,
      travellers: { ...current.travellers, extras: [...current.travellers.extras, { title: "", firstName: "", lastName: "", type: "ADULT", age: "" }] },
    }));

  const removeExtra = (index: number) =>
    setState((current) => ({
      ...current,
      travellers: { ...current.travellers, extras: current.travellers.extras.filter((_, at) => at !== index) },
    }));

  const extrasLabel =
    product === "HOTEL" ? "Other guests" : product === "TOUR" || (cart && hasProduct(state, "HOTEL", "TOUR", "PACKAGE")) ? "Other travellers" : null;
  const isReturn = state.items.some((item) => item.product === "TRANSFER" && item.tripType === "RETURN");
  const hasTransfer = cart ? hasProduct(state, "TRANSFER", "PACKAGE") : product === "TRANSFER";
  const hasTour = cart ? hasProduct(state, "TOUR") : product === "TOUR";

  return (
    <div className="flex flex-col gap-5">
      <section className={stepCardClass}>
        <h3 className="text-[0.9375rem] font-semibold text-ink">{product === "TRANSFER" ? "Lead passenger" : product === "TOUR" ? "Lead traveller" : "Lead guest"}</h3>
        <p className="mt-1 text-[0.8125rem] text-muted">The person the voucher and the invoice are addressed to.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {product !== "SERVICE" && (
            <SelectInput label="Title" value={lead.title} onChange={(event) => setLead("title", event.target.value)} options={TITLE_OPTIONS} />
          )}
          <TextInput label="First name" required value={lead.firstName} onChange={(event) => setLead("firstName", event.target.value)} error={errors["lead.firstName"]} />
          <TextInput label="Last name" required value={lead.lastName} onChange={(event) => setLead("lastName", event.target.value)} error={errors["lead.lastName"]} />
          <TextInput label="Email" type="email" required value={lead.email} onChange={(event) => setLead("email", event.target.value)} error={errors["lead.email"]} />
          <TextInput label="Phone" type="tel" value={lead.phone} onChange={(event) => setLead("phone", event.target.value)} error={errors["lead.phone"]} />
        </div>
      </section>

      {extrasLabel && (
        <section className={stepCardClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[0.9375rem] font-semibold text-ink">{extrasLabel}</h3>
              <p className="mt-1 text-[0.8125rem] text-muted">Named for the supplier. The age of a child is what the price was computed for.</p>
            </div>
            <button
              type="button"
              onClick={addExtra}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-ink/20 px-3 text-[0.8125rem] font-semibold text-ink hover:border-ink"
            >
              <Plus size={14} aria-hidden />
              Add
            </button>
          </div>

          {extras.length === 0 ? (
            <p className="mt-4 text-[0.8125rem] text-subtle">Nobody else named yet.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {extras.map((traveller, index) => (
                <li key={index} className="grid gap-3 rounded-sm border border-line p-3 sm:grid-cols-2 lg:grid-cols-[6rem_1fr_1fr_7rem_5rem_auto] lg:items-end">
                  <SelectInput label="Title" value={traveller.title} onChange={(event) => setExtra(index, "title", event.target.value)} options={TITLE_OPTIONS} />
                  <TextInput label="First name" value={traveller.firstName} onChange={(event) => setExtra(index, "firstName", event.target.value)} error={errors[`extras.${index}.firstName`]} />
                  <TextInput label="Last name" value={traveller.lastName} onChange={(event) => setExtra(index, "lastName", event.target.value)} error={errors[`extras.${index}.lastName`]} />
                  <SelectInput label="Type" value={traveller.type} onChange={(event) => setExtra(index, "type", event.target.value)} options={TYPE_OPTIONS} />
                  <TextInput
                    label="Age"
                    inputMode="numeric"
                    value={traveller.age}
                    disabled={traveller.type === "ADULT"}
                    onChange={(event) => setExtra(index, "age", event.target.value)}
                    error={errors[`extras.${index}.age`]}
                  />
                  <button
                    type="button"
                    onClick={() => removeExtra(index)}
                    aria-label={`Remove traveller ${index + 1}`}
                    className="inline-flex h-10 items-center justify-center rounded-sm border border-line px-3 text-muted hover:border-error hover:text-error-text"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {hasTransfer && (
        <section className={stepCardClass}>
          <h3 className="text-[0.9375rem] font-semibold text-ink">Flights and doors</h3>
          <p className="mt-1 text-[0.8125rem] text-muted">
            The driver meets the flight and finds the door; the invoice prints the flight per leg.
            {cart ? " They go on every transfer in this booking, and on a package's transfer." : ""}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextInput label="Outbound flight" placeholder="TK 384" value={state.travellers.flightOutbound} onChange={(event) => setField("flightOutbound", event.target.value)} error={errors.flightOutbound} mono />
            {isReturn && (
              <TextInput label="Return flight" placeholder="TK 385" value={state.travellers.flightReturn} onChange={(event) => setField("flightReturn", event.target.value)} error={errors.flightReturn} mono />
            )}
            <TextInput label="Pick-up address" value={state.travellers.pickupAddress} onChange={(event) => setField("pickupAddress", event.target.value)} error={errors.pickupAddress} />
            <TextInput label="Drop-off address" value={state.travellers.dropoffAddress} onChange={(event) => setField("dropoffAddress", event.target.value)} error={errors.dropoffAddress} />
          </div>
        </section>
      )}

      <section className={stepCardClass}>
        <div className="grid gap-4 sm:grid-cols-2">
          {hasTour && (
            <TextInput
              label="Pick-up note"
              hint={cart ? "Where the operator collects the party. Goes on every tour in this booking." : "Where the operator collects the party."}
              value={state.travellers.pickupNote}
              onChange={(event) => setField("pickupNote", event.target.value)}
              error={errors.pickupNote}
            />
          )}
          <TextArea
            label={product === "SERVICE" ? "Notes for the supplier" : "Special requests"}
            hint="Passed to the supplier as written."
            rows={3}
            value={state.travellers.specialRequests}
            onChange={(event) => setField("specialRequests", event.target.value)}
            error={errors.specialRequests}
            className={hasTour ? undefined : "sm:col-span-2"}
          />
        </div>
      </section>
    </div>
  );
}
