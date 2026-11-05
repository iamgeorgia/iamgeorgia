import type { WizardErrors, WizardState } from "@/lib/admin/manualBooking";

/**
 * What every step of the desk's wizard is handed: the whole state, a way to
 * change it, the errors keyed by the wizard's own field names, and a way to
 * clear one as the person corrects it.
 */
export interface StepProps {
  state: WizardState;
  setState: (update: (current: WizardState) => WizardState) => void;
  errors: WizardErrors;
  clearError: (field: string) => void;
}

/** The field classes the step forms share with the rest of the panel. */
export const stepCardClass = "rounded-sm border border-line bg-surface p-5";

/** A row in a search result list: what can be chosen, and the button to choose it. */
export const offerRowClass =
  "flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-4 py-3 transition-colors hover:border-ink";

export const chooseButtonClass =
  "inline-flex h-9 shrink-0 items-center rounded-sm bg-brand px-3 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:pointer-events-none disabled:opacity-50";

export const searchButtonClass =
  "inline-flex h-10 items-center gap-2 rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-50";

/** "7, 12" → [7, 12]; anything that is not a small whole number is dropped. */
export const parseChildAges = (value: string): number[] =>
  value
    .split(/[,\s]+/)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((age) => Number.isInteger(age) && age >= 0 && age < 18);
