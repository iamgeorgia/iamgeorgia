"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  FormError,
  LineListInput,
  NumberInput,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "./FormControls";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { updatePackage } from "@/lib/api/packages";
import { adjustmentKindLabels, adjustmentScopeLabels, adjustmentValueUnit } from "@/lib/admin/packages";
import { formatBps, formatMoney, toMinorUnits } from "@/lib/money";
import type { PackageAdjustmentKind, PackageWithChecklist } from "@/types/package";

const KINDS: PackageAdjustmentKind[] = ["NONE", "DISCOUNT_BPS", "FIXED_SELL", "PER_PERSON_FIXED"];

/** Basis points to a percentage string for the form, and back on save. */
const bpsToPercent = (bps: number): string => String(bps / 100);

/** The saved adjustment in one phrase, for a viewer who may not change it. */
const adjustmentSummary = (pkg: PackageWithChecklist): string => {
  const adjustment = pkg.adjustment;

  if (!adjustment || adjustment.kind === "NONE") return "None";

  const amount =
    adjustment.kind === "DISCOUNT_BPS"
      ? formatBps(adjustment.value)
      : formatMoney(adjustment.value, pkg.currency);

  return `${adjustmentKindLabels[adjustment.kind]} · ${amount} · ${adjustmentScopeLabels[adjustment.appliesTo]}`;
};

/**
 * Everything about a package that is not a slot: what it is called, when it
 * may be sold and travelled, who it fits, and how its price is adjusted.
 *
 * The adjustment field changes its own unit with its kind — a percentage for
 * a discount, money for a fixed price — because "1000" meaning ten per cent in
 * one row and ten currency units in the next is exactly the sort of ambiguity
 * that gets a package sold below cost.
 */
