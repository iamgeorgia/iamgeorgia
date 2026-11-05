"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, UserRound } from "lucide-react";
import { useState } from "react";

import { AdminDefinitionList, AdminPanel } from "@/components/admin/AdminPage";
import { useCan } from "@/components/admin/AdminViewerContext";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { FormError, SubmitButton, TextArea } from "@/components/admin/FormControls";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import { bookingSourceLabel } from "@/lib/admin/bookings";
import { describeError } from "@/lib/api/client";
import { updateDesk } from "@/lib/api/manualBookings";
import { listUsersClient } from "@/lib/api/users";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { BookingApprovalProduct, BookingDesk } from "@/types/booking";

/**
 * The Desk panel on a booking or order detail page: who the booking is for,
 * where it came from, who is handling it, and the notes the desk keeps for
 * itself. Present only for staff who may see the buyer — the server sends
 * `desk` to nobody else, and this renders nothing without it.
 *
 * The manager and the notes are the two fields that may change after the
 * booking exists (`PATCH …/:reference/desk`). The price adjustment is shown
 * but not edited here: it was set when the booking was made and audited then.
 */
export function BookingDeskPanel({
  product,
  reference,
  desk,
  currency,
}: {
  product: BookingApprovalProduct;
  reference: string;
  desk: BookingDesk | undefined;
  currency: string;
}) {
  const can = useCan();
  const router = useRouter();
  const localePath = useLocalePath();

  const [editing, setEditing] = useState(false);
  const [managerId, setManagerId] = useState(desk?.assignedManager?.id ?? "");
  const [managerLabel, setManagerLabel] = useState<string | null>(desk?.assignedManager?.name ?? null);
  const [notes, setNotes] = useState(desk?.internalNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!desk) return null;

  const canEdit = can("bookings.write");

  const searchStaff = async (term: string): Promise<PickerOption[]> => {
    const found = await listUsersClient("staff", { q: term || undefined, pageSize: 10 });
    return found.data.map((user) => ({ id: user.id, label: user.fullName, meta: user.email }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      await updateDesk(product, reference, {
        assignedManagerUserId: managerId || null,
        internalNotes: notes.trim() || null,
      });
      setSaved(true);
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught, "Could not save the desk notes."));
    } finally {
      setBusy(false);
    }
  };

  const customer = desk.customer;

  return (
    <AdminPanel
      title="Desk"
      description="Who this booking is for, and who is handling it."
      action={
        canEdit && !editing ? (
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
            className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
          >
            Edit
          </button>
        ) : undefined
      }
    >
      {customer && (
        <Link
          href={localePath(`/admin/customers/${customer.id}`)}
          prefetch={false}
          className="mb-4 flex items-start gap-3 rounded-sm border border-line bg-surface-soft/60 p-3 transition-colors hover:border-ink"
        >
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
            {customer.kind === "COMPANY" ? <Building2 size={15} aria-hidden /> : <UserRound size={15} aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[0.875rem] font-medium text-ink">{customer.name}</span>
            <span className="block truncate text-[0.75rem] text-muted">
              {customer.kind === "COMPANY" ? "Company" : "Individual"}
              {customer.contactName ? ` · ${customer.contactName}` : ""}
            </span>
            <span className="block truncate text-[0.75rem] text-muted">
              {customer.email}
              {customer.phone ? ` · ${customer.phone}` : ""}
            </span>
          </span>
        </Link>
      )}

      {!editing ? (
        <AdminDefinitionList
          items={[
            { label: "Source", value: bookingSourceLabel(desk.source) },
            ...(customer ? [] : [{ label: "Customer", value: "—" }]),
            { label: "Assigned manager", value: desk.assignedManager?.name ?? "Nobody yet" },
            ...(desk.priceAdjustment
              ? [
                  {
                    label: desk.priceAdjustment.cents < 0 ? "Discount" : "Supplement",
                    value: (
                      <span>
                        {formatMoney(desk.priceAdjustment.cents, currency)}
                        {desk.priceAdjustment.reason && (
                          <span className="block text-[0.75rem] font-normal text-muted">{desk.priceAdjustment.reason}</span>
                        )}
                      </span>
                    ),
                  },
                ]
              : []),
            {
              label: "Internal notes",
              value: desk.internalNotes ? (
                <span className="block text-start whitespace-pre-wrap">{desk.internalNotes}</span>
              ) : (
                "—"
              ),
            },
          ]}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <EntityPicker
            label="Assigned manager"
            hint="The member of staff handling this booking."
            value={managerId}
            valueLabel={managerLabel}
            onChange={(choice) => {
              setManagerId(choice?.id ?? "");
              setManagerLabel(choice?.label ?? null);
              setSaved(false);
            }}
            search={searchStaff}
            placeholder="Nobody yet"
            clearLabel="Nobody"
          />
          <TextArea
            label="Internal notes"
            hint="For the desk only. Never shown to the buyer or the supplier."
            rows={4}
            maxLength={2000}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setSaved(false);
            }}
          />
          <FormError message={error} />
          <div className="flex items-center gap-2">
            <SubmitButton busy={busy} saved={saved} onClick={save}>
              Save
            </SubmitButton>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setManagerId(desk.assignedManager?.id ?? "");
                setManagerLabel(desk.assignedManager?.name ?? null);
                setNotes(desk.internalNotes ?? "");
                setError(null);
              }}
              className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!canEdit && <ReadOnlyNote needs="bookings.write" what="Assigning a manager or editing the notes" className="mt-4" />}
    </AdminPanel>
  );
}
