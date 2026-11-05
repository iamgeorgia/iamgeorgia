"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { useCan } from "@/components/admin/AdminViewerContext";
import { DeadlineModal, type MoveOutcome } from "@/components/admin/deadlines/DeadlineModal";
import { DeadlineKindBadge, DeadlineStatusBadge } from "@/components/admin/StatusBadge";
import { todayISO } from "@/lib/admin/dates";
import {
  DEADLINE_KINDS,
  deadlineDueWords,
  deadlineSourceLabels,
  formatDeadlineInstant,
  isDeadlineMovable,
  moveCapabilitiesFor,
} from "@/lib/admin/deadlines";
import { describeError } from "@/lib/api/client";
import { listDeadlinesClient } from "@/lib/api/deadlines";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { BookingApprovalProduct } from "@/types/booking";
import type { Deadline } from "@/types/deadline";

/**
 * The Deadlines panel on every booking and order detail page: the three
 * rows — payment, free cancellation, confirmation — with their due moment,
 * status and source, and **Edit** for whoever may move that kind.
 *
 * One exact read: `GET /admin/deadlines?reference=` answers the booking's
 * own rows and nothing else.
 */
export function BookingDeadlinesPanel({
  product,
  reference,
  lastDate,
}: {
  product: BookingApprovalProduct;
  reference: string;
  /** `YYYY-MM-DD` — the last service date: check-out, the return pick-up, the tour's end. Where the calendar link opens. */
  lastDate: string;
}) {
  const can = useCan();
  const localePath = useLocalePath();
  const today = todayISO();

  const [rows, setRows] = useState<Deadline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Deadline | null>(null);

  useEffect(() => {
    let stale = false;
    listDeadlinesClient({ product, reference, sort: "soonest", pageSize: 10 })
      .then((result) => {
        if (stale) return;
        setRows(result.data.filter((row) => row.reference === reference));
        setError(null);
      })
      .catch((failure: unknown) => {
        if (stale) return;
        setError(describeError(failure, "The deadlines could not be read."));
        setRows((current) => current ?? []);
      });
    return () => {
      stale = true;
    };
  }, [product, reference]);

  const onMoved = (outcome: MoveOutcome) => {
    if (outcome.kind !== "moved") return;
    const moved = outcome.deadline;
    setRows((current) => (current ?? []).map((row) => (row.id === moved.id ? { ...row, ...moved, history: undefined } : row)));
  };

  const byKind = new Map((rows ?? []).map((row) => [row.kind, row]));

  return (
    <AdminPanel
      title="Deadlines"
      description="Payment due, free cancellation and confirmation, in the booking's own time zone."
      action={
        can("bookings.read") ? (
          <Link
            href={localePath(`/admin/deadlines?view=day&from=${lastDate.slice(0, 10)}&product=${product}`)}
            prefetch={false}
            className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
          >
            Open calendar
          </Link>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {rows === null ? (
        <p className="flex items-center gap-2 px-5 py-6 text-[0.8125rem] text-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Loading deadlines…
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="border-b border-line px-5 py-3 text-[0.8125rem] text-error-text">
              {error}
            </p>
          )}
          <ul className="divide-y divide-line">
            {DEADLINE_KINDS.map((kind) => {
              const row = byKind.get(kind);
              if (!row) {
                return (
                  <li key={kind} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <DeadlineKindBadge kind={kind} className="opacity-60" />
                    <span className="text-[0.8125rem] text-subtle">
                      {kind === "PAYMENT" && product !== "ORDER" ? "None — billed on its order, or not yet billed" : "None"}
                    </span>
                  </li>
                );
              }
              const mayEdit = can(...moveCapabilitiesFor(kind)) && isDeadlineMovable(row.status);
              return (
                <li key={kind} className="flex flex-col gap-2 px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <DeadlineKindBadge kind={kind} overdue={row.overdue} />
                    <DeadlineStatusBadge status={row.status} />
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-[0.875rem] font-medium text-ink">{formatDeadlineInstant(row.dueAt, row.timezone, false)}</span>
                    <span className={cn("text-[0.75rem]", row.overdue ? "font-medium text-error-text" : "text-muted")}>{deadlineDueWords(row, today)}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-muted">
                    <span>
                      {deadlineSourceLabels[row.source]} · {row.timezone}
                    </span>
                    <span className="flex items-center gap-3">
                      <button type="button" onClick={() => setOpen(row)} className="font-medium text-brand-text underline-offset-4 hover:underline">
                        {mayEdit ? "Edit" : "History"}
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <DeadlineModal deadline={open} today={today} onClose={() => setOpen(null)} onMoved={onMoved} />
    </AdminPanel>
  );
}
