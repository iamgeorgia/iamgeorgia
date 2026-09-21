"use client";

import { useState } from "react";

import { kosherIcon } from "@/components/hotels/kosherIcons";
import { fill } from "@/lib/i18n/fill";
import { featureLabel, groupFeatures } from "@/lib/hotels/kosher";
import { useI18n } from "@/lib/i18n/provider";
import type { BookingRequestInput } from "@/types/booking";
import { cn } from "@/lib/utils";

/**
 * The requirement picker at checkout.
 *
 * Two rules shape it, and both come from the data model rather than from taste:
 *
 *   1. **Only what this property offers is listed.** A capability says the
 *      hotel *can*; a request says this guest *needs*. Offering a mikveh to a
 *      property that has none would produce a 422 at submit, which is a worse
 *      way to learn it than not being offered the box.
 *   2. **Nothing here promises anything.** These are requests, answered by the
 *      property afterwards and separately from the rooms, and the hint says so
 *      — an agency must not read a ticked box as a confirmed meal.
 *
 * The note field appears only once a requirement is selected. "Two kosher
 * dinners, Friday and Saturday" is the useful half of a request and a row of
 * empty text boxes is how it gets ignored.
 */

interface KosherRequestsProps {
  /** Facility codes this property actually offers. */
  available: string[];
  value: BookingRequestInput[];
  onChange: (next: BookingRequestInput[]) => void;
  /** Codes the server rejected, so the failure lands on the row that caused it. */
  unsupported?: string[];
}

export function KosherRequests({ available, value, onChange, unsupported = [] }: KosherRequestsProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (available.length === 0) return null;

  const groups = groupFeatures(available);
  const selected = new Map(value.map((entry) => [entry.code, entry]));

  const toggle = (code: string) => {
    if (selected.has(code)) {
      onChange(value.filter((entry) => entry.code !== code));
      if (expanded === code) setExpanded(null);
      return;
    }

    onChange([...value, { code }]);
    setExpanded(code);
  };

  const setNote = (code: string, note: string) =>
    onChange(
      value.map((entry) => (entry.code === code ? { ...entry, note: note || null } : entry)),
    );

  return (
    <section className="mt-12 border-t border-line pt-10">
      <h2 className="type-h3">{t.booking.requirements.heading}</h2>
      <p className="type-body-sm mt-2 text-muted">{t.booking.requirements.hint}</p>

      <div className="mt-6 space-y-6">
        {groups.map(({ group, codes }) => (
          <fieldset key={group}>
            <legend className="type-eyebrow text-muted">{t.hotels.kosher.groups[group]}</legend>

            <div className="mt-3 space-y-2">
              {codes.map((code) => {
                const Icon = kosherIcon(code);
                const entry = selected.get(code);
                const isSelected = Boolean(entry);
                const rejected = unsupported.includes(code);
                const label = featureLabel(t, code);

                return (
                  <div
                    key={code}
                    className={cn(
                      "rounded-sm border transition-colors",
                      rejected
                        ? "border-error/50 bg-error/5"
                        : isSelected
                          ? "border-brand bg-brand-soft/50"
                          : "border-line bg-background",
                    )}
                  >
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(code)}
                        className="size-4 shrink-0 accent-brand"
                      />
                      <Icon size={15} className="shrink-0 text-brand-text" aria-hidden />
                      <span className="type-body-sm text-body">{label}</span>
                    </label>

                    {isSelected && (
                      <div className="px-3 pb-3 ps-10">
                        <label className="sr-only" htmlFor={`request-note-${code}`}>
                          {fill(t.booking.requirements.noteLabel, { feature: label })}
                        </label>
                        <input
                          id={`request-note-${code}`}
                          type="text"
                          value={entry?.note ?? ""}
                          onChange={(event) => setNote(code, event.target.value)}
                          maxLength={500}
                          placeholder={t.booking.requirements.notePlaceholder}
                          className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink focus:border-ink focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
