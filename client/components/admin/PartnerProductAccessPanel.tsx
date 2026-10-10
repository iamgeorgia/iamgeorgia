"use client";

import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { EntityPicker, type PickerOption } from "./EntityPicker";
import { FormError, SelectInput, SubmitButton, TextInput } from "./FormControls";
import { ApiError, describeError } from "@/lib/api/client";
import { setProductAccess } from "@/lib/api/partners";
import { PRODUCT_TYPES, productTypeLabels, searchProductOptions } from "@/lib/admin/partnerAccess";
import { cn } from "@/lib/utils";
import type { ProductAccessEntry, ProductAccessMode, ProductAccessType } from "@/types/partner";

/**
 * What one partner may see and book.
 *
 * The rule is the server's and is spelled out on screen: no rows means the
 * partner sees everything; a DENY row hides that product; any ALLOW row turns
 * the list into an allow-list for that product type. Saving replaces the whole
 * list in one request, so what is on screen after saving is exactly what the
 * server holds.
 */

interface Row {
  key: string;
  productType: ProductAccessType;
  productId: string;
  name: string;
  mode: ProductAccessMode;
  note: string;
}

const fromEntry = (entry: ProductAccessEntry): Row => ({
  key: entry.id,
  productType: entry.productType,
  productId: entry.productId,
  name: entry.product?.name ?? "A product that no longer exists",
  mode: entry.mode,
  note: entry.note ?? "",
});

const modeOptions: { value: ProductAccessMode; label: string }[] = [
  { value: "ALLOW", label: "Allow" },
  { value: "DENY", label: "Deny" },
];

const typeOptions = PRODUCT_TYPES.map((value) => ({ value, label: productTypeLabels[value] }));

export function PartnerProductAccessPanel({
  partnerId,
  entries,
  canEdit,
}: {
  partnerId: string;
  entries: ProductAccessEntry[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => entries.map(fromEntry));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<ProductAccessType>("HOTEL");
  const [choice, setChoice] = useState<PickerOption | null>(null);
  const [mode, setMode] = useState<ProductAccessMode>("DENY");
  const [note, setNote] = useState("");
  const [pickerKey, setPickerKey] = useState(0);
  const [addError, setAddError] = useState<string | null>(null);

  const change = (next: Row[]) => {
    setRows(next);
    setDirty(true);
    setSaved(false);
    setError(null);
  };

  const add = () => {
    if (!choice) {
      setAddError("Choose a product first.");
      return;
    }
    if (rows.some((row) => row.productType === type && row.productId === choice.id)) {
      setAddError("That product is already in the list. Change its row instead.");
      return;
    }
    setAddError(null);
    change([
      ...rows,
      { key: `new-${type}-${choice.id}`, productType: type, productId: choice.id, name: choice.label, mode, note: note.trim() },
    ]);
    setChoice(null);
    setNote("");
    setPickerKey((value) => value + 1);
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      const result = await setProductAccess(
        partnerId,
        rows.map((row) => ({
          productType: row.productType,
          productId: row.productId,
          mode: row.mode,
          ...(row.note.trim() ? { note: row.note.trim() } : {}),
        })),
      );
      setRows(result.data.map(fromEntry));
      setDirty(false);
      setSaved(true);
      router.refresh();
    } catch (caught) {
      const details = caught instanceof ApiError ? (caught.details as { reason?: string } | null) : null;
      setError(
        details?.reason === "UNKNOWN_PRODUCT"
          ? "One of these products no longer exists. Remove it and save again."
          : describeError(caught, "Could not save what this partner may sell."),
      );
    } finally {
      setBusy(false);
    }
  };

  const grouped = PRODUCT_TYPES.map((value) => ({
    type: value,
    rows: rows.filter((row) => row.productType === value),
  })).filter((group) => group.rows.length > 0);

  return (
    <AdminPanel
      title="What this partner may sell"
      description="With no rows, the partner sees everything. A Deny row hides that product. Any Allow row turns the list for that product type into an allow-list: only the allowed ones show."
    >
      {grouped.length === 0 ? (
        <p className="text-[0.875rem] text-body">No limits. This partner can see and book everything.</p>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => {
            const hasAllow = group.rows.some((row) => row.mode === "ALLOW");
            return (
              <section key={group.type}>
                <h3 className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">
                  {productTypeLabels[group.type]}
                  <span className="ms-2 font-normal normal-case">
                    {hasAllow ? "Allow-list: only the allowed ones show" : "Everything except the denied ones"}
                  </span>
                </h3>
                <ul className="mt-2 divide-y divide-line rounded-sm border border-line">
                  {group.rows.map((row) => (
                    <li key={row.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1 text-[0.875rem] text-ink">
                        {row.name}
                        {row.note && <span className="block text-[0.75rem] text-muted">{row.note}</span>}
                      </span>
                      {canEdit ? (
                        <>
                          <select
                            aria-label={`Mode for ${row.name}`}
                            value={row.mode}
                            onChange={(event) =>
                              change(rows.map((item) => (item.key === row.key ? { ...item, mode: event.target.value as ProductAccessMode } : item)))
                            }
                            className="h-9 rounded-sm border border-line bg-surface px-2 text-[0.8125rem] text-ink"
                          >
                            {modeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            aria-label={`Remove ${row.name}`}
                            onClick={() => change(rows.filter((item) => item.key !== row.key))}
                            className="inline-flex size-9 items-center justify-center rounded-sm text-muted transition-colors hover:text-error-text"
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </>
                      ) : (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[0.75rem]",
                            row.mode === "DENY" ? "bg-error/12 text-error-text" : "bg-surface-soft text-body",
                          )}
                        >
                          {row.mode === "DENY" ? "Deny" : "Allow"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="mt-5 space-y-4 border-t border-line pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput
              label="Kind of product"
              value={type}
              options={typeOptions}
              onChange={(event) => {
                setType(event.target.value as ProductAccessType);
                setChoice(null);
                setPickerKey((value) => value + 1);
              }}
            />
            <SelectInput
              label="Rule"
              value={mode}
              options={modeOptions}
              onChange={(event) => setMode(event.target.value as ProductAccessMode)}
            />
          </div>
          <EntityPicker
            key={`${type}-${pickerKey}`}
            label="Product"
            value={choice?.id ?? ""}
            valueLabel={choice?.label}
            onChange={setChoice}
            search={searchProductOptions[type]}
            placeholder="Search by name"
            error={addError ?? undefined}
          />
          <TextInput label="Note (optional)" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
          <button
            type="button"
            onClick={add}
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
          >
            <Plus size={15} aria-hidden />
            Add to the list
          </button>

          <FormError message={error} />

          <div className="flex items-center justify-end gap-3">
            {dirty && <span className="text-[0.75rem] text-muted">Unsaved changes</span>}
            <SubmitButton busy={busy} saved={saved && !dirty} disabled={!dirty} onClick={save}>
              {saved && !dirty ? "Saved" : "Save changes"}
            </SubmitButton>
          </div>
        </div>
      )}
    </AdminPanel>
  );
}
