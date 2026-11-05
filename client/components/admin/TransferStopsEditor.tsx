"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { apiFetch, describeError } from "@/lib/api/client";
import type { TransferPoint, TransferRouteWithChecklist } from "@/types/transfer";

interface Draft {
  pointId: string;
  dwellMinutes: number;
}

/**
 * The places a multi-stop route calls at.
 *
 * Positions are never edited directly — they come from the order of the list,
 * and the endpoint renumbers from the array it is sent. That is deliberate: the
 * database has a unique constraint on (route, position), so a form that let
 * somebody type "2" twice would produce a 409 rather than the reorder they
 * meant.
 *
 * Only the intermediate stops are here. The two ends are the route, and moving
 * one of those makes it a different route.
 */
export function TransferStopsEditor({
  route,
  points,
}: {
  route: TransferRouteWithChecklist;
  points: TransferPoint[];
}) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [stops, setStops] = useState<Draft[]>(() =>
    route.stops.map((stop) => ({ pointId: stop.point.id, dwellMinutes: stop.dwellMinutes })),
  );
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(points.map((point) => [point.id, point]));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;

    const next = [...stops];
    [next[index], next[target]] = [next[target], next[index]];
    setStops(next);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);

    try {
      await apiFetch(`/api/admin/transfers/routes/${route.id}/stops`, {
        method: "PUT",
        body: { stops },
      });

      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not save the stops."));
    } finally {
      setSaving(false);
    }
  };

  const available = points.filter(
    (point) =>
      point.id !== route.from.id &&
      point.id !== route.to.id &&
      !stops.some((stop) => stop.pointId === point.id),
  );

  return (
    <div>
      <ol className="space-y-2">
        <li className="flex items-center gap-3 rounded-sm bg-surface-soft px-3 py-2">
          <span className="text-[0.75rem] font-semibold text-subtle">Start</span>
          <span className="text-[0.875rem] font-medium text-ink">{route.from.name}</span>
        </li>

        {stops.map((stop, index) => (
          <li
            key={stop.pointId}
            className="flex flex-wrap items-center gap-3 rounded-sm border border-line px-3 py-2"
          >
            <span className="text-[0.75rem] font-semibold text-subtle tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 text-[0.875rem] font-medium text-ink">
              {byId.get(stop.pointId)?.name ?? stop.pointId}
            </span>

            {canEdit ? (
              <>
                <label className="flex items-center gap-2">
                  <span className="text-[0.75rem] text-muted">Wait</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={stop.dwellMinutes}
                    onChange={(event) => {
                      const next = [...stops];
                      next[index] = {
                        ...stop,
                        dwellMinutes: Math.max(0, Number(event.target.value) || 0),
                      };
                      setStops(next);
                      setSaved(false);
                    }}
                    aria-label={`Minutes waiting at ${byId.get(stop.pointId)?.name ?? "this stop"}`}
                    className="h-8 w-20 rounded-sm border border-line bg-surface px-2 text-end text-[0.8125rem] tabular-nums focus:border-ink focus:outline-none"
                  />
                  <span className="text-[0.75rem] text-muted">min</span>
                </label>

                <span className="flex items-center gap-1">
                  <IconButton
                    label="Move up"
                    icon={ArrowUp}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  />
                  <IconButton
                    label="Move down"
                    icon={ArrowDown}
                    onClick={() => move(index, 1)}
                    disabled={index === stops.length - 1}
                  />
                  <IconButton
                    label="Remove"
                    icon={Trash2}
                    onClick={() => {
                      setStops(stops.filter((_, entry) => entry !== index));
                      setSaved(false);
                    }}
                  />
                </span>
              </>
            ) : (
              <span className="text-[0.75rem] text-muted tabular-nums">
                Wait {stop.dwellMinutes} min
              </span>
            )}
          </li>
        ))}

        <li className="flex items-center gap-3 rounded-sm bg-surface-soft px-3 py-2">
          <span className="text-[0.75rem] font-semibold text-subtle">End</span>
          <span className="text-[0.875rem] font-medium text-ink">{route.to.name}</span>
        </li>
      </ol>

      {!canEdit && (
        <ReadOnlyNote className="mt-5" needs="catalogue.write" what="Changing the stops" />
      )}

      {canEdit && (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="min-w-56 flex-1">
              <span className="mb-1.5 block text-[0.75rem] font-semibold text-muted">Add a stop</span>
              <select
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
                className="h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
              >
                <option value="">Choose a place…</option>
                {available.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.name} — {point.region}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={!adding}
              onClick={() => {
                setStops([...stops, { pointId: adding, dwellMinutes: 30 }]);
                setAdding("");
                setSaved(false);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/25 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:opacity-50"
            >
              <Plus size={15} aria-hidden />
              Add
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-sm border border-error/40 bg-surface px-4 py-3 text-[0.875rem] text-error-text"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {saved && <Check size={15} aria-hidden />}
            {saving ? "Saving…" : saved ? "Saved" : "Save stops"}
          </button>
        </>
      )}
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof ArrowUp;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-sm border border-line text-muted transition-colors hover:border-subtle hover:text-ink disabled:opacity-30"
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}
