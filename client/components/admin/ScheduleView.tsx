"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { FormError, SelectInput, SubmitButton, TextArea, TextInput } from "./FormControls";
import { describeError } from "@/lib/api/client";
import { createBlock, deleteBlock } from "@/lib/api/dispatch";
import { blockReasonLabels, formatPickup } from "@/lib/admin/dispatch";
import type { BlockReason, OccupancyRow, ResourceBlock } from "@/types/driver";

/** One entry of the resource picker — the page labels it; this only lists it. */
interface ResourceOption {
  id: string;
  label: string;
}

/**
 * A driver's or a car's diary for a window: every job and every block, from
 * the same occupancy view the dispatcher's conflict check reads. The window
 * and the resource live in the URL; blocks are added through a range form
 * and refused by the server while a job sits inside them.
 */
export function ScheduleView({
  drivers,
  fleet,
  rows,
  blocks,
  from,
  to,
  driverId,
  fleetVehicleId,
}: {
  drivers: ResourceOption[];
  fleet: ResourceOption[];
  rows: OccupancyRow[];
  blocks: ResourceBlock[];
  from: string;
  to: string;
  driverId: string | null;
  fleetVehicleId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [reason, setReason] = useState<BlockReason>("DAY_OFF");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`${pathname}?${next}`);
  };

  const resource = driverId ? `driver:${driverId}` : fleetVehicleId ? `vehicle:${fleetVehicleId}` : "";

  const chooseResource = (value: string) => {
    const [kind, id] = value.split(":");
    setParams({ driverId: kind === "driver" ? id : null, fleetVehicleId: kind === "vehicle" ? id : null });
  };

  const addBlock = async () => {
    setBusy("block");
    setError(null);

    try {
      await createBlock({
        driverId: driverId ?? undefined,
        fleetVehicleId: fleetVehicleId ?? undefined,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        reason,
        note: note.trim() || null,
      });
      setStartsAt("");
      setEndsAt("");
      setNote("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const removeBlock = async (id: string) => {
    setBusy(`remove-${id}`);
    setError(null);

    try {
      await deleteBlock(id);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const control =
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none";

  const byDay = rows.reduce<Record<string, OccupancyRow[]>>((groups, row) => {
    const day = row.windowStart.slice(0, 10);
    (groups[day] ??= []).push(row);
    return groups;
  }, {});

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-[0.75rem] font-semibold text-muted">
            Driver or car
            <select value={resource} onChange={(event) => chooseResource(event.target.value)} className={`${control} mt-1 block w-full`}>
              <option value="">Choose…</option>
              <optgroup label="Drivers">
                {drivers.map((driver) => (
                  <option key={driver.id} value={`driver:${driver.id}`}>
                    {driver.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Cars">
                {fleet.map((car) => (
                  <option key={car.id} value={`vehicle:${car.id}`}>
                    {car.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="text-[0.75rem] font-semibold text-muted">
            From
            <input type="date" value={from} onChange={(event) => setParams({ from: event.target.value })} className={`${control} mt-1 block`} />
          </label>
          <label className="text-[0.75rem] font-semibold text-muted">
            To
            <input type="date" value={to} onChange={(event) => setParams({ to: event.target.value })} className={`${control} mt-1 block`} />
          </label>
        </div>

        <div className="mt-6 rounded-sm border border-line bg-surface">
          {!resource ? (
            <p className="p-8 text-center text-[0.875rem] text-muted">Choose a driver or a car to see their diary.</p>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-[0.875rem] text-muted">Nothing in this window.</p>
          ) : (
            <ul className="divide-y divide-line">
              {Object.entries(byDay).map(([day, entries]) => (
                <li key={day} className="p-4">
                  <p className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{day}</p>
                  <ul className="mt-2 space-y-2">
                    {entries.map((row) => (
                      <li
                        key={`${row.sourceKind}-${row.sourceId}`}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-sm px-3 py-2 text-[0.8125rem] ${
                          row.sourceKind === "BLOCK" ? "bg-surface-soft text-muted" : "bg-brand-soft text-ink"
                        }`}
                      >
                        <span className="tabular-nums">
                          {formatPickup(row.windowStart, "Asia/Tbilisi")} – {formatPickup(row.windowEnd, "Asia/Tbilisi")}
                        </span>
                        <span>
                          {row.sourceKind === "BLOCK"
                            ? `Blocked · ${blockReasonLabels[row.status as BlockReason] ?? row.status}`
                            : `${row.bookingReference} · ${row.leadPassengerName ?? ""} · ${row.status?.toLowerCase()}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-8 lg:col-span-4">
        <AdminPanel title="Block time" description="A day off, a service. Refused while a job sits inside it.">
          {!resource ? (
            <p className="text-[0.8125rem] text-muted">Choose a driver or a car first.</p>
          ) : (
            <div className="space-y-4">
              <SelectInput
                label="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as BlockReason)}
                options={(Object.keys(blockReasonLabels) as BlockReason[]).map((value) => ({ value, label: blockReasonLabels[value] }))}
              />
              <TextInput label="From" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              <TextInput label="To" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
              <TextArea label="Note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
              <FormError message={error} />
              <SubmitButton busy={busy === "block"} disabled={!startsAt || !endsAt} onClick={() => void addBlock()}>
                Add block
              </SubmitButton>
            </div>
          )}
        </AdminPanel>

        {blocks.length > 0 && (
          <AdminPanel title="Blocks in this window">
            <ul className="divide-y divide-line">
              {blocks.map((block) => (
                <li key={block.id} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem] first:pt-0 last:pb-0">
                  <span>
                    <span className="block text-ink">{blockReasonLabels[block.reason]}{block.note ? ` · ${block.note}` : ""}</span>
                    <span className="block text-[0.75rem] text-subtle tabular-nums">
                      {formatPickup(block.startsAt, "Asia/Tbilisi")} – {formatPickup(block.endsAt, "Asia/Tbilisi")}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void removeBlock(block.id)}
                    aria-label="Remove block"
                    className="text-subtle hover:text-error-text disabled:opacity-50"
                  >
                    {busy === `remove-${block.id}` ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Trash2 size={15} aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </AdminPanel>
        )}
      </div>
    </div>
  );
}
