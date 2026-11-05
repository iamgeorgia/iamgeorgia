"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { Cell, DataTable, EmptyRow, Row } from "./DataTable";
import {
  CheckboxField,
  Field,
  FormError,
  NumberInput,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import {
  createTransferExtra,
  retireTransferExtra,
  updateTransferExtra,
  type TransferExtraInput,
} from "@/lib/api/transfers";
import { extraBasisLabels, extraBasisOptions, vehicleClassOptions } from "@/lib/admin/transfers";
import { formatBps, formatMoney, percentToBps, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TransferExtra, TransferExtraBasis, TransferVehicleClass } from "@/types/transfer";

/**
 * The add-on catalogue.
 *
 * A short list that changes once a season, so it is one screen rather than a
 * register with detail pages behind it: seeing a child seat priced beside a ski
 * rack is how the two get priced sensibly relative to each other, and that is
 * lost the moment each one lives on its own page.
 *
 * Each row expands into its own form and saves on its own. The previous
 * arrangement — every price in one form under one button — was fine while
 * prices were the only editable thing, but a single button that writes a
 * dozen records is the wrong shape once a row can also change its basis or be
 * retired: one bad field should fail one row, not the batch.
 *
 * **The percent trick.** A PERCENT extra stores basis points in the same
 * column that every other basis stores minor units in. The serialiser splits
 * them apart on the way out (`priceCents` / `percentBps`) but the write path
 * has one field, so this component converts back at the edge — a percentage in
 * the input, basis points in the body. Getting that backwards turns a 60% fee
 * into ₾0.60, which is why the conversion happens in exactly one place here.
 *
 * **Retiring, not deleting.** A booking records the code it bought, so a
 * support conversation six months later still has to be able to say what
 * "skiEquipment" was. Retired extras stay listed, greyed, and can be brought
 * back.
 */

/** One row's fields, as the inputs hold them. */
interface ExtraValues {
  code: string;
  name: string;
  description: string;
  basis: TransferExtraBasis;
  /** Major units for a money basis; a plain percentage for PERCENT. */
  amount: string;
  appliesToClasses: TransferVehicleClass[];
  position: string;
}

const valuesFrom = (extra: TransferExtra): ExtraValues => ({
  code: extra.code,
  name: extra.name,
  description: extra.description ?? "",
  basis: extra.basis,
  amount:
    extra.basis === "PERCENT"
      ? String((extra.percentBps ?? 0) / 100)
      : toMajorUnits(extra.priceCents ?? undefined),
  appliesToClasses: extra.appliesToClasses,
  position: String(extra.position),
});

const emptyValues = (position: number): ExtraValues => ({
  code: "",
  name: "",
  description: "",
  basis: "FIXED",
  amount: "",
  appliesToClasses: [],
  position: String(position),
});

/**
 * The form's amount back to the single column the server keeps it in.
 *
 * Basis points for a PERCENT extra, minor units for everything else — the one
 * place the two meanings of that column are reconciled.
 */
const amountToStored = (values: ExtraValues): number | null => {
  if (values.basis === "PERCENT") {
    const percent = Number.parseFloat(values.amount.replace(",", "."));
    return Number.isFinite(percent) ? percentToBps(percent) : null;
  }

  return toMinorUnits(values.amount);
};

const bodyFrom = (values: ExtraValues, stored: number): TransferExtraInput => ({
  code: values.code.trim(),
  name: values.name.trim(),
  description: values.description.trim() || null,
  basis: values.basis,
  priceCents: stored,
  appliesToClasses: values.appliesToClasses,
  position: Number(values.position) || 0,
});

export function TransferExtrasEditor({ extras }: { extras: TransferExtra[] }) {
  const router = useRouter();
  const can = useCan();
  // Creating, repricing and retiring an extra are all catalogue writes; the
  // table already shows every figure, so a reader loses only the row editors.
  const canEdit = can("catalogue.write");

  const [openCode, setOpenCode] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const nextPosition = Math.max(0, ...extras.map((extra) => extra.position)) + 1;

  return (
    <div>
      <div className="rounded-sm border border-line bg-surface">
        <DataTable
          caption="Transfer extras"
          columns={[
            { label: "Extra" },
            { label: "Charged", hideBelow: "md" },
            { label: "Applies to", hideBelow: "lg" },
            { label: "Price", align: "end" },
            { label: "", align: "end" },
          ]}
        >
          {extras.length === 0 ? (
            <EmptyRow colSpan={5} message="No extras configured yet." />
          ) : (
            extras.map((extra) => {
              const retired = extra.isActive === false;
              const open = openCode === extra.code;

              return [
                <Row key={extra.code} className={retired ? "opacity-60" : undefined}>
                  <Cell>
                    <span className="font-medium text-ink">{extra.name}</span>
                    <span className="type-caption mt-0.5 block text-subtle">
                      <span className="font-mono">{extra.code}</span>
                      {retired && " · retired"}
                    </span>
                  </Cell>
                  <Cell hideBelow="md">{extraBasisLabels[extra.basis]}</Cell>
                  <Cell hideBelow="lg">
                    {extra.appliesToClasses.length === 0
                      ? "Every class"
                      : extra.appliesToClasses
                          .map(
                            (entry) =>
                              vehicleClassOptions.find((option) => option.value === entry)
                                ?.label ?? entry,
                          )
                          .join(", ")}
                  </Cell>
                  <Cell align="end" className="tabular-nums">
                    {extra.basis === "PERCENT"
                      ? `${formatBps(extra.percentBps ?? 0)} of the fare`
                      : formatMoney(extra.priceCents ?? 0, extra.currency)}
                  </Cell>
                  <Cell align="end">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setOpenCode(open ? null : extra.code)}
                        aria-expanded={open}
                        className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[0.75rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
                      >
                        {open ? "Close" : "Edit"}
                        <ChevronDown
                          size={13}
                          aria-hidden
                          className={cn("transition-transform", open && "rotate-180")}
                        />
                      </button>
                    )}
                  </Cell>
                </Row>,

                open && canEdit && (
                  <tr key={`${extra.code}-editor`} className="bg-surface-soft/50">
                    <td colSpan={5} className="px-4 py-5">
                      <ExtraForm
                        initial={valuesFrom(extra)}
                        retired={retired}
                        onDone={() => {
                          setOpenCode(null);
                          router.refresh();
                        }}
                      />
                    </td>
                  </tr>
                ),
              ];
            })
          )}
        </DataTable>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
        Extras are offered on every route. A retired one stays on this list because bookings record
        the code they bought — it is hidden from travellers, not erased.
      </p>

      {!canEdit ? (
        <ReadOnlyNote className="mt-5" needs="catalogue.write" what="Adding, repricing or retiring an extra" />
      ) : adding ? (
        <div className="mt-5 rounded-sm border border-line bg-surface p-5">
          <p className="mb-4 text-[0.9375rem] font-semibold text-ink">A new extra</p>
          <ExtraForm
            creating
            existingCodes={extras.map((extra) => extra.code)}
            initial={emptyValues(nextPosition)}
            onDone={() => {
              setAdding(false);
              router.refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
        >
          <Plus size={15} aria-hidden />
          Add an extra
        </button>
      )}
    </div>
  );
}

/**
 * One extra, created or edited.
 *
 * `code` is the primary key and the endpoint is an upsert, so on a create it
 * is checked against the codes already on the page before the request goes
 * out: posting a code that exists would silently overwrite that extra rather
 * than failing, and "I added a ski rack and the child seat changed price" is
 * not a bug report anybody enjoys.
 */
function ExtraForm({
  initial,
  creating = false,
  retired = false,
  existingCodes = [],
  onDone,
  onCancel,
}: {
  initial: ExtraValues;
  creating?: boolean;
  retired?: boolean;
  existingCodes?: string[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<ExtraValues>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof ExtraValues>(key: K, value: ExtraValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const isPercent = values.basis === "PERCENT";

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await action();
      setSaved(true);
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const code = values.code.trim();

    if (!code) {
      setFieldErrors({ code: "A code is required." });
      return;
    }

    if (creating && existingCodes.includes(code)) {
      setFieldErrors({
        code: `“${code}” already exists. Edit that row instead — saving this would overwrite it.`,
      });
      return;
    }

    const stored = amountToStored(values);

    if (stored === null || stored < 0) {
      setFieldErrors({
        amount: isPercent ? "Give a percentage of the fare." : "Give a price.",
      });
      return;
    }

    const body = bodyFrom(values, stored);

    return run(() =>
      creating ? createTransferExtra(body) : updateTransferExtra(initial.code, body),
    );
  };

  return (
    <div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          label="Name"
          required
          value={values.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Child seat"
          error={fieldErrors.name}
        />

        <TextInput
          label="Code"
          required
          mono
          readOnly={!creating}
          value={values.code}
          onChange={(event) => set("code", event.target.value.trim())}
          placeholder="childSeat"
          error={fieldErrors.code}
          hint={
            creating
              ? "The key bookings record. Pick it carefully — it cannot be changed later."
              : "Fixed: bookings already reference it."
          }
        />
      </div>

      <TextArea
        className="mt-5"
        label="Description"
        rows={2}
        value={values.description}
        onChange={(event) => set("description", event.target.value)}
        error={fieldErrors.description}
        hint="One line, shown under the name when the traveller picks their extras."
      />

      <div className="mt-5 grid gap-5 sm:grid-cols-3">
        <SelectInput
          label="Charged"
          value={values.basis}
          onChange={(event) => set("basis", event.target.value as TransferExtraBasis)}
          options={extraBasisOptions}
          error={fieldErrors.basis}
        />

        <NumberInput
          label={isPercent ? "Share of the fare (%)" : "Price (GEL)"}
          required
          min={0}
          step={isPercent ? "0.01" : "0.01"}
          value={values.amount}
          onChange={(event) => set("amount", event.target.value)}
          error={fieldErrors.amount ?? fieldErrors.priceCents}
          hint={
            isPercent
              ? "A percentage of the fare, not an amount."
              : undefined
          }
        />

        <NumberInput
          label="Position"
          min={0}
          max={999}
          step={1}
          value={values.position}
          onChange={(event) => set("position", event.target.value)}
          error={fieldErrors.position}
          hint="Lower shows first."
        />
      </div>

      <Field
        className="mt-5"
        label="Applies to"
        hint="Leave everything unticked to offer it on every class."
        error={fieldErrors.appliesToClasses}
      >
        <div className="grid gap-2.5 sm:grid-cols-3">
          {vehicleClassOptions.map((option) => (
            <CheckboxField
              key={option.value}
              label={option.label}
              checked={values.appliesToClasses.includes(option.value)}
              onChange={(next) =>
                set(
                  "appliesToClasses",
                  next
                    ? [...values.appliesToClasses, option.value]
                    : values.appliesToClasses.filter((entry) => entry !== option.value),
                )
              }
            />
          ))}
        </div>
      </Field>

      <FormError message={error} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SubmitButton busy={busy} saved={saved} onClick={save}>
          {busy ? "Saving…" : creating ? "Add extra" : "Save extra"}
        </SubmitButton>

        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
        )}

        {!creating && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() =>
                retired
                  ? updateTransferExtra(initial.code, { isActive: true })
                  : retireTransferExtra(initial.code),
              )
            }
            className={cn(
              "ms-auto inline-flex h-10 items-center gap-2 rounded-sm border bg-surface px-4 text-[0.8125rem] font-medium transition-colors disabled:opacity-60",
              retired
                ? "border-line text-body hover:border-ink/40 hover:text-ink"
                : "border-error/40 text-error-text hover:bg-error/8",
            )}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : retired ? (
              <RotateCcw size={15} aria-hidden />
            ) : (
              <Trash2 size={15} aria-hidden />
            )}
            {retired ? "Offer it again" : "Retire this extra"}
          </button>
        )}
      </div>
    </div>
  );
}
