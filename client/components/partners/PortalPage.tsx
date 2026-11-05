import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Layout primitives shared by every partner platform screen.
 *
 * The same rules as the admin panel's: sans throughout, with the page title
 * alone in the display face, bordered white panels on the warm ground, and
 * one left edge for every screen. Narrow screens (settings, team, terms) cap
 * their measure but stay on that edge rather than centring, so a heading does
 * not jump sideways as the reader moves between sections.
 */

/**
 * Plain text set in its own direction. Much of this copy is English on every
 * locale, and an English line that opens with a number ("1 Nov 2026",
 * "7 bookings, soonest due first.") is reordered by a right-to-left page:
 * the number jumps to the far end, the full stop to the front. A `<bdi>`
 * reads its own first letter, so a translated line is left as it is.
 */
export function isolate(content: React.ReactNode) {
  return typeof content === "string" ? <bdi>{content}</bdi> : content;
}

export function PortalContainer({
  children,
  className,
  narrow,
}: {
  children: React.ReactNode;
  className?: string;
  /** Caps the measure for form and reading screens. */
  narrow?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-[84rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className={cn(narrow && "max-w-4xl", className)}>{children}</div>
    </div>
  );
}

/** "← All bookings" above a detail screen's title. */
export function PortalBackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="-ms-2 mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-sm px-2 text-[0.8125rem] font-medium text-muted transition-colors hover:bg-surface-soft hover:text-ink"
    >
      <ArrowLeft size={15} className="shrink-0 rtl:-scale-x-100" aria-hidden />
      {children}
    </Link>
  );
}

/**
 * The title row of every screen: an optional eyebrow (a reference, a
 * company ID), the title, a sentence on what the screen is for, and the
 * screen's own actions, which drop beneath the title on a phone rather than
 * squeezing it.
 */
export function PortalPageHeader({
  title,
  eyebrow,
  description,
  meta,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** Pills or facts that sit under the title. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-6 lg:mb-8", className)}>
      {back && <PortalBackLink href={back.href}>{back.label}</PortalBackLink>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1.5 font-mono text-[0.75rem] tracking-wide text-brand-text">{eyebrow}</p>
          )}
          <h1 className="font-display text-[1.625rem] leading-[1.2] font-normal tracking-[-0.015em] text-ink wrap-anywhere sm:text-[1.75rem] lg:text-[2rem]">
            {title}
          </h1>
          {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div>}
          {description && (
            <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">{isolate(description)}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * A bordered white working surface with an optional header row.
 *
 * `min-w-0`: panels sit in grids, and a grid item's automatic minimum is its
 * content's min-content width — a table scrolling inside the panel would
 * otherwise size the whole column to the table and push the page sideways.
 */
export function PortalPanel({
  title,
  description,
  action,
  icon: Icon,
  children,
  bodyClassName,
  className,
  id,
  as: Element = "section",
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
  children?: React.ReactNode;
  /** Replaces the default body padding; pass "" for a flush list. */
  bodyClassName?: string;
  className?: string;
  id?: string;
  as?: "section" | "div";
}) {
  const headingId = id ? `${id}-title` : undefined;

  return (
    <Element
      id={id}
      aria-labelledby={title && headingId ? headingId : undefined}
      className={cn("min-w-0 rounded-md border border-line bg-surface", id && "scroll-mt-24", className)}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 id={headingId} className="flex items-center gap-2 text-[0.9375rem] leading-snug font-semibold text-ink">
                {Icon && <Icon size={16} className="shrink-0 text-brand-text" aria-hidden />}
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{isolate(description)}</p>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      {children !== undefined && children !== null && (
        <div className={bodyClassName ?? "px-4 py-4 sm:px-5"}>{children}</div>
      )}
    </Element>
  );
}

/** Label-value rows for a detail panel. Values wrap rather than run out. */
export function PortalFacts({
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
          className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
        >
          <dt className="text-[0.8125rem] text-muted">{item.label}</dt>
          <dd className="min-w-0 text-end text-[0.875rem] font-medium text-ink wrap-anywhere">{isolate(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One figure on the dashboard, rendered as an `<li>` for a `<ul>` of tiles.
 * A link when there is a register behind the number, so the tile that says
 * "3 awaiting confirmation" opens those three.
 */
export function PortalStat({
  label,
  value,
  icon: Icon,
  href,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  href?: string;
  hint?: string;
  tone?: "default" | "attention";
}) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-[0.8125rem] leading-snug wrap-break-word text-muted">{label}</span>
        {/* Decorative, so it gives way on the narrowest phones, where two
            tiles a row leave a long label ("confirmation") no room beside it. */}
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-sm max-[23.4375rem]:hidden",
            tone === "attention" ? "bg-warning/15 text-warning-text" : "bg-surface-soft text-brand-text",
          )}
        >
          <Icon size={16} aria-hidden />
        </span>
      </span>
      {/* Pinned to the foot of the tile: a label that wraps to two lines
          must not lift its figure out of line with the tile beside it. */}
      <span className="mt-auto block pt-3 text-[1.625rem] leading-none font-semibold tracking-[-0.01em] text-ink tabular-nums">
        {value}
      </span>
      {hint && <span className="mt-2 block text-[0.75rem] leading-snug text-subtle">{hint}</span>}
    </>
  );

  const base = "flex h-full min-w-0 flex-col rounded-md border border-line bg-surface p-4";

  // A list item rather than a `dt`/`dd` pair: the whole tile is the link,
  // and a link may not wrap a definition's term and description.
  return (
    <li className="min-w-0">
      {href ? (
        <Link
          href={href}
          className={cn(base, "transition-[border-color,box-shadow] hover:border-ink/25 hover:shadow-card")}
        >
          {body}
        </Link>
      ) : (
        <div className={base}>{body}</div>
      )}
    </li>
  );
}

type MessageTone = "neutral" | "info" | "attention" | "critical";

const messageTones: Record<MessageTone, string> = {
  neutral: "bg-surface-soft text-brand-text",
  info: "bg-info/12 text-info",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
};

/**
 * A whole-screen message — the error boundary, the not-found page, the
 * "your application is under review" page. One shape for all of them, so a
 * partner who meets two of them meets the same component twice.
 */
export function PortalMessage({
  icon: Icon,
  tone = "neutral",
  title,
  children,
  actions,
  className,
}: {
  icon: LucideIcon;
  tone?: MessageTone;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border border-line bg-surface p-6 sm:p-8", className)}>
      <span className={cn("inline-flex size-12 items-center justify-center rounded-full", messageTones[tone])}>
        <Icon size={22} aria-hidden />
      </span>
      <h1 className="mt-5 font-display text-[1.5rem] leading-[1.25] font-normal text-ink sm:text-[1.75rem]">{title}</h1>
      {children && <div className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{children}</div>}
      {actions && <div className="mt-7 flex flex-wrap items-center gap-3">{actions}</div>}
    </section>
  );
}

/** A quiet "nothing here" or "could not load" line inside a panel. */
export function PortalEmpty({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-10 text-center", className)}>
      {Icon && (
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-soft text-brand-text">
          <Icon size={18} aria-hidden />
        </span>
      )}
      {title && <p className="text-[0.9375rem] font-medium text-ink">{title}</p>}
      <p className={cn("max-w-md text-[0.875rem] leading-relaxed text-muted", title && "mt-1")}>{children}</p>
    </div>
  );
}
