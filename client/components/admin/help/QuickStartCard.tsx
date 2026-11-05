"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, RotateCcw } from "lucide-react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { CheckboxField } from "@/components/admin/FormControls";
import { useLocalePath } from "@/lib/i18n/provider";
import type { QuickStartStep } from "@/lib/admin/help/types";
import { quickStartStore, useQuickStartState } from "@/lib/admin/help/storage";
import { WhereChip } from "./HelpBlocks";

/**
 * The first-visit checklist.
 *
 * Ticks are the reader's own — nothing here watches whether a hotel was
 * really published — and they live in this browser only. On the Overview
 * and the dispatch board the card can be dismissed and stays away; on the
 * help hub it is always shown, so a reader who dismissed it in a hurry can
 * find it again and un-dismiss it from there.
 *
 * The steps come as plain data from the page (a Server Component), so the
 * registry never has to reach the browser for the card to render.
 */
export function QuickStartCard({
  title: heading,
  role,
  steps,
  dismissable,
}: {
  /** The card's heading, from `quickStartTitle(capabilities)`. */
  title?: string;
  /** Older callers named an audience; kept so they still render, mapped to a heading. */
  role?: string;
  steps: QuickStartStep[];
  dismissable?: boolean;
}) {
  const path = useLocalePath();
  const state = useQuickStartState();

  if (dismissable && state.dismissedAt) return null;

  const done = steps.filter((step) => state.done.includes(step.id)).length;
  const title = heading ?? (role === "DISPATCHER" ? "Quick start for dispatchers" : "Quick start for administrators");

  return (
    <AdminPanel
      title={title}
      description={`${done} of ${steps.length} done — in the order the panel needs them.`}
      action={
        dismissable ? (
          <button
            type="button"
            onClick={quickStartStore.dismiss}
            className="text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink"
          >
            Dismiss
          </button>
        ) : state.dismissedAt && state.dismissedAt !== "server" ? (
          <button
            type="button"
            onClick={quickStartStore.restore}
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink"
          >
            <RotateCcw size={13} aria-hidden />
            Show on the overview again
          </button>
        ) : null
      }
      bodyClassName="p-0"
    >
      <ol className="divide-y divide-line">
        {steps.map((step, index) => {
          const checked = state.done.includes(step.id);
          return (
            <li key={step.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <CheckboxField
                  label={`${index + 1}. ${step.title}`}
                  hint={step.summary}
                  checked={checked}
                  onChange={(next) => quickStartStore.setDone(step.id, next)}
                  className={checked ? "opacity-60" : undefined}
                />
                <div className="mt-2 ps-[1.625rem]">
                  <WhereChip path={step.where} />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 ps-[1.625rem] sm:ps-0">
                <Link
                  href={path(`/admin/help/${articleCategory(step.articleId)}/${step.articleId}`)}
                  className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
                >
                  <BookOpen size={14} aria-hidden />
                  Read how
                </Link>
                <Link
                  href={path(step.href)}
                  className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink underline-offset-4 hover:underline"
                >
                  Open the screen
                  <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </AdminPanel>
  );
}

/**
 * An article's category from its id prefix — the registry's naming rule,
 * applied here so the card needs no registry lookup in the browser.
 */
const PREFIXES: Record<string, string> = {
  gs: "getting-started",
  bk: "bookings",
  dp: "dispatch",
  ds: "destinations",
  ht: "hotels",
  tr: "tours",
  pk: "packages",
  sv: "services",
  tc: "transfers-catalogue",
  fd: "fleet-drivers",
  pt: "partners",
  fn: "finance",
  pp: "people",
  md: "media",
  pb: "publishing",
  rf: "reference",
};

const articleCategory = (id: string): string => PREFIXES[id.slice(0, 2)] ?? "getting-started";
