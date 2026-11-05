import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { cn } from "@/lib/utils";

/**
 * The shape every overview queue takes: a titled panel, a short list of rows
 * that each link to the record, and a "View all" into the register the rows
 * came from. One component so the eight queues read as one screen rather
 * than eight designs, and so an empty queue says so in the same voice.
 *
 * Rows link with `prefetch={false}`: each detail page reads its record, and
 * prefetching five of them per panel would spend the panel's shared rate
 * limit before anyone clicked.
 */

export interface QueueRow {
  key: string;
  href: string;
  title: string;
  subtitle?: string | null;
  /** The figure on the right, already formatted. */
  value?: string | null;
  /** A second line under the figure: a date, a status word. */
  note?: string | null;
  /** True paints the note in the warning colour: late, failed. */
  urgent?: boolean;
  badge?: React.ReactNode;
}

export function QueuePanel({
  title,
  description,
  href,
  linkLabel = "View all",
  rows,
  empty,
  footer,
  className,
}: {
  title: string;
  description?: string;
  /** Localised path to the register this queue is a slice of. */
  href: string;
  linkLabel?: string;
  rows: QueueRow[];
  /** What to say when there is nothing to do. */
  empty: string;
  /** A control under the rows: the way to add to the queue, where there is one. */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <AdminPanel
      title={title}
      description={description}
      className={className}
      action={
        <Link
          href={href}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text transition-colors hover:text-brand-hover"
        >
          {linkLabel}
          <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
        </Link>
      }
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[0.875rem] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                href={row.href}
                prefetch={false}
                className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-soft/60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[0.875rem] font-medium text-ink">{row.title}</span>
                  {row.subtitle && (
                    <span className="block truncate text-[0.75rem] text-muted">{row.subtitle}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-end">
                  {row.badge}
                  {row.value && (
                    <span className="block text-[0.875rem] font-medium text-ink tabular-nums">{row.value}</span>
                  )}
                  {row.note && (
                    <span className={cn("block text-[0.75rem]", row.urgent ? "font-medium text-error-text" : "text-muted")}>
                      {row.note}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
    </AdminPanel>
  );
}
