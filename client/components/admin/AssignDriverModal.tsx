"use client";

import { useEffect, useState } from "react";
import { MediaImg } from "@/components/ui/MediaImg";
import {
  AlertTriangle,
  Briefcase,
  CarFront,
  Check,
  Clock,
  Loader2,
  ShieldCheck,
  Star,
  UserRound,
  Users,
} from "lucide-react";

import { CheckboxField, FormError, TextArea } from "./FormControls";
import { Modal } from "@/components/ui/Modal";
import { ApiError, describeError } from "@/lib/api/client";
import { assignLeg, getDispatchCandidates } from "@/lib/api/dispatch";
import { formatPickup, formatTime, overrideLabels } from "@/lib/admin/dispatch";
import { driverDisplayName } from "@/lib/admin/fleet";
import { cn } from "@/lib/utils";
import type { DispatchCandidate, DispatchLeg, ScheduleConflict } from "@/types/driver";

/**
 * Choosing a driver for a leg.
 *
 * The candidates come from the server already narrowed to drivers with an
 * active car of the class the booker chose, ranked, and with their conflicts
 * shown — "why is Levan not on the list" is a question the board should be
 * able to answer, and the answer is either "busy" (shown) or "no car of that
 * class" (the empty state says so). Anything the server still needs a
 * decision on — an unverified driver, a car the driver does not usually take
 * — comes back as a 422 naming it, and the matching checkbox appears; nothing
 * here second-guesses those rules.
 */
