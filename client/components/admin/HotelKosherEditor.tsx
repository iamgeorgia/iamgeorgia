"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Info, ShieldAlert, ShieldCheck } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import {
  CheckboxField,
  FormError,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "./FormControls";
import { KosherCertifications } from "./KosherCertifications";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { setHotelAmenities } from "@/lib/api/hotels";
import { disableKosher, setKosherProfile } from "@/lib/api/kosher";
import { describeError } from "@/lib/api/client";
import type {
  CatalogueAmenity,
  HotelDocument,
  KosherProfile,
  KosherServiceLevel,
} from "@/types/catalogue";
import { cn } from "@/lib/utils";

/**
 * Kosher services for one property.
 *
 * The screen is built around one idea the data model insists on: **an admin
 * cannot mark a hotel kosher certified**. There is no such control here,
 * because there is no such field — "certified" is derived from a verified,
 * unexpired, property-scoped certificate, and the only way to produce one is
 * the verify action in the certifications panel below.
 *
 * So this form owns two things and no more:
 *
 *   * the *level of service*, which is a declaration and is labelled as one;
 *   * the *facilities*, which are amenities and are written through the amenity
 *     endpoint that has always written them — so there is exactly one place a
 *     facility lives and the general checklist and this panel cannot disagree.
 *
 * Turning the switch off is a delete, and the server refuses it while a
 * certificate is live. That is deliberate: removing the profile would take its
 * certification history with it, and a property somebody verified must not
 * become un-kosher with one click.
 */

const SERVICE_LEVELS: { value: KosherServiceLevel; label: string; hint: string }[] = [
  { value: "ON_REQUEST", label: "Kosher meals on request", hint: "Arranged with notice. The property is not otherwise kosher." },
  { value: "KOSHER_FRIENDLY", label: "Kosher-friendly", hint: "Accommodates observant guests without a kosher kitchen of its own." },
  { value: "PARTIAL", label: "Partly kosher", hint: "A kosher outlet or kitchen inside a property that is not." },
  { value: "FULL", label: "Fully kosher", hint: "The whole property operates kosher." },
  { value: "NONE", label: "Not kosher", hint: "Recorded so nobody asks again. Keeps the certification history." },
];

/** Only these two are asked to back the claim with a certificate. */
const CLAIMS_NEEDING_CERTIFICATION: KosherServiceLevel[] = ["PARTIAL", "FULL"];

const GROUP_TITLES: Record<string, string> = {
  KosherFood: "Food & dining",
  Shabbat: "Shabbat",
  Religious: "Religious facilities",
};

interface HotelKosherEditorProps {
  hotelId: string;
  hotelName: string;
  kosher: KosherProfile | null;
  /** Every amenity in the three kosher categories. */
  vocabulary: CatalogueAmenity[];
  /** The amenity ids this hotel currently claims, kosher and otherwise. */
  selectedAmenityIds: string[];
  documents: HotelDocument[];
}

