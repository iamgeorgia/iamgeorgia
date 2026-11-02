"use client";

import type { PaymentPolicy } from "@/types/catalogue";

import { SelectInput } from "./FormControls";
import { paymentTimingLabels } from "./PaymentPolicyEditor";

/**
 * Picks the card rule an item is sold under, from the platform templates of
 * its product kind. The empty value is "Platform default", which the API
 * stores as null.
 *
 * `current` keeps an item's attached policy selectable even after the
 * template was deactivated, so opening the form never silently changes it.
 */
export function PaymentPolicySelect({
  label = "Payment terms",
  value,
  onChange,
  policies,
  current,
  disabled,
  className,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  policies: PaymentPolicy[];
  current?: PaymentPolicy | null;
  disabled?: boolean;
  className?: string;
}) {
  const all = current && !policies.some((policy) => policy.id === current.id) ? [current, ...policies] : policies;

  return (
    <SelectInput
      label={label}
      className={className}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: "", label: "Platform default" },
        ...all.map((policy) => ({
          value: policy.id,
          label: `${policy.name} (${paymentTimingLabels[policy.timing].split(" (")[0]})${policy.isActive ? "" : " — inactive"}`,
        })),
      ]}
      hint="Decides whether the guest must pay by card, may pay later, or settles on the spot."
    />
  );
}