export function AssignDriverModal({
  leg,
  open,
  onClose,
  onDone,
}: {
  leg: DispatchLeg;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`${leg.assignment ? "Reassign" : "Assign"} ${leg.booking.reference}`} size="lg">
      {open && <AssignForm leg={leg} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

const sectionHeading = "text-[0.75rem] font-semibold tracking-wide text-muted uppercase";

/** Mounted only while the dialog is open, so every open starts from scratch. */
function AssignForm({ leg, onClose, onDone }: { leg: DispatchLeg; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<DispatchCandidate[]>([]);
  const [driverId, setDriverId] = useState<string | null>(leg.assignment?.driver.id ?? null);
  const [vehicleId, setVehicleId] = useState<string | null>(leg.assignment?.vehicle?.id ?? null);
  const [acceptOnBehalf, setAcceptOnBehalf] = useState(false);
  const [note, setNote] = useState("");
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [needed, setNeeded] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const className = leg.booking.vehicleClassName ?? "any class";

  useEffect(() => {
    let cancelled = false;

    getDispatchCandidates(leg.id)
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.data);

        // A driver or car assigned under an earlier override may no longer
        // qualify; the form must not carry a choice the list does not show.
        setDriverId((current) => {
          const still = result.data.find((candidate) => candidate.driver.id === current);
          if (!still) {
            setVehicleId(null);
            return null;
          }
          setVehicleId((car) => (car && still.vehicles.some((entry) => entry.id === car) ? car : still.suggestedVehicleId));
          return current;
        });
      })
      .catch((caught) => {
        if (!cancelled) setError(describeError(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leg.id]);

  const chosen = candidates.find((candidate) => candidate.driver.id === driverId) ?? null;
  const freeCount = candidates.filter((candidate) => candidate.conflicts.length === 0).length;

  const pickDriver = (candidate: DispatchCandidate) => {
    setDriverId(candidate.driver.id);
    setVehicleId(candidate.suggestedVehicleId);
    setNeeded([]);
    setConflicts([]);
  };

  const toggleOverride = (code: string, on: boolean) =>
    setOverrides((current) => {
      const next = new Set(current);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });

  const submit = async () => {
    if (!driverId) return;
    setBusy(true);
    setError(null);
    setNeeded([]);
    setConflicts([]);

    try {
      await assignLeg(leg.id, {
        driverId,
        fleetVehicleId: vehicleId,
        acceptOnBehalf,
        note: note.trim() || null,
        overrideUnverified: overrides.has("UNVERIFIED_DRIVER"),
        overrideClassMismatch: overrides.has("CLASS_MISMATCH"),
        overrideVehicleLink: overrides.has("VEHICLE_NOT_LINKED"),
      });
      onDone();
      onClose();
    } catch (caught) {
      const details =
        caught instanceof ApiError
          ? (caught.details as { reason?: string; overrides?: string[]; conflicts?: ScheduleConflict[] } | undefined)
          : undefined;

      if (details?.reason === "OVERRIDE_REQUIRED") setNeeded(details.overrides ?? []);
      if (details?.reason === "SCHEDULE_CONFLICT") setConflicts(details.conflicts ?? []);
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const describeConflict = (conflict: ScheduleConflict) =>
    `${conflict.sourceKind === "BLOCK" ? "Blocked" : conflict.bookingReference ?? "Busy"} · ${formatTime(
      conflict.windowStart,
      leg.timezone,
    )}–${formatTime(conflict.windowEnd, leg.timezone)}`;

  return (
    <div className="px-6 pt-4 pb-6">
      {/* The job, so the dispatcher never has to look back at the board. */}
      <div className="rounded-sm border border-line bg-surface-soft px-4 py-3">
        <p className="text-[0.875rem] font-medium text-ink">
          {leg.from} <span className="text-subtle">→</span> {leg.to}
        </p>
        <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.75rem] text-muted">
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="shrink-0 text-subtle" aria-hidden />
            <dt className="sr-only">Pick-up</dt>
            <dd>{formatPickup(leg.pickupAt, leg.timezone)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Users size={13} className="shrink-0 text-subtle" aria-hidden />
            <dt className="sr-only">Passengers</dt>
            <dd>{leg.booking.passengers} passengers</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Briefcase size={13} className="shrink-0 text-subtle" aria-hidden />
            <dt className="sr-only">Luggage</dt>
            <dd>{leg.booking.luggage} bags</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Booked class</dt>
            <dd className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 font-medium text-brand-text">
              <CarFront size={13} className="shrink-0" aria-hidden />
              {className}
            </dd>
          </div>
        </dl>
      </div>

      {loading ? (
        <p className="mt-8 mb-4 flex items-center justify-center gap-2 text-[0.875rem] text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Finding who is free…
        </p>
      ) : (
        <div className="mt-5 grid gap-6 md:grid-cols-[1.15fr_1fr]">
          <fieldset className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <legend className={sectionHeading}>Driver</legend>
              {candidates.length > 0 && (
                <span className="text-[0.75rem] text-subtle">
                  {freeCount} of {candidates.length} free
                </span>
              )}
            </div>

            {candidates.length === 0 ? (
              <div className="mt-2 rounded-sm border border-dashed border-line px-4 py-6 text-center">
                <CarFront size={22} className="mx-auto text-subtle" aria-hidden />
                <p className="mt-2 text-[0.8125rem] font-medium text-ink">No driver has a {className} car on the road.</p>
                <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
                  Only drivers with an active car of the booked class are offered. Link one under Fleet, or put a
                  car back on the road.
                </p>
              </div>
            ) : (
              <ul className="mt-2 max-h-88 space-y-1.5 overflow-y-auto pr-0.5">
                {candidates.map((candidate) => {
                  const busyNow = candidate.conflicts.length > 0;
                  const active = candidate.driver.id === driverId;
                  const name = driverDisplayName(candidate.driver);
                  const photo =
                    candidate.driver.photo?.variants.find((variant) => variant.variant === "thumb")?.url ??
                    candidate.driver.photo?.url;
                  const cars = candidate.vehicles.length;
                  return (
                    <li key={candidate.driver.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5 transition-colors",
                          active
                            ? "border-brand bg-brand-soft"
                            : "border-line bg-surface hover:border-ink/40 hover:bg-surface-soft",
                        )}
                      >
                        <input
                          type="radio"
                          name="dispatch-driver"
                          checked={active}
                          onChange={() => pickDriver(candidate)}
                          className="sr-only"
                        />
                        <MediaImg
                          src={photo}
                          alt=""
                          className="size-9 shrink-0 rounded-full object-cover"
                          fallback={
                            <span
                              className={cn(
                                "flex size-9 shrink-0 items-center justify-center rounded-full",
                                active ? "bg-brand text-white" : "bg-surface-soft text-subtle",
                              )}
                            >
                              <UserRound size={16} aria-hidden />
                            </span>
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-[0.875rem] font-medium text-ink">{name}</span>
                            {candidate.verified ? (
                              <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-success">
                                <ShieldCheck size={12} aria-hidden />
                                Verified
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-warning-text">
                                <AlertTriangle size={12} aria-hidden />
                                Not verified
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.75rem] text-muted">
                            {candidate.provider?.name && <span>{candidate.provider.name}</span>}
                            {candidate.driver.ratingCount > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                <Star size={11} className="text-accent-gold" aria-hidden />
                                {candidate.driver.ratingAvg.toFixed(1)}
                              </span>
                            )}
                            {candidate.driver.completedCount > 0 && <span>{candidate.driver.completedCount} transfers</span>}
                            <span>
                              {cars} {className} {cars === 1 ? "car" : "cars"}
                            </span>
                          </span>
                          {busyNow ? (
                            <span className="mt-1.5 flex items-start gap-1.5 text-[0.75rem] text-warning-text">
                              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                              <span>{candidate.conflicts.map(describeConflict).join(", ")}</span>
                            </span>
                          ) : (
                            <span className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-success">
                              <Check size={12} className="shrink-0" aria-hidden />
                              Free at this time
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          <div className="space-y-5">
            <fieldset>
              <legend className={sectionHeading}>Car</legend>
              {!chosen ? (
                <p className="mt-2 rounded-sm border border-dashed border-line px-4 py-5 text-center text-[0.8125rem] text-muted">
                  Choose a driver to see their {className} cars.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {chosen.vehicles.map((car) => {
                    const active = vehicleId === car.id;
                    const carBusy = car.conflicts.length > 0;
                    return (
                      <li key={car.id}>
                        <label
                          className={cn(
                            "flex items-start gap-3 rounded-sm border px-3 py-2.5 transition-colors",
                            car.fitsParty ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                            active
                              ? "border-brand bg-brand-soft"
                              : "border-line bg-surface hover:border-ink/40 hover:bg-surface-soft",
                          )}
                        >
                          <input
                            type="radio"
                            name="dispatch-car"
                            checked={active}
                            disabled={!car.fitsParty}
                            onChange={() => setVehicleId(car.id)}
                            className="mt-1 shrink-0 accent-brand"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-[0.875rem] font-medium text-ink">
                                {car.make} {car.model}
                              </span>
                              <span className="rounded-xs border border-line bg-surface px-1.5 py-px font-mono text-[0.6875rem] tracking-wide text-body">
                                {car.plateNumber}
                              </span>
                              {car.isPrimary && <span className="text-[0.6875rem] font-medium text-subtle">Usual car</span>}
                            </span>
                            <span className="mt-0.5 block text-[0.75rem] text-muted">
                              {[car.colour, car.year].filter(Boolean).join(" · ")}
                              {(car.colour || car.year) && " · "}
                              {car.passengerCapacity} seats · {car.luggageCapacity} bags
                            </span>
                            {!car.fitsParty && (
                              <span className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-error-text">
                                <AlertTriangle size={12} className="shrink-0" aria-hidden />
                                Too small for this party
                              </span>
                            )}
                            {carBusy && (
                              <span className="mt-1 flex items-start gap-1.5 text-[0.75rem] text-warning-text">
                                <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                                <span>{car.conflicts.map(describeConflict).join(", ")}</span>
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  <li>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5 text-[0.8125rem] transition-colors",
                        vehicleId === null
                          ? "border-brand bg-brand-soft text-ink"
                          : "border-dashed border-line text-body hover:border-ink/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="dispatch-car"
                        checked={vehicleId === null}
                        onChange={() => setVehicleId(null)}
                        className="shrink-0 accent-brand"
                      />
                      <span>
                        Decide later
                        <span className="block text-[0.75rem] text-subtle">The driver picks one of their cars.</span>
                      </span>
                    </label>
                  </li>
                </ul>
              )}
            </fieldset>

            <CheckboxField
              label="Confirmed by phone — mark as accepted"
              hint="Otherwise the driver accepts in their own panel."
              checked={acceptOnBehalf}
              onChange={setAcceptOnBehalf}
            />

            {needed.length > 0 && (
              <div className="rounded-sm border border-warning/40 bg-warning/5 p-3">
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-warning-text">
                  <AlertTriangle size={14} aria-hidden />
                  This needs your say-so
                </p>
                <div className="mt-2 space-y-1.5">
                  {needed.map((code) => (
                    <CheckboxField
                      key={code}
                      label={overrideLabels[code] ?? code}
                      checked={overrides.has(code)}
                      onChange={(on) => toggleOverride(code, on)}
                    />
                  ))}
                </div>
              </div>
            )}

            {conflicts.length > 0 && (
              <ul className="space-y-1 rounded-sm border border-error/40 bg-error/5 p-3 text-[0.8125rem] text-error-text">
                {conflicts.map((conflict) => (
                  <li key={`${conflict.sourceKind}-${conflict.sourceId}`}>
                    {conflict.resourceType === "DRIVER" ? "Driver" : "Car"}: {describeConflict(conflict)}
                  </li>
                ))}
              </ul>
            )}

            <TextArea label="Note for the driver" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
      )}

      <FormError message={error} />

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="min-w-0 truncate text-[0.75rem] text-subtle">
          {chosen ? (
            <>
              Sending to <span className="font-medium text-body">{driverDisplayName(chosen.driver)}</span>
              {vehicleId && chosen.vehicles.some((car) => car.id === vehicleId)
                ? ` in the ${chosen.vehicles.find((car) => car.id === vehicleId)?.plateNumber}`
                : ", car to be decided"}
            </>
          ) : (
            !loading && candidates.length > 0 && "Pick a driver to continue"
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-sm border border-line px-4 text-[0.8125rem] font-medium text-body hover:border-ink hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!driverId || busy || loading}
            onClick={() => void submit()}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {leg.assignment ? "Reassign" : "Offer the job"}
          </button>
        </div>
      </div>
    </div>
  );
}
