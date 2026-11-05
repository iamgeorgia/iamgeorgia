"use client";

import { Building2, Handshake, UserPlus, UserRound } from "lucide-react";
import { useRef } from "react";

import { stepCardClass, type StepProps } from "./wizard";
import { CustomerFields, type CustomerFormErrors } from "@/components/admin/CustomerForm";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { customerKindLabels } from "@/lib/admin/customers";
import { leadFromCustomer, type BuyerMode } from "@/lib/admin/manualBooking";
import { listCustomersClient } from "@/lib/api/customers";
import { listPartnersClient } from "@/lib/api/partners";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types/customer";

/**
 * Step 1: who the booking is for.
 *
 * A partner (its own prices, product access, commission and credit apply,
 * and the search on the next step is made as that partner), an existing
 * customer, or a customer described here and now — created first, outside
 * the booking's transaction, so a refused booking still leaves the customer
 * to try again with.
 */

const MODES: { value: BuyerMode; label: string; icon: typeof Handshake; hint: string }[] = [
  { value: "PARTNER", label: "Existing partner", icon: Handshake, hint: "Booked as the agency: its prices and credit apply." },
  { value: "CUSTOMER", label: "Existing customer", icon: UserRound, hint: "Someone the desk has booked for before." },
  { value: "NEW_CUSTOMER", label: "New customer", icon: UserPlus, hint: "A person or company with no account yet." },
];

export function BuyerStep({ state, setState, errors, clearError }: StepProps) {
  // The customers the picker has shown, so choosing one can prefill the lead
  // without a second request.
  const seen = useRef(new Map<string, Customer>());

  const searchPartners = async (term: string): Promise<PickerOption[]> => {
    const found = await listPartnersClient({ q: term || undefined, status: "APPROVED", pageSize: 10 });
    return found.data.map((partner) => ({ id: partner.id, label: partner.name, meta: partner.city ? `${partner.reference} · ${partner.city}` : partner.reference }));
  };

  const searchCustomers = async (term: string): Promise<PickerOption[]> => {
    const found = await listCustomersClient({ q: term || undefined, pageSize: 10 });
    for (const customer of found.data) seen.current.set(customer.id, customer);
    return found.data.map((customer) => ({
      id: customer.id,
      label: customer.name,
      meta: customer.email,
      badge: customer.kind === "COMPANY" ? "Company" : null,
    }));
  };

  const setMode = (mode: BuyerMode) => {
    clearError("buyer.partnerId");
    clearError("buyer.customerId");
    setState((current) => ({ ...current, buyer: { ...current.buyer, mode } }));
  };

  const customerErrors: CustomerFormErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith("newCustomer."))
      .map(([key, message]) => [key.slice("newCustomer.".length), message]),
  );

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Who is the booking for" className="grid gap-3 sm:grid-cols-3">
        {MODES.map((mode) => {
          const on = state.buyer.mode === mode.value;
          const Icon = mode.icon;
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(mode.value)}
              className={cn(
                "flex items-start gap-3 rounded-sm border p-4 text-start transition-colors",
                on ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-ink",
              )}
            >
              <Icon size={18} aria-hidden className={cn("mt-0.5 shrink-0", on ? "text-brand-text" : "text-muted")} />
              <span>
                <span className={cn("block text-[0.875rem] font-semibold", on ? "text-brand-text" : "text-ink")}>{mode.label}</span>
                <span className="mt-0.5 block text-[0.75rem] leading-snug text-muted">{mode.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className={stepCardClass}>
        {state.buyer.mode === "PARTNER" && (
          <EntityPicker
            label="Partner"
            hint="Approved partners only. The search on the next step is made as this partner, at its prices."
            error={errors["buyer.partnerId"]}
            value={state.buyer.partnerId}
            valueLabel={state.buyer.partnerLabel}
            onChange={(choice) => {
              clearError("buyer.partnerId");
              setState((current) => ({
                ...current,
                buyer: { ...current.buyer, partnerId: choice?.id ?? "", partnerLabel: choice?.label ?? null },
                // An offer is priced for the buyer it was searched for.
                items: choice?.id === current.buyer.partnerId ? current.items : [],
              }));
            }}
            search={searchPartners}
            placeholder="Search partners by name or reference"
            clearLabel="No partner"
          />
        )}

        {state.buyer.mode === "CUSTOMER" && (
          <EntityPicker
            label="Customer"
            hint="The lead traveller on the next steps starts from this customer's details."
            error={errors["buyer.customerId"]}
            value={state.buyer.customerId}
            valueLabel={state.buyer.customerLabel}
            onChange={(choice) => {
              clearError("buyer.customerId");
              const customer = choice ? seen.current.get(choice.id) : undefined;
              setState((current) => ({
                ...current,
                buyer: { ...current.buyer, customerId: choice?.id ?? "", customerLabel: choice?.label ?? null },
                items: current.buyer.partnerId ? [] : current.items,
                travellers:
                  customer && !current.travellers.lead.firstName && !current.travellers.lead.email
                    ? { ...current.travellers, lead: leadFromCustomer(customer) }
                    : current.travellers,
              }));
            }}
            search={searchCustomers}
            placeholder="Search customers by name, email or phone"
            clearLabel="No customer"
          />
        )}

        {state.buyer.mode === "NEW_CUSTOMER" && (
          <>
            <p className="mb-4 flex items-center gap-2 text-[0.8125rem] text-muted">
              {state.buyer.newCustomer.kind === "COMPANY" ? <Building2 size={14} aria-hidden /> : <UserRound size={14} aria-hidden />}
              {customerKindLabels[state.buyer.newCustomer.kind]} — created when the booking is made, and kept even if the booking is refused.
            </p>
            <CustomerFields
              compact
              values={state.buyer.newCustomer}
              errors={customerErrors}
              onChange={(next) => {
                for (const key of Object.keys(customerErrors)) clearError(`newCustomer.${key}`);
                setState((current) => ({ ...current, buyer: { ...current.buyer, newCustomer: next } }));
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
