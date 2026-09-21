"use client";

import { Check, Copy, Mail, Phone } from "lucide-react";
import { useState } from "react";

import { RequestedDriver } from "./RequestedDriver";
import { TransferSteps } from "./TransferSteps";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { site } from "@/constants/site";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/transfers/query";
import type { AssignmentForPartner } from "@/types/driver";
import type { TransferBooking } from "@/types/transfer";

/**
 * Confirmation.
 *
 * Everything on this page comes from the booking record, fetched by the server
 * component above it. It used to be assembled from a URL query string and a
 * `sessionStorage` draft, which meant a reopened link showed a page about a
 * booking that had never existed. Now the reference in the URL is a row, and if
 * it is not readable the page 404s rather than inventing one.
 *
 * The journey and vehicle come from the booking's **snapshots**, not from the
 * live catalogue: a voucher opened next year must still describe what was sold.
 */
export function TransferConfirmation({ booking }: { booking: TransferBooking }) {
  const path = useLocalePath();
  const { t, locale, intlLocale } = useI18n();
  const [copied, setCopied] = useState(false);

  const { route, vehicle } = booking;
  const outbound = booking.legs[0];
  const back = booking.legs.find((leg) => leg.direction === "RETURN");

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(booking.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the reference is on screen regardless.
    }
  };

  /** The pick-up as a wall clock at the pick-up point, never in the reader's zone. */
  const formatPickup = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: route.fromTimezone,
    }).format(new Date(iso));

  const firstName = booking.leadPassengerName.split(" ")[0];

  return (
    <Container className="pt-8 pb-24 lg:pb-32">
      <TransferSteps current={4} />

      <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-12 xl:gap-16">
        <div className="min-w-0 lg:col-span-7">
          <span className="flex size-14 items-center justify-center rounded-full bg-surface-soft text-success">
            <Check size={26} aria-hidden />
          </span>

          <h1 className="type-h1 mt-6 text-balance">{t.transfers.confirmation.title}</h1>
          <p className="type-body-lg mt-4 text-body">
            {firstName ? fill(t.transfers.confirmation.thanks, { name: firstName }) : ""}
            {fill(t.transfers.confirmation.body, {
              provider: vehicle.providerName ?? vehicle.name,
            })}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4 border-y border-line py-5">
            <div>
              <p className="type-caption text-muted">{t.transfers.confirmation.reference}</p>
              <p className="type-h3 mt-1 tabular-nums">{booking.reference}</p>
            </div>
            <button
              type="button"
              onClick={copyReference}
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/25 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
            >
              {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
              {copied ? t.transfers.confirmation.copied : t.transfers.confirmation.copy}
            </button>
            <span aria-live="polite" className="sr-only">
              {copied ? t.transfers.confirmation.copiedAnnounce : ""}
            </span>
            {booking.status === "CANCELLED" && (
              <Badge tone="neutral" className="ms-auto">
                {t.transfers.confirmation.cancelled}
              </Badge>
            )}
          </div>

          <section className="mt-10">
            <h2 className="type-h3">{t.transfers.confirmation.leadPassenger}</h2>
            <dl className="mt-5 divide-y divide-line border-y border-line">
              <Row label={t.transfers.confirmation.name} value={booking.leadPassengerName} />
              <Row label={t.transfers.confirmation.email} value={booking.leadPassengerEmail} breakAll />
              {booking.leadPassengerPhone && (
                <Row label={t.transfers.confirmation.mobile} value={booking.leadPassengerPhone} />
              )}
              {booking.flightNumber && (
                <Row label={t.transfers.confirmation.flight} value={booking.flightNumber} />
              )}
              {booking.pickupAddress && (
                <Row label={t.transfers.confirmation.pickupNote} value={booking.pickupAddress} />
              )}
              {booking.specialRequests && (
                <div className="py-3.5">
                  <dt className="type-body-sm text-muted">
                    {t.transfers.confirmation.specialRequests}
                  </dt>
                  <dd className="type-body-sm mt-1.5 text-body">{booking.specialRequests}</dd>
                </div>
              )}
            </dl>
          </section>

          {/* The driver a partner asked for: shown while the offer waits and
              once it is taken. A guest booking never carries one. */}
          {booking.legs.some((leg) => leg.assignment) && (
            <section className="mt-10">
              <h2 className="type-h3">{t.transfers.booking.driverRequested}</h2>
              <div className="mt-5 space-y-4">
                {booking.legs.map(
                  (leg) =>
                    leg.assignment && (
                      <RequestedDriver
                        key={leg.id}
                        assignment={leg.assignment as AssignmentForPartner}
                        label={back ? `${leg.from} → ${leg.to}` : undefined}
                      />
                    ),
                )}
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="type-h3">{t.transfers.confirmation.whatNext}</h2>
            <ol className="mt-5 space-y-4">
              {t.transfers.confirmation.nextSteps.map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[0.8125rem] font-semibold text-brand-text tabular-nums">
                    {index + 1}
                  </span>
                  <span className="type-body-sm text-body">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-10 rounded-sm bg-surface-soft p-5">
            <h2 className="type-h4">{t.transfers.confirmation.ifChanges}</h2>
            <p className="type-body-sm mt-2 text-body">{t.transfers.confirmation.ifChangesBody}</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <a
                href={`mailto:${site.contact.email}`}
                className="type-body-sm inline-flex items-center gap-2 text-ink underline-offset-4 hover:underline"
              >
                <Mail size={15} className="text-brand-text" aria-hidden />
                {site.contact.email}
              </a>
              <a
                href={`tel:${site.contact.phone.replace(/\s/g, "")}`}
                className="type-body-sm inline-flex items-center gap-2 text-ink underline-offset-4 hover:underline"
              >
                <Phone size={15} className="text-brand-text" aria-hidden />
                {site.contact.phone}
              </a>
            </div>
          </section>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button href={path("/transfers")} variant="outline">
              {t.transfers.booking.searchTransfers}
            </Button>
            <Button href={path("/")} variant="outline">
              {t.transfers.confirmation.backHome}
            </Button>
          </div>
        </div>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-36">
            <h2 className="type-h4 mb-4">{t.transfers.summary.yourTransfer}</h2>

            <div className="border border-line bg-surface shadow-card">
              <div className="border-b border-line p-5">
                <h3 className="type-h4">{vehicle.name}</h3>
                <p className="type-caption mt-1 text-muted">
                  {vehicle.vehicleExample}
                  {vehicle.providerName ? ` · ${vehicle.providerName}` : ""}
                </p>
              </div>

              <dl className="divide-y divide-line px-5">
                <Row label={t.transfers.summary.route} value={`${route.fromName} → ${route.toName}`} />
                <Row label={t.transfers.summary.pickUp} value={formatPickup(booking.pickupAt)} />
                {back && (
                  <Row
                    label={t.transfers.summary.returnPickUp}
                    value={formatPickup(back.pickupAt)}
                  />
                )}
                <Row
                  label={t.transfers.summary.journeyTime}
                  value={`${fill(t.common.approx, {
                    value: formatDuration(outbound?.durationMinutes ?? 0, {
                      hour: t.common.hourShort,
                      minute: t.common.minuteShort,
                    }),
                  })} · ${fill(t.transfers.detail.kmByRoad, {
                    count: outbound?.distanceKm ?? 0,
                  })}`}
                />
                <Row
                  label={t.transfers.summary.passengers}
                  value={plural(locale, booking.passengers, t.units.passenger)}
                />
                <Row
                  label={t.transfers.summary.luggage}
                  value={plural(locale, booking.luggage, t.units.largeBag)}
                />
              </dl>

              {booking.extras.length > 0 && (
                <dl className="space-y-2 border-t border-line px-5 py-4">
                  {booking.extras.map((extra) => (
                    <div key={extra.code} className="flex items-baseline justify-between gap-4">
                      <dt className="type-body-sm text-muted">
                        {extra.name}
                        {extra.quantity > 1 ? ` × ${extra.quantity}` : ""}
                      </dt>
                      <dd className="type-body-sm tabular-nums">
                        {formatMoney(extra.totalCents, booking.currency, intlLocale)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="flex items-baseline justify-between gap-4 border-t border-line px-5 py-5">
                <span className="type-h4">{t.common.total}</span>
                <span className="type-h4 tabular-nums">
                  {formatMoney(booking.totalCents, booking.currency, intlLocale)}
                </span>
              </div>

              <p className="type-caption border-t border-line px-5 py-4 text-muted">
                {vehicle.pickupProcedure}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </Container>
  );
}

/** One label / value line, so the two lists read identically. */
function Row({ label, value, breakAll }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3.5">
      <dt className="type-body-sm text-muted">{label}</dt>
      <dd
        className={`type-body-sm text-end font-medium text-ink${breakAll ? " break-all" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
