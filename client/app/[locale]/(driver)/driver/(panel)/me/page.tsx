import type { Metadata } from "next";
import {
  BadgeCheck,
  Briefcase,
  Car,
  IdCard,
  MapPinHouse,
  ShieldCheck,
  ShieldQuestion,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";

import { DriverProfileForm } from "@/components/driver/DriverProfileForm";
import { DriverSignOutButton } from "@/components/driver/DriverSignOut";
import { MediaImg } from "@/components/ui/MediaImg";
import { getDriverProfile } from "@/lib/api/driverPanel";
import { fleetFeatureLabels, verificationLabels } from "@/lib/admin/fleet";
import { cn } from "@/lib/utils";
import type { DriverSelf } from "@/types/driver";

export const metadata: Metadata = { title: "Me" };

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

interface Fact {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
  tone?: "warning" | "error";
}

const RENEW = "Send dispatch your renewed licence.";

/**
 * The record's lesser facts, each only when it is set. The licence leads and
 * turns amber in its last 30 days, red once lapsed: an expired licence takes
 * a driver off the board, and dispatch needs the new one before that.
 */
function profileFacts(driver: DriverSelf, today: Date): Fact[] {
  const facts: Fact[] = [];

  if (driver.licenceExpiresOn) {
    const on = longDate(driver.licenceExpiresOn);
    const days = Math.ceil((Date.parse(driver.licenceExpiresOn) - today.getTime()) / 86_400_000);

    if (days < 0) {
      facts.push({ label: "Driving licence", value: `Expired ${on}`, note: RENEW, icon: IdCard, tone: "error" });
    } else if (days <= 30) {
      const left = days === 0 ? "Expires today" : `Expires in ${days === 1 ? "1 day" : `${days} days`}`;
      facts.push({ label: "Driving licence", value: left, note: `On ${on}. ${RENEW}`, icon: IdCard, tone: "warning" });
    } else {
      facts.push({ label: "Driving licence", value: `Valid to ${on}`, icon: IdCard });
    }
  }
  if (driver.homeBasePoint) facts.push({ label: "Home base", value: driver.homeBasePoint.name, icon: MapPinHouse });
  if (driver.yearsExperience > 0) {
    facts.push({
      label: "Experience",
      value: driver.yearsExperience === 1 ? "1 year driving" : `${driver.yearsExperience} years driving`,
      icon: BadgeCheck,
    });
  }

  return facts;
}

const initials = (first: string | null, last: string | null) => `${first?.charAt(0) ?? ""}${last?.charAt(0) ?? ""}`.toUpperCase();

/**
 * The driver's own record: who passengers see, the cars they drive, the
 * three things they may change themselves, and the way out. Two columns from
 * `lg` — the record on the left, the form on the right — one column below.
 */
export default async function DriverMePage() {
  const driver = await getDriverProfile();
  const photo = driver.photo?.variants.find((variant) => variant.variant === "card")?.url ?? driver.photo?.url;
  const facts = profileFacts(driver, new Date());
  const avatarFallback = (
    <span
      className="flex size-20 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[1.25rem] font-semibold text-muted"
      aria-hidden
    >
      {initials(driver.firstName, driver.lastName)}
    </span>
  );

  return (
    <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="space-y-4 lg:sticky lg:top-24">
        <header className="rounded-md border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-center gap-4 lg:flex-col lg:items-start">
            <MediaImg
              src={photo}
              alt=""
              loading="eager"
              className="size-20 shrink-0 rounded-full object-cover"
              fallback={avatarFallback}
            />
            <div className="min-w-0">
              <h1 className="text-[1.375rem] leading-[1.25] font-semibold text-ink wrap-break-word">
                {driver.firstName} {driver.lastName}
              </h1>
              {driver.provider?.name && <p className="mt-0.5 text-[0.875rem] text-muted">{driver.provider.name}</p>}
              <p
                className={cn(
                  "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium",
                  driver.verified ? "bg-success/10 text-success" : "bg-surface-soft text-muted",
                )}
              >
                {driver.verified ? <ShieldCheck size={13} aria-hidden /> : <ShieldQuestion size={13} aria-hidden />}
                {verificationLabels[driver.verificationStatus]}
              </p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div>
              <dt className="text-[0.8125rem] text-muted">Transfers driven</dt>
              <dd className="mt-1 text-[1.5rem] leading-none font-semibold text-ink tabular-nums">{driver.completedCount}</dd>
            </div>
            <div>
              <dt className="text-[0.8125rem] text-muted">Rating</dt>
              <dd className="mt-1">
                {driver.ratingCount > 0 ? (
                  <span className="flex items-baseline gap-1.5">
                    <Star size={17} className="self-center text-accent-gold" fill="currentColor" aria-hidden />
                    <span className="text-[1.5rem] leading-none font-semibold text-ink tabular-nums">{driver.ratingAvg.toFixed(1)}</span>
                    <span className="text-[0.8125rem] text-muted">
                      <bdi>{driver.ratingCount === 1 ? "1 rating" : `${driver.ratingCount} ratings`}</bdi>
                    </span>
                  </span>
                ) : (
                  <span className="block pt-1 text-[0.9375rem] text-muted">No ratings yet</span>
                )}
              </dd>
            </div>
          </dl>

          {facts.length > 0 && (
            <dl className="mt-4 space-y-3 border-t border-line pt-4">
              {facts.map((fact) => (
                <div key={fact.label} className="flex items-start gap-3">
                  <fact.icon
                    size={16}
                    className={cn(
                      "mt-0.5 shrink-0",
                      fact.tone === "error" ? "text-error" : fact.tone === "warning" ? "text-warning-text" : "text-subtle",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <dt className="text-[0.8125rem] text-muted">{fact.label}</dt>
                    <dd
                      className={cn(
                        "text-[0.9375rem]",
                        fact.tone === "error"
                          ? "font-medium text-error-text"
                          : fact.tone === "warning"
                            ? "font-medium text-warning-text"
                            : "text-ink",
                      )}
                    >
                      <bdi>{fact.value}</bdi>
                      {fact.note && <span className="mt-0.5 block text-[0.8125rem] font-normal text-muted">{fact.note}</span>}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
          )}
        </header>

        {driver.vehicles.length > 0 && (
          <section aria-labelledby="me-cars" className="rounded-md border border-line bg-surface">
            <h2 id="me-cars" className="border-b border-line px-4 py-3 text-[0.9375rem] font-semibold text-ink sm:px-5">
              Your cars
            </h2>
            <ul className="divide-y divide-line px-4 sm:px-5">
              {driver.vehicles.map((car) => (
                <li key={car.id} className="flex items-start gap-3 py-3.5">
                  <Car size={17} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                      <span className="text-[0.9375rem] font-medium text-ink wrap-break-word">
                        {car.make} {car.model}
                      </span>
                      {car.isPrimary && (
                        <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[0.75rem] font-medium text-muted">Usual car</span>
                      )}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted">
                      <span className="inline-block rounded-xs border border-line px-1.5 py-0.5 font-mono text-[0.75rem] whitespace-nowrap text-body">
                        {car.plateNumber}
                      </span>
                      {(car.year || car.colour) && (
                        <span>
                          <bdi>{[car.year, car.colour].filter(Boolean).join(" · ")}</bdi>
                        </span>
                      )}
                    </p>
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.8125rem] text-body">
                      <span className="inline-flex items-center gap-1.5">
                        <Users size={14} className="text-subtle" aria-hidden />
                        <bdi>{car.passengerCapacity} seats</bdi>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Briefcase size={14} className="text-subtle" aria-hidden />
                        <bdi>
                          {car.luggageCapacity} large, {car.cabinBagCapacity} cabin
                        </bdi>
                      </span>
                    </p>
                    {car.features.length > 0 && (
                      <ul aria-label="Equipment" className="mt-2 flex flex-wrap gap-1.5">
                        {car.features.map((feature) => (
                          <li key={feature} className="rounded-full border border-line px-2 py-0.5 text-[0.75rem] text-body">
                            {fleetFeatureLabels[feature]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="mt-4 space-y-4 lg:mt-0">
        <section aria-labelledby="me-details" className="rounded-md border border-line bg-surface">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 id="me-details" className="text-[0.9375rem] font-semibold text-ink">
              Your details
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-muted">
              <bdi>Dispatch and your passengers see these.</bdi>
            </p>
          </div>
          <div className="px-4 py-5 sm:px-5">
            <DriverProfileForm driver={driver} />
          </div>
        </section>

        {/* Below `lg` the bar has only an icon for this; from `lg` it carries
            a labelled button, so the page does not repeat it. */}
        <div className="lg:hidden">
          <DriverSignOutButton variant="block" />
        </div>
      </div>
    </div>
  );
}
