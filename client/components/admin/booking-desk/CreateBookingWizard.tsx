"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { BuyerStep } from "./BuyerStep";
import { ReviewStep } from "./ReviewStep";
import { ServiceStep } from "./ServiceStep";
import { TermsStep } from "./TermsStep";
import { TravellersStep } from "./TravellersStep";
import { useCan } from "@/components/admin/AdminViewerContext";
import { FormError } from "@/components/admin/FormControls";
import { bookingApprovalHref } from "@/lib/admin/bookingApprovals";
import {
  WIZARD_STEPS,
  buildManualBookingBody,
  cartConflictErrors,
  cartConflictOf,
  emptyWizardState,
  isStaleOffer,
  leadFromCustomer,
  mapServerErrors,
  mixedCurrencyOf,
  validateStep,
  type WizardErrors,
  type WizardState,
  type WizardStep,
} from "@/lib/admin/manualBooking";
import { ApiError, describeError } from "@/lib/api/client";
import { createManualBooking } from "@/lib/api/manualBookings";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types/customer";

/**
 * The desk: a booking made by phone, by email, through another agency or
 * face to face, in five steps.
 *
 * The state is one object the steps each own a slice of; the body sent is
 * built from it by `lib/admin/manualBooking.ts`, which is also where a
 * server refusal is mapped back onto the step that owns the field — the
 * pattern `PartnerRegistrationWizard` set. A 409 that means the chosen
 * offer is no longer good (`PRICE_CHANGED`, `UNAVAILABLE`) is not a field
 * error: it is a notice with one way out, which is to search again. A
 * cart's 409 names the lines in the way, and each is marked on the Service
 * step so the rest of the list survives.
 *
 * Submitting carries an idempotency key, minted when the Review step opens
 * and replaced whenever the person goes back to change something, so a
 * double-click cannot take two rooms and an edited booking cannot replay an
 * old one.
 */
