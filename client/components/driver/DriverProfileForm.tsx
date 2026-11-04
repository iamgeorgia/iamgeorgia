"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormError, SubmitButton, TextArea, TextInput } from "@/components/admin/FormControls";
import { ApiError, describeError } from "@/lib/api/client";
import { updateDriverProfile } from "@/lib/api/driverPanel";
import { languageOptions } from "@/lib/admin/fleet";
import { cn } from "@/lib/utils";
import type { DriverLanguage, DriverSelf } from "@/types/driver";

/** The three things a driver may change about themselves. */
export function DriverProfileForm({ driver }: { driver: DriverSelf }) {
  const router = useRouter();
  const [phone, setPhone] = useState(driver.phone);
  const [languages, setLanguages] = useState<DriverLanguage[]>(driver.languages as DriverLanguage[]);
  const [bio, setBio] = useState(driver.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await updateDriverProfile({ phone: phone.trim(), languages, bio: bio.trim() || null });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <TextInput
        label="Phone"
        type="tel"
        value={phone}
        onChange={(event) => {
          setPhone(event.target.value);
          setSaved(false);
        }}
        error={fieldErrors.phone}
        // A phone number reads left to right on every page.
        dir="ltr"
        hint={<bdi>Dispatch and, close to a pick-up, the passenger call this number.</bdi>}
      />
      {/* A fieldset, so the group is announced by its question; each choice
          a 44px chip rather than a 16px box, for a thumb. */}
      <fieldset>
        <legend className="text-[0.75rem] font-semibold text-muted">Languages you speak</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {languageOptions.map((option) => {
            const checked = languages.includes(option.value);
            return (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm border px-3 text-[0.9375rem] transition-colors",
                  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand",
                  checked ? "border-brand/60 bg-brand-soft text-ink" : "border-line bg-surface text-body hover:border-ink/30",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setLanguages((current) => (next ? [...current, option.value] : current.filter((value) => value !== option.value)));
                    setSaved(false);
                  }}
                  className="size-4 shrink-0 accent-brand"
                />
                <span className="min-w-0 wrap-break-word">{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <TextArea
        label="About you"
        rows={3}
        value={bio}
        onChange={(event) => {
          setBio(event.target.value);
          setSaved(false);
        }}
        error={fieldErrors.bio}
        // Written in whatever language the driver writes in.
        dir="auto"
        hint={<bdi>Passengers see this. A line or two.</bdi>}
      />
      <FormError message={error} />
      {/* `min-h` rather than a second height: the button sets its own. */}
      <SubmitButton busy={busy} saved={saved} onClick={save} className="min-h-12 w-full justify-center sm:w-auto sm:px-6">
        {busy ? "Saving…" : saved ? "Saved" : "Save"}
      </SubmitButton>
      <p aria-live="polite" className="sr-only">
        {saved ? "Your details are saved." : ""}
      </p>
    </div>
  );
}
