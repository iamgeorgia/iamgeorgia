"use client";

import { Check, Clock, Languages, Phone, ShieldCheck, Star, UserRound } from "lucide-react";

import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { languageNames } from "@/lib/transfers/languages";
import type { AssignmentForPartner } from "@/types/driver";

/**
 * The driver a partner asked for, on the confirmation page.
 *
 * The same facts `DriverCard` shows in the portal, in the reader's language:
 * who, whether they have said yes yet, and the car to look for. The phone
 * number appears only when the server has put it in the data — accepted, and
 * close enough to the pick-up — so nothing here decides what to reveal.
 */
export function RequestedDriver({
  assignment,
  label,
}: {
  assignment: Pick<AssignmentForPartner, "status" | "driver" | "vehicle">;
  /** "Tbilisi Airport → Gudauri", when there is more than one leg. */
  label?: string;
}) {
  const { t, intlLocale } = useI18n();
  const copy = t.transfers.booking;
  const { driver, vehicle } = assignment;
  const awaiting = assignment.status !== "ACCEPTED";

  const photo = driver.photo?.variants.find((variant) => variant.variant === "card")?.url ?? driver.photo?.url;
  const carPhoto = vehicle?.mainImage?.variants.find((variant) => variant.variant === "card")?.url ?? vehicle?.mainImage?.url;

  return (
    <article className="rounded-sm border border-line bg-surface p-5">
      {label && <p className="type-caption text-muted">{label}</p>}

      <div className={label ? "mt-3 flex items-start gap-4" : "flex items-start gap-4"}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- API-served
          <img src={photo} alt="" className="size-16 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface-soft text-subtle">
            <UserRound size={24} aria-hidden />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[1rem] font-medium text-ink">
            {driver.firstName} {driver.lastName}
            {driver.verified && (
              <span className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-success">
                <ShieldCheck size={14} aria-hidden />
                {copy.driverVerified}
              </span>
            )}
          </p>

          <p className="type-body-sm mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            {driver.ratingCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Star size={13} className="text-accent-gold" aria-hidden fill="currentColor" />
                {fill(copy.driverRatings, { avg: driver.ratingAvg.toFixed(1), count: driver.ratingCount })}
              </span>
            ) : (
              <span>{copy.driverNoRatings}</span>
            )}
            {driver.languages.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Languages size={13} aria-hidden />
                {languageNames(driver.languages, intlLocale)}
              </span>
            )}
          </p>

          {vehicle && (
            <p className="type-body-sm mt-2 flex items-center gap-3 text-body">
              {carPhoto && (
                // eslint-disable-next-line @next/next/no-img-element -- API-served
                <img src={carPhoto} alt="" className="h-10 w-14 shrink-0 rounded-sm object-cover" />
              )}
              <span>
                {vehicle.make} {vehicle.model}
                {vehicle.colour ? `, ${vehicle.colour.toLowerCase()}` : ""}
                <span className="ms-2 font-mono text-[0.8125rem] tracking-wide text-muted">{vehicle.plateNumber}</span>
              </span>
            </p>
          )}

          <p
            className={`type-body-sm mt-3 inline-flex items-start gap-2 ${awaiting ? "text-muted" : "text-success"}`}
            aria-live="polite"
          >
            {awaiting ? <Clock size={15} className="mt-0.5 shrink-0" aria-hidden /> : <Check size={15} className="mt-0.5 shrink-0" aria-hidden />}
            {awaiting ? copy.driverAwaiting : copy.driverConfirmed}
          </p>

          {driver.phone && (
            <a
              href={`tel:${driver.phone}`}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white hover:bg-brand-hover"
            >
              <Phone size={14} aria-hidden />
              {driver.phone}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