export function CreateBookingWizard({ initialCustomer }: { initialCustomer?: Customer | null }) {
  const router = useRouter();
  const localePath = useLocalePath();
  const can = useCan();
  const rights = { approve: can("bookings.approve"), override: can("bookings.price.override") };

  const [step, setStep] = useState<WizardStep>(0);
  const [state, setStateRaw] = useState<WizardState>(() => {
    const initial = emptyWizardState();
    if (initialCustomer) {
      initial.buyer = { ...initial.buyer, mode: "CUSTOMER", customerId: initialCustomer.id, customerLabel: initialCustomer.name };
      initial.travellers = { ...initial.travellers, lead: leadFromCustomer(initialCustomer) };
    }
    return initial;
  });
  const [errors, setErrors] = useState<WizardErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState<{ message: string; action: "search" | "refresh" } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const keyRef = useRef<string | null>(null);

  const setState = useCallback((update: (current: WizardState) => WizardState) => {
    // Anything changed after the Review step opened is a different booking.
    keyRef.current = null;
    setStateRaw(update);
  }, []);

  const clearError = useCallback((field: string) => {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const goTo = (target: WizardStep) => {
    setFormError(null);
    setStep(target);
    if (target === 4 && keyRef.current === null) keyRef.current = crypto.randomUUID();
  };

  const advance = () => {
    const found = validateStep(step, state, rights);
    setErrors((current) => ({ ...current, ...found }));
    if (Object.keys(found).length > 0) return;
    goTo(Math.min(4, step + 1) as WizardStep);
  };

  const submit = async () => {
    // Every step is checked once more: a value changed on Review's "Edit"
    // and never re-advanced would otherwise slip past.
    for (const at of [0, 1, 2, 3] as const) {
      const found = validateStep(at, state, rights);
      if (Object.keys(found).length > 0) {
        setErrors((current) => ({ ...current, ...found }));
        goTo(at);
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);
    setStale(null);

    try {
      const built = buildManualBookingBody(state);
      const key = keyRef.current ?? (keyRef.current = crypto.randomUUID());
      const result = await createManualBooking(built.product, built.body, key);
      // A cart answers the order's detail; the order lives on the orders register.
      router.push(localePath(bookingApprovalHref(built.product === "CART" ? "ORDER" : built.product, result.reference)));
    } catch (caught) {
      if (caught instanceof ApiError) {
        const conflict = caught.status === 409 ? cartConflictOf(caught.details) : null;
        if (conflict) {
          // The lines in the way, marked where they can be removed or replaced.
          const marked = cartConflictErrors(conflict, state.items);
          setErrors((current) => ({ ...current, ...marked }));
          const count = Object.keys(marked).length;
          if (conflict.reason === "UNAVAILABLE") {
            setFormError(`${count === 1 ? "One line" : `${count} lines`} can no longer be booked. Remove ${count === 1 ? "it" : "them"}, or search again.`);
            goTo(1);
          } else {
            setStale({
              message: `The price of ${count === 1 ? "a line" : `${count} lines`} has moved since the search. Refresh the prices to see the current figures, then replace the line to book at them.`,
              action: "refresh",
            });
          }
          setSubmitting(false);
          return;
        }

        if (caught.status === 409 && isStaleOffer(caught.details)) {
          const reason = caught.details.reason;
          setStale({
            message:
              reason === "PRICE_CHANGED"
                ? "The price of what you chose has moved since the search. Search again to see the current price."
                : "What you chose can no longer be booked — it sold out or was withdrawn. Search again.",
            action: "search",
          });
          setSubmitting(false);
          return;
        }

        const mixed = caught.status === 422 ? mixedCurrencyOf(caught.details) : null;
        if (mixed) {
          setErrors((current) => ({
            ...current,
            selection: `Everything in one booking settles in one currency${mixed.length > 0 ? `; these lines are in ${mixed.join(" and ")}` : ""}.`,
          }));
          goTo(1);
          setSubmitting(false);
          return;
        }

        const fields = (caught.details as { fields?: unknown } | null)?.fields;
        if (caught.status === 403 && Array.isArray(fields) && fields.includes("priceAdjustment")) {
          setErrors((current) => ({ ...current, adjustmentAmount: describeError(caught) }));
          goTo(3);
          setSubmitting(false);
          return;
        }

        const mapped = mapServerErrors(caught.fieldErrors());
        if (mapped.step !== null) {
          setErrors((current) => ({ ...current, ...mapped.errors }));
          goTo(mapped.step);
        }
      }
      setFormError(describeError(caught, "Could not make the booking."));
      setSubmitting(false);
    }
  };

  const searchAgain = () => {
    setStale(null);
    setState((current) => ({ ...current, items: [] }));
    goTo(1);
  };

  const refreshPrices = () => {
    setStale(null);
    // The tokens are the same, but the price they carry was refused: a new key, and the quote again.
    keyRef.current = crypto.randomUUID();
    setRefreshKey((current) => current + 1);
  };

  const last = step === 4;

  return (
    <div className="mt-8">
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {WIZARD_STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li key={label}>
              <button
                type="button"
                disabled={index > step}
                onClick={() => goTo(index as WizardStep)}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-sm border px-3 text-[0.8125rem] font-medium transition-colors disabled:cursor-default",
                  current
                    ? "border-ink bg-ink text-white"
                    : done
                      ? "border-brand/40 bg-brand-soft text-brand-text hover:border-brand"
                      : "border-line text-subtle",
                )}
              >
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-white/15 text-[0.6875rem] tabular-nums">
                  {done ? <Check size={11} aria-hidden /> : index + 1}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-6">
        {step === 0 && <BuyerStep state={state} setState={setState} errors={errors} clearError={clearError} />}
        {step === 1 && <ServiceStep state={state} setState={setState} errors={errors} clearError={clearError} />}
        {step === 2 && <TravellersStep state={state} setState={setState} errors={errors} clearError={clearError} />}
        {step === 3 && <TermsStep state={state} setState={setState} errors={errors} clearError={clearError} />}
        {step === 4 && <ReviewStep state={state} setState={setState} onEdit={goTo} refreshKey={refreshKey} />}
      </div>

      {stale && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-warning/50 bg-warning/10 px-4 py-3">
          <p className="text-[0.875rem] text-warning-text">{stale.message}</p>
          <button
            type="button"
            onClick={stale.action === "refresh" ? refreshPrices : searchAgain}
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-warning/60 px-3 text-[0.8125rem] font-semibold text-warning-text hover:bg-warning/15"
          >
            <RefreshCw size={14} aria-hidden />
            {stale.action === "refresh" ? "Refresh prices" : "Search again"}
          </button>
        </div>
      )}

      <FormError message={formError} />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => goTo((step - 1) as WizardStep)}
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink"
          >
            <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
            Back
          </button>
        )}

        {last ? (
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
            {state.terms.confirmNow ? "Create and confirm" : "Create booking"}
          </button>
        ) : (
          <button
            type="button"
            onClick={advance}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Continue
            <ArrowRight size={15} className="rtl:-scale-x-100" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
