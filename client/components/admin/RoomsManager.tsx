"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BedDouble, Loader2, Plus, X } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import {
  archiveRatePlan,
  archiveRoomType,
  createRatePlan,
  createRoomType,
  setBeds,
} from "@/lib/api/hotels";
import { describeError } from "@/lib/api/client";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type {
  BedTypeCode,
  CancellationPolicy,
  HotelWithChecklist,
  MealPlanCode,
  PaymentPolicy,
  RoomType,
} from "@/types/catalogue";

/**
 * Rooms and their rate plans, edited in place.
 *
 * Every mutation calls the API and then `router.refresh()` — the page above is
 * a Server Component, and re-reading the record beats patching a local copy
 * that could drift. The forms are small on purpose: a room needs a name and
 * what it sleeps; a rate plan needs a board and its terms. Everything else has
 * a sensible default and can be edited after.
 *
 * Two capabilities meet here, as they do on the server: the rooms themselves
 * (name, occupancy, beds, archiving) are `catalogue.write`; the rate plans are
 * `pricing.write`, because a plan carries a currency and its policies carry
 * money. Each control follows its own, so a pricing desk can add an offer to a
 * room it cannot rename and vice versa.
 */

const BED_CODES: { code: BedTypeCode; label: string }[] = [
  { code: "SINGLE", label: "Single" },
  { code: "TWIN", label: "Twin" },
  { code: "DOUBLE", label: "Double" },
  { code: "QUEEN", label: "Queen" },
  { code: "KING", label: "King" },
  { code: "SOFA", label: "Sofa bed" },
  { code: "BUNK", label: "Bunk" },
  { code: "FUTON", label: "Futon" },
];

const MEAL_CODES: { code: MealPlanCode; label: string }[] = [
  { code: "RO", label: "Room only" },
  { code: "BB", label: "Bed & breakfast" },
  { code: "HB", label: "Half board" },
  { code: "HB_PLUS", label: "Half board plus" },
  { code: "FB", label: "Full board" },
  { code: "FB_PLUS", label: "Full board plus" },
  { code: "AI", label: "All inclusive" },
  { code: "UAI", label: "Ultra all inclusive" },
];

const field =
  "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";
const button =
  "inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

export function RoomsManager({
  hotel,
  cancellations,
  payments,
}: {
  hotel: HotelWithChecklist;
  cancellations: CancellationPolicy[];
  payments: PaymentPolicy[];
}) {
  const router = useRouter();
  const can = useCan();
  const canContent = can("catalogue.write");
  const canPricing = can("pricing.write");
  const [error, setError] = useState<string | null>(null);

  /** Wraps a mutation with the shared busy/error/refresh cycle. */
  const useAction = () => {
    const [busy, setBusy] = useState(false);

    const run = async (call: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await call();
        router.refresh();
        return true;
      } catch (caught) {
        setError(describeError(caught));
        return false;
      } finally {
        setBusy(false);
      }
    };

    return { busy, run };
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="rounded-sm border border-error/40 bg-error/8 px-4 py-3 text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}

      {/* One line for what the viewer cannot do here, not one per card. */}
      {!canContent && !canPricing ? (
        <ReadOnlyNote
          needs={["catalogue.write", "pricing.write"]}
          what="Editing room types or rate plans"
        />
      ) : !canContent ? (
        <ReadOnlyNote needs="catalogue.write" what="Adding, archiving or re-bedding room types" />
      ) : !canPricing ? (
        <ReadOnlyNote needs="pricing.write" what="Adding or archiving rate plans" />
      ) : null}

      {hotel.roomTypes.map((room) => (
        <RoomCard
          key={room.id}
          hotel={hotel}
          room={room}
          cancellations={cancellations}
          payments={payments}
          useAction={useAction}
          canContent={canContent}
          canPricing={canPricing}
        />
      ))}

      {canContent && <NewRoomForm hotel={hotel} useAction={useAction} />}
    </div>
  );
}

type ActionHook = () => { busy: boolean; run: (call: () => Promise<unknown>) => Promise<boolean> };

