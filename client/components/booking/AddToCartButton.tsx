"use client";

import Link from "next/link";
import { CheckCircle2, ShoppingBag } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { addToCart, type AddToCartResult, type CartItem } from "@/lib/booking/cart";
import { cartEnabled } from "@/lib/booking/cartFlag";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

interface AddToCartButtonProps {
  /**
   * Built at click time rather than passed as a value, so a form's latest
   * fields (a flight number typed after the page rendered) are what go in.
   */
  item: () => Omit<CartItem, "id" | "addedAt">;
  size?: "sm" | "md" | "lg";
  variant?: "outline" | "outlineBrand" | "ghost";
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * "Add to cart", beside every "Book now".
 *
 * Renders nothing when the cart is switched off, so a page never shows a
 * button the server would refuse. The outcome is said inline, under the
 * button, as a `role="status"` line rather than a toast: it stays where the
 * eye already is, it is read by a screen reader without stealing focus, and
 * the link to the cart is right there for whoever is done choosing.
 *
 * Nothing is held or priced here. The cart keeps the offer token and a
 * snapshot of what was seen; the holds are taken when the checkout opens and
 * the server re-prices every token before it writes anything.
 */
export function AddToCartButton({
  item,
  size = "md",
  variant = "outline",
  fullWidth,
  disabled,
  className,
}: AddToCartButtonProps) {
  const { t } = useI18n();
  const path = useLocalePath();
  const [result, setResult] = useState<(AddToCartResult & { other?: string }) | null>(null);

  if (!cartEnabled) return null;

  const add = () => {
    const built = item();
    const outcome = addToCart(built);

    setResult(outcome.ok ? outcome : { ...outcome, other: built.display.currency });
  };

  const message = (): string | null => {
    if (!result) return null;
    if (result.ok) return t.orders.cart.added;

    switch (result.reason) {
      case "MIXED_CURRENCY":
        return fill(t.orders.cart.mixedCurrencyAdd, {
          currency: result.currency,
          other: result.other ?? "",
        });
      case "FULL":
        return t.orders.cart.full;
      default:
        return t.orders.cart.storageFailed;
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        disabled={disabled}
        onClick={add}
      >
        <ShoppingBag size={size === "sm" ? 14 : 16} aria-hidden />
        {t.orders.cart.add}
      </Button>

      {/* Always mounted, so the live region exists before it has anything to
          announce — a region created and filled in the same paint is often
          not read. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "type-caption flex items-start gap-1.5",
          result?.ok ? "text-success" : "text-warning-text",
          !result && "sr-only",
        )}
      >
        {result && (
          <>
            {result.ok && <CheckCircle2 size={14} className="mt-px shrink-0" aria-hidden />}
            <span>
              {message()}
              {result.ok && (
                <>
                  {" "}
                  <Link
                    href={path("/cart")}
                    className="font-medium text-brand-text underline-offset-4 hover:underline"
                  >
                    {t.orders.cart.viewCart}
                  </Link>
                </>
              )}
            </span>
          </>
        )}
      </p>
    </div>
  );
}