export function HotelKosherEditor({
  hotelId,
  hotelName,
  kosher,
  vocabulary,
  selectedAmenityIds,
  documents,
}: HotelKosherEditorProps) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [enabled, setEnabled] = useState(Boolean(kosher));
  const [serviceLevel, setServiceLevel] = useState<KosherServiceLevel>(
    kosher?.serviceLevel ?? "KOSHER_FRIENDLY",
  );
  const [notes, setNotes] = useState(kosher?.notes ?? "");
  const [contactName, setContactName] = useState(kosher?.contact.name ?? "");
  const [contactEmail, setContactEmail] = useState(kosher?.contact.email ?? "");
  const [contactPhone, setContactPhone] = useState(kosher?.contact.phone ?? "");

  const kosherIds = useMemo(() => new Set(vocabulary.map((amenity) => amenity.id)), [vocabulary]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedAmenityIds));

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const groups = new Map<string, CatalogueAmenity[]>();
    for (const amenity of vocabulary) {
      if (!groups.has(amenity.category)) groups.set(amenity.category, []);
      groups.get(amenity.category)!.push(amenity);
    }
    return [...groups.entries()];
  }, [vocabulary]);

  const toggle = (id: string) => {
    setSaved(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const certified = kosher?.certified ?? false;
  const needsCertificate = CLAIMS_NEEDING_CERTIFICATION.includes(serviceLevel) && !certified;

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      await setKosherProfile(hotelId, {
        serviceLevel,
        notes: notes.trim() || null,
        contactName: contactName.trim() || null,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
      });

      // The amenity set is written whole, which is what a checklist means. The
      // non-kosher selections travel untouched, so saving this screen cannot
      // wipe the facilities somebody set on the details screen.
      await setHotelAmenities(
        hotelId,
        [...selected].map((amenityId) => ({ amenityId })),
      );

      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  /** Switching kosher services off entirely. Refused while a certificate lives. */
  const disable = async () => {
    setBusy(true);
    setError(null);

    try {
      await disableKosher(hotelId);
      // Kosher facilities go with it: leaving "Shabbat elevator" ticked on a
      // property that no longer offers kosher services would keep it in kosher
      // facility filters, which is precisely the inconsistency the switch is
      // meant to prevent.
      await setHotelAmenities(
        hotelId,
        [...selected]
          .filter((id) => !kosherIds.has(id))
          .map((amenityId) => ({ amenityId })),
      );

      setEnabled(false);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
      setEnabled(true);
    } finally {
      setBusy(false);
    }
  };

  // --- switched off -------------------------------------------------------

  if (!enabled) {
    return (
      <AdminPanel title="Kosher services">
        {canEdit ? (
          <CheckboxField
            label="This property provides Kosher services"
            hint="Nothing kosher-related is stored, shown or filterable until this is switched on."
            checked={false}
            onChange={() => setEnabled(true)}
          />
        ) : (
          <>
            <p className="text-[0.875rem] text-muted">
              This property does not provide kosher services. Nothing kosher-related is stored,
              shown or filterable until that is switched on.
            </p>
            <ReadOnlyNote className="mt-4" needs="catalogue.write" what="Switching kosher services on" />
          </>
        )}
        <FormError message={error} />
      </AdminPanel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* One disabled fieldset over the three editable panels: every control
          beneath it is switched off for a read-only viewer, and the Save button
          at the bottom is replaced rather than greyed. */}
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6">
        <AdminPanel
          title="Kosher services"
          description={`What ${hotelName} offers, and what we have checked.`}
        >
          <CheckboxField
            label="This property provides Kosher services"
            hint={
              !canEdit
                ? undefined
                : kosher
                  ? "Switching this off removes the kosher record and its facilities. Refused while a verified certificate is live."
                  : "Save below to create the record."
            }
            checked
            onChange={() => {
              if (kosher) void disable();
              else setEnabled(false);
            }}
          />

          <div className="mt-6 border-t border-line pt-6">
            <SelectInput
              label="Level of kosher service"
              hint={SERVICE_LEVELS.find((level) => level.value === serviceLevel)?.hint}
              options={SERVICE_LEVELS.map(({ value, label }) => ({ value, label }))}
              value={serviceLevel}
              onChange={(event) => {
                setServiceLevel(event.target.value as KosherServiceLevel);
                setSaved(false);
              }}
            />

            {/*
             * The line that stops this screen over-promising.
             *
             * It is a warning rather than a block: a property genuinely can be
             * fully kosher before its paperwork reaches us, and refusing to record
             * that would push the truth out of the system. What it cannot do is go
             * on sale — the publish checklist carries the same rule with teeth.
             */}
            {needsCertificate && (
              <p className="mt-3 flex items-start gap-2 rounded-sm bg-warning/12 p-3 text-[0.8125rem] leading-relaxed text-warning-text">
                <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  A claim this strong needs a verified certificate behind it. Until one is added and
                  verified below, this property will not read as certified anywhere, and it cannot be
                  published.
                </span>
              </p>
            )}

            {certified && (
              <p className="mt-3 flex items-start gap-2 rounded-sm bg-success/10 p-3 text-[0.8125rem] leading-relaxed text-success">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  Certified by {kosher?.certification?.authorityName}. This is derived from the
                  verified certificate below — it is not a setting on this form.
                </span>
              </p>
            )}
          </div>
        </AdminPanel>

        {/* --- facilities ---------------------------------------------------- */}
        <AdminPanel
          title="Facilities"
          description="What the property says it offers. These are ordinary amenities, so they drive search filters and the property page."
        >
          <p className="mb-5 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-subtle">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            Nothing here is verified. Ticking every box does not make a property certified — only a
            verified certificate does.
          </p>

          <div className="space-y-6">
            {byCategory.map(([category, amenities]) => (
              <fieldset key={category}>
                <legend className="text-[0.75rem] font-semibold text-muted">
                  {GROUP_TITLES[category] ?? category}
                </legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {amenities.map((amenity) => (
                    <label
                      key={amenity.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-sm border px-3 py-2 text-[0.8125rem] transition-colors",
                        selected.has(amenity.id)
                          ? "border-brand bg-brand-soft/50 text-ink"
                          : "border-line bg-background text-body hover:border-subtle",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(amenity.id)}
                        onChange={() => toggle(amenity.id)}
                        className="size-4 shrink-0 accent-brand"
                      />
                      {amenity.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </AdminPanel>

        {/* --- notes and contact --------------------------------------------- */}
        <AdminPanel title="Notes & contact">
          <div className="flex flex-col gap-4">
            <TextArea
              label="In the property's words"
              hint="Shown to agencies under the facility list. What the property actually does, in prose."
              rows={4}
              maxLength={2000}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setSaved(false);
              }}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <TextInput
                label="Contact name"
                value={contactName}
                onChange={(event) => {
                  setContactName(event.target.value);
                  setSaved(false);
                }}
              />
              <TextInput
                label="Contact email"
                type="email"
                hint="Where a kosher requirement on a booking should be sent."
                value={contactEmail}
                onChange={(event) => {
                  setContactEmail(event.target.value);
                  setSaved(false);
                }}
              />
              <TextInput
                label="Contact phone"
                value={contactPhone}
                onChange={(event) => {
                  setContactPhone(event.target.value);
                  setSaved(false);
                }}
              />
            </div>
          </div>

          <FormError message={error} />

          {canEdit ? (
            <div className="mt-6 flex justify-end border-t border-line pt-5">
              <SubmitButton busy={busy} saved={saved} onClick={save}>
                {saved ? "Saved" : "Save kosher services"}
              </SubmitButton>
            </div>
          ) : (
            <ReadOnlyNote
              className="mt-6"
              needs="catalogue.write"
              what="Changing the service level, facilities, notes or contact"
            />
          )}
        </AdminPanel>
      </fieldset>

      {/* --- certification -------------------------------------------------- */}
      {kosher ? (
        <KosherCertifications hotelId={hotelId} kosher={kosher} documents={documents} />
      ) : (
        <AdminPanel title="Certification">
          <p className="text-[0.875rem] text-muted">
            Save the kosher record above before adding a certificate.
          </p>
        </AdminPanel>
      )}
    </div>
  );
}
