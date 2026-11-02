import { Languages, Phone, ShieldCheck, Star, UserRound } from "lucide-react";
import { MediaImg } from "@/components/ui/MediaImg";

import { languageLabels } from "@/lib/admin/fleet";
import type { AssignmentForPartner, DriverLanguage } from "@/types/driver";

/**
 * Who is coming.
 *
 * Shown to a partner and to the passenger once the driver has accepted: the
 * face to look for, the car to look for, and — only once the pick-up is close
 * enough that the server has released it — a number to call. Nothing else
 * about the driver is in the data this receives, so nothing else can leak.
 */
export function DriverCard({
  assignment,
  heading = "Your driver",
}: {
  assignment: AssignmentForPartner;
  heading?: string;
}) {
  const { driver, vehicle } = assignment;
  const photo = driver.photo?.variants.find((variant) => variant.variant === "card")?.url ?? driver.photo?.url;
  const carPhoto = vehicle?.mainImage?.variants.find((variant) => variant.variant === "card")?.url ?? vehicle?.mainImage?.url;

  return (
    <section className="rounded-sm border border-line bg-surface p-5" aria-labelledby={`driver-${driver.id}`}>
      <h2 id={`driver-${driver.id}`} className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">
        {heading}
      </h2>

      <div className="mt-4 flex items-start gap-4">
        <MediaImg
          src={photo}
          alt=""
          className="h-20 w-20 shrink-0 rounded-full object-cover"
          fallback={
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-surface-soft text-subtle">
              <UserRound size={28} aria-hidden />
            </span>
          }
        />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[1.0625rem] font-medium text-ink">
            {driver.firstName} {driver.lastName}
            {driver.verified && (
              <span className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-success">
                <ShieldCheck size={14} aria-hidden />
                Verified
              </span>
            )}
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted">
            {driver.ratingCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Star size={13} className="text-accent-gold" aria-hidden fill="currentColor" />
                {driver.ratingAvg.toFixed(1)} · {driver.ratingCount} ratings
              </span>
            ) : (
              <span>No ratings yet</span>
            )}
            {driver.completedCount > 0 && <span>{driver.completedCount} transfers driven</span>}
            {driver.yearsExperience > 0 && <span>{driver.yearsExperience} years driving</span>}
          </p>

          {driver.languages.length > 0 && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted">
              <Languages size={13} aria-hidden />
              {driver.languages.map((code) => languageLabels[code as DriverLanguage] ?? code).join(", ")}
            </p>
          )}

          {driver.bio && <p className="mt-2 text-[0.8125rem] leading-relaxed text-body">{driver.bio}</p>}

          {driver.phone ? (
            <a
              href={`tel:${driver.phone}`}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white hover:bg-brand-hover"
            >
              <Phone size={14} aria-hidden />
              {driver.phone}
            </a>
          ) : (
            <p className="mt-3 text-[0.75rem] text-subtle">The driver&apos;s number is shared the day before pick-up.</p>
          )}
        </div>
      </div>

      {vehicle && (
        <div className="mt-5 flex items-center gap-4 border-t border-line pt-4">
          <MediaImg
            src={carPhoto}
            alt=""
            className="h-16 w-24 shrink-0 rounded-sm object-cover"
            fallback={<span className="h-16 w-24 shrink-0 rounded-sm bg-surface-soft" aria-hidden />}
          />
          <div>
            <p className="text-[0.9375rem] font-medium text-ink">
              {vehicle.make} {vehicle.model}
              {vehicle.colour ? `, ${vehicle.colour.toLowerCase()}` : ""}
            </p>
            <p className="font-mono text-[0.8125rem] tracking-wide text-muted">{vehicle.plateNumber}</p>
          </div>
        </div>
      )}
    </section>
  );
}
