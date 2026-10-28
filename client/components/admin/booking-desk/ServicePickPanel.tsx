"use client";

import { useState } from "react";

import { chooseButtonClass } from "./wizard";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { FormError, NumberInput, TextInput } from "@/components/admin/FormControls";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import type { ServiceSelection } from "@/lib/admin/manualBooking";
import { confirmationModeLabels, serviceBasisHints, serviceBasisLabels, serviceCategoryLabels, serviceUnits } from "@/lib/admin/services";
import { listPublicServicesClient } from "@/lib/api/services";
import { formatMoney } from "@/lib/money";
import type { ServiceSummary } from "@/types/service";

/**
 * A service has no inventory to search: pick it, say when and for how many,
 * and the server prices it on confirmation. The figure shown here is an
 * estimate from the catalogue's unit price for this buyer; the booking's
 * own total is the server's.
 */
export function ServicePickPanel({
  asPartnerId,
  onChoose,
}: {
  asPartnerId: string | null;
  onChoose: (selection: ServiceSelection) => void;
}) {
  const today = todayISO();
  const [service, setService] = useState<ServiceSummary | null>(null);
  const [date, setDate] = useState(addDaysISO(today, 7));
  const [time, setTime] = useState("");
  const [days, setDays] = useState("1");
  const [quantity, setQuantity] = useState("1");
  const [pax, setPax] = useState("2");
  const [error, setError] = useState<string | null>(null);

  // The services the picker has shown, so choosing one keeps its price and basis.
  const [seen] = useState(() => new Map<string, ServiceSummary>());

  const searchServices = async (term: string): Promise<PickerOption[]> => {
    const found = await listPublicServicesClient({ search: term || undefined, pageSize: 10 }, { asPartnerId });
    for (const entry of found.data) seen.set(entry.id, entry);
    return found.data.map((entry) => ({
      id: entry.id,
      label: entry.name,
      meta: `${serviceCategoryLabels[entry.category]} · ${formatMoney(entry.unitPrice.amountCents, entry.unitPrice.currency)} ${serviceBasisLabels[entry.basis].toLowerCase()}`,
      badge: entry.isKosher ? "Kosher" : null,
    }));
  };

  const number = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const chosen = {
    days: number(days, 1),
    quantity: number(quantity, 1),
    pax: number(pax, 1),
  };

  const estimate = service ? service.unitPrice.amountCents * serviceUnits(service.basis, chosen.pax, chosen.days) * chosen.quantity : null;

  const choose = () => {
    if (!service) return setError("Choose a service first.");
    if (!date) return setError("Say when the service is for.");
    if (service.minQuantity > chosen.quantity || (service.maxQuantity !== null && chosen.quantity > service.maxQuantity)) {
      return setError(
        `This service is sold ${service.minQuantity}${service.maxQuantity !== null ? ` to ${service.maxQuantity}` : " or more"} at a time.`,
      );
    }
    setError(null);
    onChoose({
      product: "SERVICE",
      serviceId: service.id,
      serviceName: service.name,
      date,
      time,
      days: chosen.days,
      quantity: chosen.quantity,
      pax: chosen.pax,
      currency: service.unitPrice.currency,
      totalCents: estimate ?? 0,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EntityPicker
          label="Service"
          className="sm:col-span-2 lg:col-span-4"
          value={service?.id ?? ""}
          valueLabel={service?.name}
          onChange={(choice) => setService(choice ? (seen.get(choice.id) ?? null) : null)}
          search={searchServices}
          placeholder="Search services by name"
          clearLabel="No service"
          hint={
            service
              ? `${serviceBasisLabels[service.basis]}: ${serviceBasisHints[service.basis]} ${confirmationModeLabels[service.confirmationMode]}.`
              : undefined
          }
        />
        <TextInput label="Date" type="date" value={date} min={today} onChange={(event) => setDate(event.target.value)} />
        <TextInput label="Time" type="time" value={time} onChange={(event) => setTime(event.target.value)} hint="Optional." />
        <NumberInput label="Days" min={1} max={60} value={days} onChange={(event) => setDays(event.target.value)} />
        <NumberInput label="People" min={1} max={500} value={pax} onChange={(event) => setPax(event.target.value)} />
        <NumberInput
          label="Quantity"
          min={1}
          max={500}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          hint={service ? `Sold ${service.minQuantity}${service.maxQuantity !== null ? ` to ${service.maxQuantity}` : " or more"} at a time.` : undefined}
        />
      </div>

      <FormError message={error} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-4 py-3">
        <p className="text-[0.8125rem] text-muted">
          {service && estimate !== null ? (
            <>
              Estimated <span className="font-semibold text-ink tabular-nums">{formatMoney(estimate, service.unitPrice.currency)}</span> — the
              final total is set when the booking is made.
            </>
          ) : (
            "Pick a service to see its price."
          )}
        </p>
        <button type="button" onClick={choose} disabled={!service} className={chooseButtonClass}>
          Use this service
        </button>
      </div>
    </div>
  );
}
