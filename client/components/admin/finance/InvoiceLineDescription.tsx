import type { InvoiceLine, InvoiceLineKind } from "@/types/invoice";

/**
 * One line of an invoice as the document prints it: what kind of thing it
 * is, the one-line description, and the detail text the provider sets under
 * it — a room's dates and guests, a leg's time and flight — with its line
 * breaks kept. Used on the staff document page and in the partner's own
 * invoice list, so both read the same words.
 */

const kindLabels: Record<InvoiceLineKind, string> = {
  HOTEL_ROOM: "Room",
  TRANSFER_LEG: "Transfer",
  TOUR: "Tour",
  SERVICE: "Service",
  EXTRA: "Extra",
  ADJUSTMENT: "Adjustment",
  CANCELLATION_CHARGE: "Cancellation charge",
  MANUAL: "Manual",
};

export function InvoiceLineDescription({ line }: { line: InvoiceLine }) {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-2">
        {line.kind && (
          <span className="inline-flex rounded-full bg-surface-soft px-2 py-0.5 text-[0.6875rem] font-medium tracking-wide text-muted uppercase">
            {kindLabels[line.kind] ?? line.kind}
          </span>
        )}
        <span className="font-medium text-ink">{line.description}</span>
      </p>
      {line.detail?.text && (
        <p className="mt-1 text-[0.75rem] leading-relaxed whitespace-pre-wrap text-muted">{line.detail.text}</p>
      )}
      {line.bookingReference && !line.description.includes(line.bookingReference) && (
        <p className="mt-0.5 font-mono text-[0.75rem] text-muted">{line.bookingReference}</p>
      )}
    </div>
  );
}