function RoomCard({
  hotel,
  room,
  cancellations,
  payments,
  useAction,
  canContent,
  canPricing,
}: {
  hotel: HotelWithChecklist;
  room: RoomType;
  cancellations: CancellationPolicy[];
  payments: PaymentPolicy[];
  useAction: ActionHook;
  canContent: boolean;
  canPricing: boolean;
}) {
  const localePath = useLocalePath();
  const { busy, run } = useAction();
  const [addingPlan, setAddingPlan] = useState(false);
  const [editingBeds, setEditingBeds] = useState(false);

  const bedsSummary =
    room.bedGroups.length > 0
      ? room.bedGroups
          .map((group) =>
            group.beds.map((bed) => `${bed.quantity} × ${bed.name}`).join(" + "),
          )
          .join("  or  ")
      : "No beds configured";

  return (
    <AdminPanel
      title={room.name}
      description={`${room.code} · sleeps ${room.occupancy.max} · ${bedsSummary}`}
      action={
        <div className="flex items-center gap-3">
          <Link
            href={localePath(`/admin/hotels/${hotel.id}/calendar?roomType=${room.id}`)}
            className="text-[0.8125rem] font-medium text-brand-text hover:text-brand-hover"
          >
            Calendar
          </Link>
          {canContent && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Archive ${room.name}? Its bookings stay readable.`)) {
                  void run(() => archiveRoomType(hotel.id, room.id));
                }
              }}
              className="text-[0.8125rem] font-medium text-error-text hover:underline"
            >
              Archive
            </button>
          )}
        </div>
      }
      bodyClassName="p-0"
    >
      {/* Rate plans: what this room is sold as. */}
      <ul className="divide-y divide-line">
        {room.ratePlans.length === 0 && (
          <li className="px-5 py-4 text-[0.8125rem] text-muted">
            Not for sale yet — it needs at least one rate plan.
          </li>
        )}
        {room.ratePlans.map((plan) => (
          <li key={plan.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p className="text-[0.875rem] font-medium text-ink">{plan.name}</p>
              <p className="text-[0.75rem] text-muted">
                {plan.mealPlan?.name ?? "No board"} · {plan.cancellation?.name ?? "No terms"} ·{" "}
                {plan.payment?.name ?? "No payment terms"} · {plan.currency}
              </p>
            </div>
            {canPricing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Archive the "${plan.name}" rate?`)) {
                    void run(() => archiveRatePlan(hotel.id, room.id, plan.id));
                  }
                }}
                aria-label={`Archive ${plan.name}`}
                className="text-subtle hover:text-error-text"
              >
                <X size={15} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>

      {(canPricing || canContent) && (
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
          {canPricing && (
            <button
              type="button"
              onClick={() => setAddingPlan((open) => !open)}
              className={cn(button, "border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft")}
            >
              <Plus size={14} aria-hidden />
              Rate plan
            </button>
          )}
          {canContent && (
            <button
              type="button"
              onClick={() => setEditingBeds((open) => !open)}
              className={cn(button, "border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft")}
            >
              <BedDouble size={14} aria-hidden />
              Beds
            </button>
          )}
        </div>
      )}

      {addingPlan && canPricing && (
        <NewRatePlanForm
          hotel={hotel}
          room={room}
          cancellations={cancellations}
          payments={payments}
          useAction={useAction}
          onDone={() => setAddingPlan(false)}
        />
      )}
      {editingBeds && canContent && (
        <BedsForm hotel={hotel} room={room} useAction={useAction} onDone={() => setEditingBeds(false)} />
      )}
    </AdminPanel>
  );
}

function NewRoomForm({ hotel, useAction }: { hotel: HotelWithChecklist; useAction: ActionHook }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(hotel.roomTypes.length === 0);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [maxOccupancy, setMaxOccupancy] = useState(2);
  const [maxAdults, setMaxAdults] = useState(2);
  const [maxChildren, setMaxChildren] = useState(0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(button, "self-start border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft")}
      >
        <Plus size={15} aria-hidden />
        Add a room type
      </button>
    );
  }

  return (
    <AdminPanel title="New room type" description="What it is called and how many it holds. Beds, amenities and images come after.">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await run(() =>
            createRoomType(hotel.id, {
              name: name.trim(),
              code: code.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              maxOccupancy,
              maxAdults,
              maxChildren,
              standardOccupancy: Math.min(2, maxOccupancy),
            }),
          );
          if (created) {
            setOpen(false);
            setName("");
            setCode("");
          }
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Deluxe Double" />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Code
          <input value={code} onChange={(e) => setCode(e.target.value)} className={cn(field, "w-28 font-mono")} placeholder="dlx" />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Sleeps
          <input type="number" min={1} max={30} value={maxOccupancy} onChange={(e) => setMaxOccupancy(Number(e.target.value))} className={cn(field, "w-20")} />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Max adults
          <input type="number" min={1} max={30} value={maxAdults} onChange={(e) => setMaxAdults(Number(e.target.value))} className={cn(field, "w-20")} />
        </label>
        <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
          Max children
          <input type="number" min={0} max={30} value={maxChildren} onChange={(e) => setMaxChildren(Number(e.target.value))} className={cn(field, "w-20")} />
        </label>
        <button type="submit" disabled={busy} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Create
        </button>
      </form>
    </AdminPanel>
  );
}

