import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Layout primitives shared by every admin screen.
 *
 * Typography here is sans throughout, with one exception: the page title keeps
 * the display face. That single line ties the panel to the public brand while
 * everything below it stays a working tool rather than an editorial page.
 */

export function AdminContainer({
  children,
  className,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div
      {...rest}
      className={cn("mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6 lg:py-8", className)}
    >
      {children}
    </div>
  );
}

export interface AdminCrumb {
  label: string;
  href?: string;
}

export function AdminBreadcrumbs({ items }: { items: AdminCrumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-[0.8125rem] text-muted transition-colors hover:text-brand-text"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className="text-[0.8125rem] font-medium text-ink"
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight size={13} className="text-subtle rtl:-scale-x-100" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AdminPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  /** Primary and secondary buttons for the screen. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] leading-tight font-normal tracking-[-0.015em] text-ink lg:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A bordered white working surface. Everything on a screen sits in one. */
export function AdminPanel({
  title,
  description,
  action,
  children,
  bodyClassName,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  // `min-w-0`: panels sit in grids, and a grid item's automatic minimum is its
  // content's min-content width. A table that scrolls inside the panel would
  // otherwise size the whole column to the table and push the page sideways.
  return (
    <section className={cn("min-w-0 rounded-sm border border-line bg-surface", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>}
            {description && (
              <p className="mt-1 text-[0.8125rem] text-muted">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName ?? "p-5"}>{children}</div>
    </section>
  );
}

/** Key-value rows used across every detail screen. */
export function AdminDefinitionList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0"
        >
          <dt className="text-[0.8125rem] text-muted">{item.label}</dt>
          <dd className="text-end text-[0.875rem] font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
