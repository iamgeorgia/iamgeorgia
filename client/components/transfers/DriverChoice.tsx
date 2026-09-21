"use client";

import { Camera, Languages, ShieldCheck, Star, UserRound, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { describeError } from "@/lib/api/client";
import { listAvailableDrivers } from "@/lib/api/transfers";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { languageNames } from "@/lib/transfers/languages";
import { cn } from "@/lib/utils";
import type { ImageAsset } from "@/types/catalogue";
import type { AvailableDriver, DriverChoiceValue } from "@/types/driver";

interface DriverChoiceProps {
  /** The offer's quote token: it names the class, the journey and the party. */
  token: string;
  value: DriverChoiceValue | null;
  onChange: (value: DriverChoiceValue | null) => void;
}

const variantUrl = (image: ImageAsset | null | undefined, variant: string) =>
  image?.variants.find((entry) => entry.variant === variant)?.url ?? image?.url ?? null;

/**
 * A partner choosing who drives.
 *
 * Asks the server who is free for this journey once the form mounts and
 * offers them as a radio group under "let us assign a driver", which stays
 * the default. Every driver comes with the car — or cars — they could take
 * the job in; picking a car picks its driver. Nothing here is a promise: the
 * booking call checks the choice again under a lock, and a driver taken in
 * the meantime remounts this list with a fresh answer.
 */
export function DriverChoice({ token, value, onChange }: DriverChoiceProps) {
  const { t } = useI18n();
  const copy = t.transfers.booking;
  const [drivers, setDrivers] = useState<AvailableDriver[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listAvailableDrivers(token)
      .then((result) => {
        if (!cancelled) setDrivers(result.drivers);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(describeError(caught, copy.driverLoadFailed));
        setDrivers([]);
      });

    return () => {
      cancelled = true;
    };
    // The token is the whole query; the copy only changes with the locale,
    // which remounts the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section aria-labelledby="driver-choice" className="mt-12 border-t border-line pt-10">
      <h2 id="driver-choice" className="type-h3">
        {copy.driverSection}
      </h2>
      <p className="type-body-sm mt-2 text-muted">{copy.driverBody}</p>

      <div role="radiogroup" aria-labelledby="driver-choice" className="mt-6 space-y-3">
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-sm border bg-surface p-4 transition-colors",
            value === null ? "border-ink" : "border-line hover:border-ink/40",
          )}
        >
          <input
            type="radio"
            name="driver"
            checked={value === null}
            onChange={() => onChange(null)}
            className="mt-1 accent-ink"
          />
          <span>
            <span className="block text-[0.9375rem] font-medium text-ink">{copy.driverAny}</span>
            <span className="type-body-sm mt-0.5 block text-muted">{copy.driverAnyBody}</span>
          </span>
        </label>

        {drivers === null && !error && (
          <p className="type-body-sm py-2 text-muted" aria-live="polite">
            {copy.driverLoading}
          </p>
        )}
        {error && (
          <p role="alert" className="type-body-sm py-2 text-error-text">
            {error}
          </p>
        )}
        {drivers?.length === 0 && !error && (
          <p className="type-body-sm py-2 text-muted">{copy.driverNone}</p>
        )}

        {drivers?.map((driver) => (
          <DriverOption
            key={driver.id}
            driver={driver}
            selectedCarId={value?.driverId === driver.id ? value.fleetVehicleId : null}
            onSelect={(fleetVehicleId) => onChange({ driverId: driver.id, fleetVehicleId })}
          />
        ))}
      </div>
    </section>
  );
}

