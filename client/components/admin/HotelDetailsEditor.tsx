"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { setHotelAmenities, updateHotel } from "@/lib/api/hotels";
import { describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { KOSHER_AMENITY_CATEGORIES, type CatalogueAmenity, type Hotel } from "@/types/catalogue";

/**
 * Everything about a property that is words and times.
 *
 * This is the screen behind most of the publish checklist: the short
 * description search cards show, the long description the hotel page tells,
 * the guest-facing policies, the check-in and check-out times, and the
 * amenity checklist.
 *
 * Two things about times, because they are subtler than they look:
 *
 *   * `checkInFrom` and friends are **wall-clock times at the property**
 *     (HH:MM), not instants. The server refuses anything else, and the
 *     cancellation engine resolves deadlines against them in the hotel's own
 *     time zone.
 *   * The machine times and the prose policy ("Check-in from 15:00") are
 *     separate fields on purpose — one is computed against, the other is read
 *     by guests. Editing the times here keeps the prose line in step unless
 *     the operator has written something more specific.
 *
 * One save button, two API calls: the field PATCH and the amenity set. The
 * amenity set replaces the whole selection, which is what a checklist means.
 */
export function HotelDetailsEditor({
  hotel,
  vocabulary,
}: {
  hotel: Hotel;
  /** Every hotel-applicable amenity, grouped for the checklist. */
  vocabulary: CatalogueAmenity[];
}) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [checkInFrom, setCheckInFrom] = useState(hotel.checkIn.from ?? "");
  const [checkInUntil, setCheckInUntil] = useState(hotel.checkIn.until ?? "");
  const [checkOutFrom, setCheckOutFrom] = useState(hotel.checkOut.from ?? "");
  const [checkOutUntil, setCheckOutUntil] = useState(hotel.checkOut.until ?? "");

  const [shortDescription, setShortDescription] = useState(hotel.shortDescription ?? "");
  const [summary, setSummary] = useState(hotel.summary ?? "");
  const [description, setDescription] = useState(hotel.description.join("\n\n"));

  const [policies, setPolicies] = useState({
    checkIn: hotel.policies.checkIn ?? "",
    checkOut: hotel.policies.checkOut ?? "",
    cancellation: hotel.policies.cancellation ?? "",
    children: hotel.policies.children ?? "",
    pets: hotel.policies.pets ?? "",
    payment: hotel.policies.payment ?? "",
  });
  const [rules, setRules] = useState((hotel.policies.rules ?? []).join("\n"));

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(hotel.amenities.map((amenity) => amenity.id)),
  );
  // Notes the hotel already wrote against an amenity survive a re-save.
  const existingNotes = useMemo(
    () => new Map(hotel.amenities.map((amenity) => [amenity.id, amenity.note ?? null])),
    [hotel.amenities],
  );

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The general checklist, minus the three kosher categories.
   *
   * Those live on the kosher screen, behind its own switch. Left in here they
   * would put twenty-two religious facilities on the form every ordinary hotel
   * has to fill in — which is the thing that makes a form get skipped.
   *
   * They are still the *same* amenities written through the *same* endpoint;
   * only the place they are edited differs. Because this form sends the whole
   * set, the ones it does not show have to be carried through untouched, or
   * saving descriptions here would silently strip a property's kosher
   * facilities.
   */
  const kosherAmenityIds = useMemo(
    () =>
      new Set(
        vocabulary
          .filter((amenity) =>
            (KOSHER_AMENITY_CATEGORIES as readonly string[]).includes(amenity.category),
          )
          .map((amenity) => amenity.id),
      ),
    [vocabulary],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<string, CatalogueAmenity[]>();
    for (const amenity of vocabulary) {
      if (kosherAmenityIds.has(amenity.id)) continue;
      if (!groups.has(amenity.category)) groups.set(amenity.category, []);
      groups.get(amenity.category)!.push(amenity);
    }
    return [...groups.entries()];
  }, [vocabulary, kosherAmenityIds]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      // Prose paragraphs split on blank lines; single newlines stay inside a
      // paragraph, matching how the fixtures and the public page treat them.
      const paragraphs = description
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);

      // The prose policy lines follow the machine times unless the operator
      // wrote something more specific than the plain default.
      const prose = { ...policies };
      if (checkInFrom && (!prose.checkIn || /^From \d{2}:\d{2}$/.test(prose.checkIn))) {
        prose.checkIn = `From ${checkInFrom}`;
      }
      if (checkOutUntil && (!prose.checkOut || /^Until \d{2}:\d{2}$/.test(prose.checkOut))) {
        prose.checkOut = `Until ${checkOutUntil}`;
      }

      await updateHotel(hotel.id, {
        checkInFrom: checkInFrom || null,
        checkInUntil: checkInUntil || null,
        checkOutFrom: checkOutFrom || null,
        checkOutUntil: checkOutUntil || null,
        shortDescription: shortDescription.trim() || null,
        summary: summary.trim() || null,
        description: paragraphs,
        policies: {
          ...Object.fromEntries(
            Object.entries(prose)
              .map(([key, value]) => [key, value.trim()])
              .filter(([, value]) => value !== ""),
          ),
          rules: rules
            .split("\n")
            .map((rule) => rule.trim())
            .filter(Boolean),
        },
      });

      await setHotelAmenities(
        hotel.id,
        [...selected].map((amenityId) => ({
          amenityId,
          note: existingNotes.get(amenityId) ?? undefined,
        })),
      );

      setMessage("Saved.");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";
  const input = cn(field, "h-10");
  const area = cn(field, "min-h-24 py-2 leading-relaxed");
  const label = "text-[0.8125rem] font-medium text-ink";
  const hint = "mt-1 text-[0.6875rem] text-muted";
  const panel = "rounded-sm border border-line bg-surface p-5";

  return (
    // A disabled fieldset switches off every input and amenity toggle beneath
    // it at once, so a read-only viewer sees the record without being able to
    // drift it; the Save button is replaced rather than greyed.
    <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6">
      <section className={panel}>
        <h3 className="font-semibold text-ink">Check-in and check-out</h3>
        <p className={hint}>
          Wall-clock times at the property. Cancellation deadlines are measured against check-in
          from, in the hotel&rsquo;s own time zone.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-xl sm:grid-cols-4">
          {(
            [
              ["Check-in from", checkInFrom, setCheckInFrom],
              ["Check-in until", checkInUntil, setCheckInUntil],
              ["Check-out from", checkOutFrom, setCheckOutFrom],
              ["Check-out until", checkOutUntil, setCheckOutUntil],
            ] as const
          ).map(([caption, value, set]) => (
            <label key={caption} className="block">
              <span className={label}>{caption}</span>
              <input
                type="time"
                value={value}
                onChange={(event) => set(event.target.value)}
                className={cn(input, "mt-1 tabular-nums")}
              />
            </label>
          ))}
        </div>
      </section>

      <section className={panel}>
        <h3 className="font-semibold text-ink">Descriptions</h3>
        <div className="mt-4 flex flex-col gap-4">
          <label className="block">
            <span className={label}>Short description</span>
            <input
              value={shortDescription}
              onChange={(event) => setShortDescription(event.target.value.slice(0, 300))}
              placeholder="One sentence for search cards"
              className={cn(input, "mt-1")}
            />
            <span className={hint}>
              Shown on search results and cards. {300 - shortDescription.length} characters left.
            </span>
          </label>

          <label className="block">
            <span className={label}>Summary</span>
            <input
              value={summary}
              onChange={(event) => setSummary(event.target.value.slice(0, 500))}
              placeholder="A line or two for the top of the hotel page"
              className={cn(input, "mt-1")}
            />
          </label>

          <label className="block">
            <span className={label}>Full description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={8}
              placeholder={"First paragraph…\n\nSecond paragraph…"}
              className={cn(area, "mt-1")}
            />
            <span className={hint}>A blank line starts a new paragraph.</span>
          </label>
        </div>
      </section>

      <section className={panel}>
        <h3 className="font-semibold text-ink">Policies guests read</h3>
        <p className={hint}>
          Prose, not machinery — the computed cancellation terms live on each rate plan. This is
          what the hotel page prints.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(
            [
              ["checkIn", "Check-in"],
              ["checkOut", "Check-out"],
              ["children", "Children"],
              ["pets", "Pets"],
              ["payment", "Payment"],
              ["cancellation", "Cancellation"],
            ] as const
          ).map(([key, caption]) => (
            <label key={key} className="block">
              <span className={label}>{caption}</span>
              <input
                value={policies[key]}
                onChange={(event) => setPolicies({ ...policies, [key]: event.target.value })}
                className={cn(input, "mt-1")}
              />
            </label>
          ))}
        </div>
        <label className="mt-4 block">
          <span className={label}>House rules</span>
          <textarea
            value={rules}
            onChange={(event) => setRules(event.target.value)}
            rows={4}
            placeholder={"No smoking indoors.\nQuiet hours between 23:00 and 08:00."}
            className={cn(area, "mt-1")}
          />
          <span className={hint}>One rule per line.</span>
        </label>
      </section>

      <section className={panel}>
        <h3 className="font-semibold text-ink">Amenities</h3>
        <p className={hint}>
          {selected.size} selected. The publish checklist needs at least one.
        </p>
        <div className="mt-4 flex flex-col gap-5">
          {byCategory.map(([category, amenities]) => (
            <fieldset key={category}>
              <legend className="text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">
                {category === "FoodDrink" ? "Food & drink" : category}
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {amenities.map((amenity) => {
                  const active = selected.has(amenity.id);
                  return (
                    <button
                      key={amenity.id}
                      type="button"
                      onClick={() => toggle(amenity.id)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
                        active
                          ? "border-brand bg-brand/10 font-medium text-brand-text"
                          : "border-line text-body hover:border-ink",
                      )}
                    >
                      {amenity.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Save size={15} aria-hidden />
            )}
            Save details
          </button>
          <p aria-live="polite" className="text-[0.75rem]">
            {error ? (
              <span className="text-error-text">{error}</span>
            ) : (
              <span className="text-muted">{message}</span>
            )}
          </p>
        </div>
      ) : (
        <ReadOnlyNote needs="catalogue.write" what="Editing descriptions, times, policies and amenities" />
      )}
    </fieldset>
  );
}