export function PackageDetailsEditor({ pkg }: { pkg: PackageWithChecklist }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");
  // The adjustment reprices the hotel inside the package, so the server wants
  // `pricing.write` on top of `catalogue.write` for those three fields and
  // refuses the whole PATCH otherwise. Without it they are shown as text and
  // left out of the body.
  const canPrice = can("pricing.write");

  const [name, setName] = useState(pkg.name);
  const [summary, setSummary] = useState(pkg.summary ?? "");
  const [description, setDescription] = useState(pkg.description);
  const [image, setImage] = useState(pkg.image ?? "");
  const [nights, setNights] = useState(pkg.nights);
  const [minAdults, setMinAdults] = useState(pkg.party.minAdults);
  const [maxAdults, setMaxAdults] = useState(pkg.party.maxAdults ?? 0);
  const [maxChildren, setMaxChildren] = useState(pkg.party.maxChildren ?? 0);
  const [maxPax, setMaxPax] = useState(pkg.party.maxPax ?? 0);
  const [validFrom, setValidFrom] = useState(pkg.validFrom ?? "");
  const [validUntil, setValidUntil] = useState(pkg.validUntil ?? "");
  const [sellableFrom, setSellableFrom] = useState(pkg.sellableFrom ?? "");
  const [sellableUntil, setSellableUntil] = useState(pkg.sellableUntil ?? "");

  const [kind, setKind] = useState<PackageAdjustmentKind>(pkg.adjustment?.kind ?? "NONE");
  const [value, setValue] = useState(() => {
    const adjustment = pkg.adjustment;

    if (!adjustment || adjustment.kind === "NONE") return "";

    return adjustment.kind === "DISCOUNT_BPS"
      ? bpsToPercent(adjustment.value)
      : String(adjustment.value / 100);
  });
  const [appliesTo, setAppliesTo] = useState(pkg.adjustment?.appliesTo ?? "REQUIRED_ONLY");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = () => setSaved(false);
  const unit = adjustmentValueUnit[kind];

  const save = async () => {
    setBusy(true);
    setError(null);

    // A percentage becomes basis points; money becomes minor units. Both are
    // integers by the time they leave here, as every amount on the platform is.
    const adjustmentValue =
      unit === "percent"
        ? Math.round(Number.parseFloat(value || "0") * 100)
        : unit === "money"
          ? (toMinorUnits(value || "0", pkg.currency) ?? 0)
          : 0;

    try {
      await updatePackage(pkg.id, {
        name: name.trim(),
        summary: summary.trim(),
        description,
        image: image.trim() || null,
        nights,
        minAdults,
        // Zero is how the form spells "no limit"; the API wants null.
        maxAdults: maxAdults > 0 ? maxAdults : null,
        maxChildren: maxChildren > 0 ? maxChildren : null,
        maxPax: maxPax > 0 ? maxPax : null,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        sellableFrom: sellableFrom || null,
        sellableUntil: sellableUntil || null,
        ...(canPrice
          ? { adjustmentKind: kind, adjustmentValue, adjustmentAppliesTo: appliesTo }
          : {}),
      });

      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-8"
    >
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Name"
          value={name}
          onChange={(event) => {
            dirty();
            setName(event.target.value);
          }}
        />
        <NumberInput
          label="Nights"
          hint="The length of the trip. Slot day offsets are measured against it."
          min={1}
          max={60}
          value={nights}
          onChange={(event) => {
            dirty();
            setNights(Number(event.target.value));
          }}
        />
        <TextArea
          label="Summary"
          hint="One or two sentences, shown on the card and under the title."
          rows={3}
          className="sm:col-span-2"
          value={summary}
          onChange={(event) => {
            dirty();
            setSummary(event.target.value);
          }}
        />
        <LineListInput
          label="Description"
          hint="One paragraph per line."
          className="sm:col-span-2"
          value={description}
          onChange={(next) => {
            dirty();
            setDescription(next);
          }}
        />
        <TextInput
          label="Editorial image"
          hint="A path under /public. The gallery cover wins over it once one exists."
          mono
          className="sm:col-span-2"
          value={image}
          onChange={(event) => {
            dirty();
            setImage(event.target.value);
          }}
        />
      </div>

      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-ink">Party</legend>
        <p className="mt-1 text-[0.75rem] text-subtle">
          Zero means no limit. A party outside these bounds cannot ask for a quote at all.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <NumberInput
            label="Minimum adults"
            min={1}
            max={60}
            value={minAdults}
            onChange={(event) => {
              dirty();
              setMinAdults(Number(event.target.value));
            }}
          />
          <NumberInput
            label="Maximum adults"
            min={0}
            max={60}
            value={maxAdults}
            onChange={(event) => {
              dirty();
              setMaxAdults(Number(event.target.value));
            }}
          />
          <NumberInput
            label="Maximum children"
            min={0}
            max={30}
            value={maxChildren}
            onChange={(event) => {
              dirty();
              setMaxChildren(Number(event.target.value));
            }}
          />
          <NumberInput
            label="Maximum travellers"
            min={0}
            max={90}
            value={maxPax}
            onChange={(event) => {
              dirty();
              setMaxPax(Number(event.target.value));
            }}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-ink">Windows</legend>
        <p className="mt-1 text-[0.75rem] text-subtle">
          Two different things: when the trip may be taken, and when it may be sold. Leave either
          blank for no restriction.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <TextInput
            label="Travel from"
            type="date"
            value={validFrom}
            onChange={(event) => {
              dirty();
              setValidFrom(event.target.value);
            }}
          />
          <TextInput
            label="Travel until"
            type="date"
            value={validUntil}
            onChange={(event) => {
              dirty();
              setValidUntil(event.target.value);
            }}
          />
          <TextInput
            label="On sale from"
            type="date"
            value={sellableFrom}
            onChange={(event) => {
              dirty();
              setSellableFrom(event.target.value);
            }}
          />
          <TextInput
            label="On sale until"
            type="date"
            value={sellableUntil}
            onChange={(event) => {
              dirty();
              setSellableUntil(event.target.value);
            }}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-ink">Adjustment</legend>
        <p className="mt-1 text-[0.75rem] text-subtle">
          Applied to the sum of the eligible parts after each has been marked up, then allocated
          back across them so the lines add to the total exactly. A fixed price below the parts&rsquo;
          net cost makes the package unquotable rather than loss-making.
        </p>
        {canPrice ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <SelectInput
              label="Kind"
              value={kind}
              options={KINDS.map((option) => ({ value: option, label: adjustmentKindLabels[option] }))}
              onChange={(event) => {
                dirty();
                setKind(event.target.value as PackageAdjustmentKind);
                setValue("");
              }}
            />
            {unit !== "none" && (
              <TextInput
                label={unit === "percent" ? "Discount (%)" : `Price (${pkg.currency})`}
                hint={
                  unit === "percent"
                    ? "10 means ten per cent off the eligible parts."
                    : "The total the buyer pays, in major units."
                }
                inputMode="decimal"
                value={value}
                onChange={(event) => {
                  dirty();
                  setValue(event.target.value);
                }}
              />
            )}
            {kind !== "NONE" && (
              <SelectInput
                label="Applies to"
                value={appliesTo}
                options={(["REQUIRED_ONLY", "ALL_ITEMS"] as const).map((scope) => ({
                  value: scope,
                  label: adjustmentScopeLabels[scope],
                }))}
                onChange={(event) => {
                  dirty();
                  setAppliesTo(event.target.value as "REQUIRED_ONLY" | "ALL_ITEMS");
                }}
              />
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-[0.875rem] text-ink">{adjustmentSummary(pkg)}</p>
            {canEdit && <ReadOnlyNote needs="pricing.write" what="Changing the adjustment" />}
          </div>
        )}
        {pkg.priceFrom && (
          <p className="mt-3 text-[0.75rem] text-subtle">
            Last sampled from price:{" "}
            {formatMoney(pkg.priceFrom.amountCents, pkg.priceFrom.currency)}. Indicative only — the
            quote preview is the real figure.
          </p>
        )}
      </fieldset>
      </fieldset>

      <FormError message={error} />

      {canEdit ? (
        <div>
          <SubmitButton type="submit" busy={busy} saved={saved}>
            Save details
          </SubmitButton>
        </div>
      ) : (
        <ReadOnlyNote needs="catalogue.write" what="Editing this package" />
      )}
    </form>
  );
}