function NewRatePlanForm({
  hotel,
  room,
  cancellations,
  payments,
  useAction,
  onDone,
}: {
  hotel: HotelWithChecklist;
  room: RoomType;
  cancellations: CancellationPolicy[];
  payments: PaymentPolicy[];
  useAction: ActionHook;
  onDone: () => void;
}) {
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [mealPlanCode, setMealPlanCode] = useState<MealPlanCode>("BB");
  const [cancellationPolicyId, setCancellationPolicyId] = useState(cancellations[0]?.id ?? "");
  const [paymentPolicyId, setPaymentPolicyId] = useState(payments[0]?.id ?? "");

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const created = await run(() =>
          createRatePlan(hotel.id, room.id, {
            name: name.trim(),
            code: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            mealPlanCode,
            cancellationPolicyId,
            paymentPolicyId,
          }),
        );
        if (created) onDone();
      }}
      className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4"
    >
      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[0.8125rem] font-medium text-ink">
        Offer name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
          placeholder="Breakfast, flexible"
        />
      </label>
      <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
        Board
        <select
          value={mealPlanCode}
          onChange={(e) => setMealPlanCode(e.target.value as MealPlanCode)}
          className={field}
        >
          {MEAL_CODES.map((meal) => (
            <option key={meal.code} value={meal.code}>
              {meal.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
        Cancellation
        <select
          required
          value={cancellationPolicyId}
          onChange={(e) => setCancellationPolicyId(e.target.value)}
          className={field}
        >
          {cancellations.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name}
              {policy.isTemplate ? "" : " (this hotel)"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[0.8125rem] font-medium text-ink">
        Payment
        <select
          required
          value={paymentPolicyId}
          onChange={(e) => setPaymentPolicyId(e.target.value)}
          className={field}
        >
          {payments.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name}
              {policy.isTemplate ? "" : " (this hotel)"}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
        Add
      </button>
    </form>
  );
}

function BedsForm({
  hotel,
  room,
  useAction,
  onDone,
}: {
  hotel: HotelWithChecklist;
  room: RoomType;
  useAction: ActionHook;
  onDone: () => void;
}) {
  const { busy, run } = useAction();
  const [rows, setRows] = useState<{ bedTypeCode: BedTypeCode; quantity: number }[]>(
    room.bedGroups[0]?.beds.map((bed) => ({ bedTypeCode: bed.code, quantity: bed.quantity })) ?? [
      { bedTypeCode: "DOUBLE", quantity: 1 },
    ],
  );

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await run(() => setBeds(hotel.id, room.id, rows));
        if (saved) onDone();
      }}
      className="border-t border-line px-5 py-4"
    >
      <p className="text-[0.8125rem] text-muted">
        The beds this room is made up with. Quantities add; a second make-up (king <em>or</em> twins)
        can be added later.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={20}
              value={row.quantity}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, quantity: Number(e.target.value) } : r)))
              }
              aria-label="Quantity"
              className={cn(field, "w-16")}
            />
            <span aria-hidden>×</span>
            <select
              value={row.bedTypeCode}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, bedTypeCode: e.target.value as BedTypeCode } : r)))
              }
              aria-label="Bed type"
              className={field}
            >
              {BED_CODES.map((bed) => (
                <option key={bed.code} value={bed.code}>
                  {bed.label}
                </option>
              ))}
            </select>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                aria-label="Remove bed"
                className="text-subtle hover:text-error-text"
              >
                <X size={15} aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setRows([...rows, { bedTypeCode: "SINGLE", quantity: 1 }])}
          className={cn(button, "border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft")}
        >
          <Plus size={14} aria-hidden />
          Bed
        </button>
        <button type="submit" disabled={busy} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Save beds
        </button>
      </div>
    </form>
  );
}
