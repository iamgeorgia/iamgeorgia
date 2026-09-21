"use client";

import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ArrowRight, Briefcase, CalendarDays, Clock, Pencil, Users } from "lucide-react";
import { useState } from "react";

import { TransferSearch } from "./TransferSearch";
import { useI18n } from "@/lib/i18n/provider";
import {
  formatJourneyDate,
  luggageSummary,
  passengerSummary,
  type TransferQuery,
} from "@/lib/transfers/query";
import { cn } from "@/lib/utils";
import type { TransferPoint } from "@/types/transfer";

interface TransferJourneyBarProps {
  query: TransferQuery;
  /**
   * The two ends, already resolved by the page that quoted the journey. The bar
   * used to look these up in a local catalogue; there isn't one now, and making
   * a presentational strip fetch two names would be two requests for a heading.
   */
  from?: TransferPoint | null;
  to?: TransferPoint | null;
  /** Lets the details and checkout pages show the same strip without the editor. */
  editable?: boolean;
  className?: string;
}

/**
 * The search, restated.
 *
 * Once a traveller is three screens deep they need to see that the route, date
 * and party they entered are still the ones being priced. Editing reopens the
 * full search form in place rather than sending them back to the landing page
 * and losing the choice they had already made.
 */
export function TransferJourneyBar({
  query,
  from,
  to,
  editable = true,
  className,
}: TransferJourneyBarProps) {
  const { t, locale, intlLocale } = useI18n();
  const [editing, setEditing] = useState(false);
  /*
   * The panel clips its contents only while its height is animating. Left on
   * permanently, `overflow-hidden` cut the passenger popover — which hangs
   * below the form — down to its first row, so luggage could not be changed.
   */
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();

  const toggleEditing = (next: boolean) => {
    setExpanded(false);
    setEditing(next);
  };

  return (
    <div className={cn("border border-line bg-surface", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="type-h4 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate">
              {from?.name ?? query.from ?? t.transfers.journeyBar.pickUpFallback}
            </span>
            <ArrowRight
              size={16}
              className="shrink-0 text-brand-text rtl:-scale-x-100"
              aria-hidden
            />
            <span className="sr-only"> {t.a11y.to} </span>
            <span className="truncate">
              {to?.name ?? query.to ?? t.transfers.journeyBar.dropOffFallback}
            </span>
          </h2>

          <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <li className="type-caption flex items-center gap-1.5 text-muted">
              <CalendarDays size={13} className="shrink-0" aria-hidden />
              {formatJourneyDate(query.date, intlLocale)}
            </li>
            <li className="type-caption flex items-center gap-1.5 text-muted">
              <Clock size={13} className="shrink-0" aria-hidden />
              {query.time || "—"}
            </li>
            <li className="type-caption flex items-center gap-1.5 text-muted">
              <Users size={13} className="shrink-0" aria-hidden />
              {passengerSummary(query, locale, t.units)}
            </li>
            <li className="type-caption flex items-center gap-1.5 text-muted">
              <Briefcase size={13} className="shrink-0" aria-hidden />
              {luggageSummary(query, locale, t.units)}
            </li>
            {query.type === "return" && (
              <li className="type-caption rounded-full bg-surface-soft px-2.5 py-0.5 font-medium text-brand-text">
                {t.transfers.journeyBar.returnLabel} ·{" "}
                {formatJourneyDate(query.returnDate, intlLocale)} · {query.returnTime || "—"}
              </li>
            )}
          </ul>
        </div>

        {editable && (
          <button
            type="button"
            onClick={() => toggleEditing(!editing)}
            aria-expanded={editing}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-sm border border-ink/25 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
          >
            <Pencil size={14} aria-hidden />
            {editing ? t.transfers.journeyBar.close : t.transfers.journeyBar.changeSearch}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <m.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() => setExpanded(editing)}
            className={cn("border-t border-line", !expanded && "overflow-hidden")}
          >
            <div className="p-4 sm:p-5">
              <TransferSearch
                initialQuery={query}
                submitLabel={t.transfers.search.update}
                onSubmitted={() => toggleEditing(false)}
                className="shadow-none"
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
