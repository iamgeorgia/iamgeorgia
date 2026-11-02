import { cn } from "@/lib/utils";

/**
 * The panel's table.
 *
 * A real `<table>` rather than a grid of divs, so column headers are announced
 * with their cells and the whole thing can be copied into a spreadsheet. It
 * scrolls inside its own container — the page body never scrolls sideways.
 *
 * On narrow screens each row is expected to render as a stacked card instead;
 * the list screens do that by rendering `AdminCardList` below `lg` rather than
 * shrinking a table nobody can read on a phone.
 */

export interface Column {
  /** Header text. Pass an empty string for an action column. */
  label: string;
  /** Right-align numeric columns so figures line up on the decimal. */
  align?: "start" | "end";
  /** Hide below the given breakpoint to keep the table scannable. */
  hideBelow?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
}

const hideClasses: Record<NonNullable<Column["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

export function DataTable({
  columns,
  children,
  caption,
  className,
}: {
  columns: Column[];
  children: React.ReactNode;
  /** Describes the table for screen readers; visually hidden. */
  caption: string;
  className?: string;
}) {
  return (
    // `contain-inline-size`: a scroll container still reports its content's
    // min-content width upwards, so a 44rem table inside a grid column made the
    // column 44rem wide and the page scroll sideways on a phone. Containment
    // sizes the wrapper from its parent alone; the table scrolls inside it.
    // `relative`: an `overflow` box only clips absolutely positioned
    // descendants when it is their containing block. Without it the `sr-only`
    // "Actions" header (position: absolute, parked at the far end of a row
    // wider than the wrapper) escaped the scroller and widened the page.
    <div className={cn("relative w-full contain-inline-size overflow-x-auto", className)}>
      {/* No width floor: the table is as narrow as its cells allow and the
          wrapper scrolls only when a row truly needs more room. The old
          `md:min-w-[44rem]` was measured against the viewport, not the panel,
          so a five-column table in a 470px detail column scrolled sideways
          with room to spare and its money columns sat off screen. Columns that
          must not squeeze say so themselves (`whitespace-nowrap` on
          references, dates and amounts; `hideBelow` for the secondary ones). */}
      <table className="w-full border-collapse text-start">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((column, index) => (
              <th
                key={`${column.label}-${index}`}
                scope="col"
                className={cn(
                  "px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.1em] whitespace-nowrap text-muted uppercase",
                  column.align === "end" ? "text-end" : "text-start",
                  column.hideBelow && hideClasses[column.hideBelow],
                  column.className,
                )}
              >
                {column.label || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Row({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("transition-colors hover:bg-surface-soft/60", className)}>{children}</tr>
  );
}

export function Cell({
  children,
  align,
  hideBelow,
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "end";
  hideBelow?: Column["hideBelow"];
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3.5 align-middle text-[0.875rem] text-body",
        align === "end" ? "text-end" : "text-start",
        hideBelow && hideClasses[hideBelow],
        className,
      )}
    >
      {children}
    </td>
  );
}

/** "Nothing here" inside a table, spanning every column. */
export function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16 text-center">
        <p className="text-[0.9375rem] text-muted">{message}</p>
      </td>
    </tr>
  );
}