function DriverOption({
  driver,
  selectedCarId,
  onSelect,
}: {
  driver: AvailableDriver;
  selectedCarId: string | null;
  onSelect: (fleetVehicleId: string) => void;
}) {
  const { t, intlLocale } = useI18n();
  const copy = t.transfers.booking;
  const selected = selectedCarId !== null;
  const photo = variantUrl(driver.photo, "card");
  const inputId = `driver-${driver.id}`;

  return (
    <div
      className={cn(
        "rounded-sm border bg-surface p-4 transition-colors",
        selected ? "border-ink" : "border-line hover:border-ink/40",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          id={inputId}
          type="radio"
          name="driver"
          checked={selected}
          onChange={() => onSelect(driver.cars[0].id)}
          className="mt-1 accent-ink"
        />

        <label htmlFor={inputId} className="flex min-w-0 flex-1 cursor-pointer items-start gap-4">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- API-served
            <img src={photo} alt="" className="size-16 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface-soft text-subtle">
              <UserRound size={24} aria-hidden />
            </span>
          )}

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] font-medium text-ink">
              {driver.firstName} {driver.lastName}
              {driver.verified && (
                <span className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-success">
                  <ShieldCheck size={14} aria-hidden />
                  {copy.driverVerified}
                </span>
              )}
            </span>

            <span className="type-body-sm mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              {driver.ratingCount > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Star size={13} className="text-accent-gold" aria-hidden fill="currentColor" />
                  {fill(copy.driverRatings, { avg: driver.ratingAvg.toFixed(1), count: driver.ratingCount })}
                </span>
              ) : (
                <span>{copy.driverNoRatings}</span>
              )}
              {driver.completedCount > 0 && (
                <span>{fill(copy.driverTransfers, { count: driver.completedCount })}</span>
              )}
              {driver.yearsExperience > 0 && (
                <span>{fill(copy.driverExperience, { count: driver.yearsExperience })}</span>
              )}
            </span>

            {driver.languages.length > 0 && (
              <span className="type-body-sm mt-1 inline-flex items-center gap-1.5 text-muted">
                <Languages size={13} aria-hidden />
                {fill(copy.driverSpeaks, { languages: languageNames(driver.languages, intlLocale) })}
              </span>
            )}

            {driver.bio && (
              <span className="type-body-sm mt-2 block leading-relaxed text-body">{driver.bio}</span>
            )}
          </span>
        </label>
      </div>

      <div className="mt-4 space-y-3 border-t border-line pt-4 ps-7">
        {driver.cars.length > 1 && <p className="type-caption text-muted">{copy.driverChooseCar}</p>}
        {driver.cars.map((car) => (
          <CarOption
            key={car.id}
            car={car}
            driverId={driver.id}
            choosable={driver.cars.length > 1}
            selected={selectedCarId === car.id}
            onSelect={() => onSelect(car.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CarOption({
  car,
  driverId,
  choosable,
  selected,
  onSelect,
}: {
  car: AvailableDriver["cars"][number];
  driverId: string;
  /** Only when the driver has more than one eligible car. */
  choosable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const copy = t.transfers.booking;
  const featureLabel = (code: string) => (t.transfers.features as Record<string, string>)[code] ?? code;
  const cover = variantUrl(car.mainImage, "card");
  const gallery = car.images.filter((image) => image.id !== car.mainImage?.id);
  const inputId = `car-${driverId}-${car.id}`;

  return (
    <div className={cn("rounded-sm", choosable && selected && "bg-surface-soft/60")}>
      <div className="flex items-start gap-3">
        {choosable && (
          <input
            id={inputId}
            type="radio"
            name={`car-${driverId}`}
            checked={selected}
            onChange={onSelect}
            className="mt-1 accent-ink"
          />
        )}

        <label
          htmlFor={choosable ? inputId : undefined}
          className={cn("flex min-w-0 flex-1 items-start gap-3", choosable && "cursor-pointer")}
        >
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- API-served
            <img src={cover} alt="" className="h-16 w-24 shrink-0 rounded-sm object-cover" />
          ) : (
            <span className="h-16 w-24 shrink-0 rounded-sm bg-surface-soft" aria-hidden />
          )}

          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-medium text-ink">
              {car.make} {car.model}
              {car.year ? ` · ${car.year}` : ""}
              {car.colour ? `, ${car.colour.toLowerCase()}` : ""}
            </span>
            <span className="type-body-sm mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
              <span className="font-mono tracking-wide">{car.plateNumber}</span>
              <span className="inline-flex items-center gap-1">
                <Users size={13} aria-hidden />
                {fill(copy.driverCarCapacity, {
                  passengers: car.passengerCapacity,
                  luggage: car.luggageCapacity,
                })}
              </span>
            </span>
            {car.features.length > 0 && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {car.features.map((feature) => (
                  <span
                    key={feature}
                    className="rounded-sm bg-surface-soft px-2 py-0.5 text-[0.75rem] text-body"
                  >
                    {featureLabel(feature)}
                  </span>
                ))}
              </span>
            )}
            {car.description && (
              <span className="type-body-sm mt-2 block leading-relaxed text-body">{car.description}</span>
            )}
          </span>
        </label>
      </div>

      {gallery.length > 0 && (
        <details className="group mt-2">
          <summary className="type-caption inline-flex cursor-pointer list-none items-center gap-1.5 text-brand-text underline-offset-4 hover:underline">
            <Camera size={13} aria-hidden />
            {copy.driverPhotos} ({gallery.length})
          </summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {gallery.map((image) => (
              <li key={image.imageId}>
                {/* eslint-disable-next-line @next/next/no-img-element -- API-served */}
                <img
                  src={variantUrl(image, "card") ?? image.url}
                  alt={image.caption ?? ""}
                  className="h-20 w-28 rounded-sm object-cover"
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
