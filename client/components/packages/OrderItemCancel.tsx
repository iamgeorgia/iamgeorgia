"use client";

import { useState } from "react";

import { CancelOrder } from "@/components/packages/CancelOrder";
import { Modal } from "@/components/ui/Modal";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import type { OrderCancellationQuote, OrderItem } from "@/types/order";

interface OrderItemCancelProps {
  reference: string;
  email?: string;
  currency: string;
  item: OrderItem;
  quote: OrderCancellationQuote | null;
}

/**
 * The per-part "remove" link on a trip.
 *
 * A link rather than a button, and a dialog rather than an inline panel: the
 * parts list is a list of what was bought, and putting a cancellation form
 * inside every row would make removal the most prominent thing on the page.
 *
 * Nothing renders for a part that is already gone or was never cancellable —
 * a declined request has nothing to release, and a required part is refused
 * by the server, which `CancelOrder` explains inside the dialog.
 */
export function OrderItemCancel({
  reference,
  email,
  currency,
  item,
  quote,
}: OrderItemCancelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (item.status !== "CONFIRMED" && item.status !== "REQUESTED") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="type-caption text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
      >
        {t.packages.quote.remove}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={fill(t.orders.cancel.itemTitle, { label: item.label })}
      >
        <CancelOrder
          reference={reference}
          email={email}
          status="CONFIRMED"
          currency={currency}
          quote={quote}
          item={{ slotIndex: item.slotIndex, label: item.label, required: item.required }}
        />
      </Modal>
    </>
  );
}
