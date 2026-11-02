import type { Metadata } from "next";
import { MediaImg } from "@/components/ui/MediaImg";
import { ShieldCheck, ShieldQuestion, Star } from "lucide-react";

import { DriverProfileForm } from "@/components/driver/DriverProfileForm";
import { getDriverProfile } from "@/lib/api/driverPanel";
import { verificationLabels } from "@/lib/admin/fleet";

export const metadata: Metadata = { title: "Me" };

export default async function DriverMePage() {
  const driver = await getDriverProfile();
  const photo = driver.photo?.variants.find((variant) => variant.variant === "card")?.url ?? driver.photo?.url;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <MediaImg
          src={photo}
          alt=""
          loading="eager"
          className="h-20 w-20 shrink-0 rounded-full object-cover"
          fallback={<span className="h-20 w-20 shrink-0 rounded-full bg-surface-soft" aria-hidden />}
        />
        <div>
          <h1 className="text-[1.25rem] font-semibold text-ink">
            {driver.firstName} {driver.lastName}
          </h1>
          <p className="text-[0.8125rem] text-muted">{driver.provider?.name}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted">
            {driver.verified ? <ShieldCheck size={14} className="text-success" aria-hidden /> : <ShieldQuestion size={14} aria-hidden />}
            {verificationLabels[driver.verificationStatus]}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-sm border border-line bg-surface p-4">
          <p className="text-[0.75rem] text-muted">Transfers driven</p>
          <p className="mt-1 text-[1.5rem] font-semibold text-ink tabular-nums">{driver.completedCount}</p>
        </div>
        <div className="rounded-sm border border-line bg-surface p-4">
          <p className="text-[0.75rem] text-muted">Rating</p>
          <p className="mt-1 flex items-center gap-1.5 text-[1.5rem] font-semibold text-ink tabular-nums">
            <Star size={18} className="text-accent-gold" aria-hidden fill="currentColor" />
            {driver.ratingCount > 0 ? driver.ratingAvg.toFixed(1) : "—"}
            <span className="text-[0.75rem] font-normal text-muted">
              {driver.ratingCount > 0 ? `${driver.ratingCount} ratings` : "none yet"}
            </span>
          </p>
        </div>
      </section>

      {driver.vehicles.length > 0 && (
        <section className="rounded-sm border border-line bg-surface p-4">
          <h2 className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">Your cars</h2>
          <ul className="mt-2 space-y-1 text-[0.9375rem] text-ink">
            {driver.vehicles.map((car) => (
              <li key={car.id}>
                {car.make} {car.model} · <span className="font-mono text-[0.8125rem]">{car.plateNumber}</span>
                {car.isPrimary && <span className="ms-2 text-[0.75rem] text-muted">usual</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-sm border border-line bg-surface p-4">
        <h2 className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">Your details</h2>
        <div className="mt-4">
          <DriverProfileForm driver={driver} />
        </div>
      </section>
    </div>
  );
}
