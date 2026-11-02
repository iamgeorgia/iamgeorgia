"use client";

import { CreditCard, FlaskConical, Info, Wallet } from "lucide-react";

import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import type { PaymentChoice } from "@/lib/payments/usePaymentChoice";
import { cn } from "@/lib/utils";

export type PaymentProduct = "hotel" | "tour" | "transfer" | "other";

interface PaymentMethodChoiceProps {
  choice: PaymentChoice;
  /** Names the "pay later" option the way that product settles. */
  product: PaymentProduct;
  disabled?: boolean;
  className?: string;
}

/**
 * "Pay securely by card" or "Pay later", as the item's payment rule allows.
 *
 * Renders nothing when card is not on offer (gateway off, or a rule that keeps
 * payment with the property, operator or driver): the checkout then reads
 * exactly as it did before card payments existed. While the rule is being
 * fetched it shows a skeleton the height of the finished block, so the submit
 * button does not jump.
 */
export function PaymentMethodChoice({ choice, product, disabled, className }: PaymentMethodChoiceProps) {
  const { t } = useI18n();
  const copy = t.payment.choice;

  if (choice.loading) {
    return (
      <div className={cn("space-y-3", className)} role="status" aria-label={copy.loading}>
        <div className="h-5 w-48 animate-pulse rounded-sm bg-surface-soft" />
        <div className="h-20 animate-pulse rounded-sm bg-surface-soft" />
      </div>
    );
  }

  if (!choice.cardOffered) return null;

  const laterLabel = {
    hotel: copy.laterHotel,
    tour: copy.laterTour,
    transfer: copy.laterTransfer,
    other: copy.laterOther,
  }[product];

  const hours = choice.rule?.unpaidCancelHours ?? null;
  const schemes = [copy.schemes.visa, copy.schemes.mastercard, copy.schemes.applePay, copy.schemes.googlePay];

  const option = (
    value: "card" | "later",
    label: string,
    icon: React.ReactNode,
    body?: React.ReactNode,
  ) => {
    const selected = choice.method === value;

    return (
      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-sm border bg-background p-4 transition-colors",
          selected ? "border-ink" : "border-line hover:border-ink/50",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          type="radio"
          name="payment-method"
          value={value}
          checked={selected}
          disabled={disabled}
          onChange={() => choice.setMethod(value)}
          className="mt-1 size-4 shrink-0 accent-brand"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="text-brand-text" aria-hidden>
              {icon}
            </span>
            {label}
          </span>
          {body}
        </span>
      </label>
    );
  };

  return (
    <fieldset className={cn("border-0 p-0", className)} disabled={disabled}>
      <legend className="type-h3 mb-4">{copy.legend}</legend>

      {choice.rule?.mode === "TEST" && (
        <p className="type-caption mb-3 inline-flex items-center gap-1.5 rounded-sm border border-warning/40 bg-warning/10 px-2.5 py-1 font-medium text-warning-text">
          <FlaskConical size={13} aria-hidden />
          {t.payment.testChip}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {option(
          "card",
          copy.card,
          <CreditCard size={16} />,
          <>
            <span className="type-caption mt-1.5 block text-muted">{copy.cardHint}</span>
            <span className="mt-2.5 flex flex-wrap gap-1.5" aria-hidden>
              {schemes.map((scheme) => (
                <span
                  key={scheme}
                  className="rounded-sm border border-line bg-surface-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-body"
                >
                  {scheme}
                </span>
              ))}
            </span>
          </>,
        )}

        {choice.laterOffered && option("later", laterLabel, <Wallet size={16} />)}
      </div>

      {choice.required && (
        <p className="type-body-sm mt-3 flex items-start gap-2 text-muted" role="note">
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
          {hours !== null
            ? fill(copy.requiredNotice, { hours })
            : copy.requiredNoticeNoHours}
        </p>
      )}
    </fieldset>
  );
}
