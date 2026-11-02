"use client";

import { useEffect, useState } from "react";

import { getCheckoutRule } from "@/lib/api/payments";
import type { CheckoutPaymentRule } from "@/types/catalogue";
import type { CheckoutRuleParams } from "@/types/payments";

export type PaymentMethod = "card" | "later";

export interface PaymentChoice {
  /** The rule is still being fetched. */
  loading: boolean;
  /** Null while loading, or when the lookup failed (which reads as pay-later only). */
  rule: CheckoutPaymentRule | null;
  cardOffered: boolean;
  laterOffered: boolean;
  /** Card is the only way to book (PAY_NOW and DEPOSIT). */
  required: boolean;
  /** What the guest has selected, defaulting to card when it is offered. */
  method: PaymentMethod;
  setMethod: (next: PaymentMethod) => void;
  cardSelected: boolean;
}

/**
 * What a checkout may offer for the items it holds, and which one is selected.
 *
 * Fetched once per distinct set of held items. A failed lookup is not an error
 * the guest should see: the checkout falls back to the pre-card behaviour
 * ("pay later") and the booking still works.
 */
export function usePaymentChoice(params: CheckoutRuleParams | null): PaymentChoice {
  const key = params ? JSON.stringify(params) : null;
  const [result, setResult] = useState<{ key: string; rule: CheckoutPaymentRule | null } | null>(null);
  const [picked, setPicked] = useState<PaymentMethod | null>(null);

  useEffect(() => {
    if (!key) return;

    let live = true;

    getCheckoutRule(JSON.parse(key) as CheckoutRuleParams)
      .then((rule) => live && setResult({ key, rule }))
      .catch(() => live && setResult({ key, rule: null }));

    return () => {
      live = false;
    };
  }, [key]);

  const loading = key !== null && result?.key !== key;
  const rule = loading || !key ? null : (result?.rule ?? null);

  const cardOffered = Boolean(rule?.options.card);
  const required = cardOffered && Boolean(rule?.options.required);
  const laterOffered = rule ? rule.options.later && !required : true;

  const method: PaymentMethod = !cardOffered
    ? "later"
    : required || !laterOffered
      ? "card"
      : (picked ?? "card");

  return {
    loading,
    rule,
    cardOffered,
    laterOffered,
    required,
    method,
    setMethod: setPicked,
    cardSelected: method === "card",
  };
}
