"use client";

import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

import { PortalContainer } from "@/components/partners/PortalPage";
import { Skeleton } from "@/components/ui/Skeleton";
import { stripLocale } from "@/lib/i18n/config";
import { portalScreenLabel } from "@/lib/partners/navigation";

/**
 * What a portal screen looks like before its data has arrived.
 *
 * Every portal screen is a dynamic route — it reads the session cookie and
 * asks the API for live records — and Next does not prefetch a dynamic route
 * unless it has a loading boundary. With one, the shell and this skeleton are
 * prefetched while the sidebar is on screen, so a click commits at once and
 * the screen streams in when its data lands, instead of the sidebar appearing
 * to do nothing for the length of a server render.
 *
 * The title is real rather than a grey bar — the navigation knows what each
 * screen is called — so the page does not seem to load twice. Used only on
 * leaf routes: a boundary above a detail page would answer a missing booking
 * with a 200 before its 404 was known.
 */
export function PortalLoading({
  variant = "list",
}: {
  /** `list` for a register, `form` for a stack of panels. */
  variant?: "list" | "form" | "dashboard";
}) {
  const label = portalScreenLabel(stripLocale(usePathname()));
  // The dashboard is titled with the company's name, which only the data
  // knows; a bar holds its place instead of a word that would change.
  const title = variant === "dashboard" ? null : label;

  return (
    <PortalContainer narrow={variant === "form"}>
      <div className="mb-6 lg:mb-8" aria-busy>
        {title ? (
          <h1 className="font-display text-[1.625rem] leading-[1.2] font-normal tracking-[-0.015em] text-ink sm:text-[1.75rem] lg:text-[2rem]">
            {title}
          </h1>
        ) : (
          <Skeleton className="h-9 w-56" />
        )}
        {/* Said in words as well as shape: grey bars alone do not tell anyone
            that something is happening. */}
        <p role="status" className="mt-2 flex items-center gap-2 text-[0.9375rem] text-muted">
          <Loader2 size={15} className="animate-spin text-brand-text" aria-hidden />
          {label ? `Loading ${label.toLowerCase()}…` : "Loading…"}
        </p>
      </div>

      {variant === "dashboard" && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="rounded-md border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="size-8" />
                </div>
                <Skeleton className="mt-2 h-7 w-12" />
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-md border border-line bg-surface lg:col-span-2">
              <div className="border-b border-line px-4 py-4 sm:px-5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-2 h-3 w-64 max-w-full" />
              </div>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="mt-2.5 h-3.5 w-48 max-w-full" />
                </div>
              ))}
            </div>
            <div className="h-56 rounded-md border border-line bg-surface p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-5 h-3.5 w-full" />
              <Skeleton className="mt-4 h-3.5 w-full" />
              <Skeleton className="mt-4 h-3.5 w-2/3" />
            </div>
          </div>
        </>
      )}

      {variant === "list" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-10 w-28" />
          </div>
          <div className="mt-5 rounded-md border border-line bg-surface">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="hidden h-3.5 w-20 sm:block" />
              </div>
            ))}
          </div>
        </>
      )}

      {variant === "form" && (
        <div className="space-y-6">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="rounded-md border border-line bg-surface">
              <div className="border-b border-line px-4 py-4 sm:px-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-72 max-w-full" />
              </div>
              <div className="grid gap-4 px-4 py-5 sm:grid-cols-2 sm:px-5">
                {Array.from({ length: 4 }, (_, field) => (
                  <div key={field}>
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-2 h-11 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalContainer>
  );
}
