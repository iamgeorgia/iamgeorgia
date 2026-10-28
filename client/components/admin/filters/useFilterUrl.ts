"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";

import { bookingFiltersToParams, type BookingFilterState, type SearchParams } from "@/lib/admin/bookingFilters";

/**
 * The one way a register's filters change: by writing the URL.
 *
 * Filters live in the address, not in component state, so a filtered view is
 * shareable, survives a reload and carries into the browser's history. The
 * component never filters locally — it writes to the URL inside a transition
 * and lets the Server Component above it re-render — which is the pattern
 * every register shares and the reason a hundred thousand bookings never
 * have to be shipped to the browser to search them.
 */

export type FilterChange = Record<string, string | string[] | null | undefined>;

export function useFilterUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  /** The current search params as the parsers read them: repeated keys become arrays. */
  const record = useMemo<SearchParams>(() => {
    const out: SearchParams = {};
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      out[key] = all.length > 1 ? all : all[0];
    }
    return out;
  }, [params]);

  const navigate = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [pathname, router],
  );

  /**
   * Changes some keys and leaves the rest. An array is written as repeated
   * parameters; null, undefined and "" remove the key. Changing a filter
   * invalidates the page number: page 4 of the old result set is rarely page
   * 4 of the new one, and is often past the end of it.
   */
  const apply = useCallback(
    (changes: FilterChange) => {
      const next = new URLSearchParams(params.toString());

      for (const [key, value] of Object.entries(changes)) {
        next.delete(key);
        if (Array.isArray(value)) {
          for (const item of value) if (item) next.append(key, item);
        } else if (value !== null && value !== undefined && value !== "") {
          next.set(key, value);
        }
      }

      if (!("page" in changes)) next.delete("page");
      navigate(next);
    },
    [navigate, params],
  );

  /**
   * Replaces the whole filter state — what a preset or "Clear filters" does.
   * Keys named in `keep` survive: the portal's `product` tab, for one, which
   * is navigation rather than a filter.
   */
  const replace = useCallback(
    (state: Partial<BookingFilterState>, keep: readonly string[] = []) => {
      const next = new URLSearchParams();
      for (const key of keep) for (const value of params.getAll(key)) next.append(key, value);
      for (const [key, value] of Object.entries(bookingFiltersToParams(state))) {
        for (const item of Array.isArray(value) ? value : [value]) next.append(key, item);
      }
      navigate(next);
    },
    [navigate, params],
  );

  return { params, record, apply, replace, pending };
}
