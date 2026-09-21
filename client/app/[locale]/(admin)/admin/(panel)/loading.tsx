"use client";

import { usePathname } from "next/navigation";

import { AdminContainer } from "@/components/admin/AdminPage";
import { Skeleton } from "@/components/ui/Skeleton";
import { adminScreenLabel } from "@/lib/admin/navigation";
import { stripLocale } from "@/lib/i18n/config";

/**
 * What a panel screen looks like before its data has arrived.
 *
 * This file is the reason switching sections is instant. Every panel screen
 * is a dynamic route — it reads the session cookie and asks the API for live
 * records — and Next does not prefetch a dynamic route at all unless it has a
 * loading boundary. Without one, a click on the sidebar did nothing visible
 * until the whole server render, API calls included, had come back. With one,
 * the shell and this skeleton are prefetched while the sidebar is on screen,
 * the router commits the navigation the moment the link is clicked, and the
 * real screen streams into this boundary when its data lands.
 *
 * The title is real, not a grey bar: the sidebar already knows what every
 * screen is called, so the heading can be right from the first frame and the
 * page does not appear to load twice. A detail page or a form, which the
 * sidebar does not list, gets a bar instead of a guess.
 *
 * Every list screen follows the same shape — heading, a row of figures, a
 * table — so one skeleton fits them all closely enough not to jump when the
 * content replaces it. Kept below the `(panel)` layout on purpose: the
 * session check lives in the layout, above this boundary, so a signed-out
 * visitor still gets a real redirect rather than a skeleton that turns into
 * one.
 */
export default function PanelLoading() {
  const title = adminScreenLabel(stripLocale(usePathname()));

  return (
    <AdminContainer data-skeleton>
      <div
        className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
        aria-busy
        aria-live="polite"
      >
        <div className="min-w-0">
          {title ? (
            <h1 className="font-display text-[1.75rem] leading-tight font-normal tracking-[-0.015em] text-ink lg:text-[2rem]">
              {title}
            </h1>
          ) : (
            <Skeleton className="h-9 w-64 lg:h-10" />
          )}
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36 shrink-0" />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-sm border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="size-8" />
            </div>
            <Skeleton className="mt-4 h-7 w-16" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-sm border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
        <ul className="divide-y divide-line">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="flex items-center gap-6 px-5 py-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="hidden h-4 w-40 md:block" />
              <Skeleton className="hidden h-4 w-32 lg:block" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="ms-auto h-4 w-16" />
            </li>
          ))}
        </ul>
      </div>
    </AdminContainer>
  );
}
