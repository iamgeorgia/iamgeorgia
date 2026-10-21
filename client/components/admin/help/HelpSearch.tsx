"use client";

import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { useLocalePath } from "@/lib/i18n/provider";
import type { HelpSearchEntry, HelpSearchHit } from "@/lib/admin/help/search";
import { HelpInline } from "./HelpInline";

/**
 * The manual's search box.
 *
 * The index — every article's text — is loaded the first time the box gets
 * focus, not with the page: a reader who only browses never downloads it,
 * and one who types waits a few hundred milliseconds once. Results replace
 * whatever the hub shows below the box while the query is non-empty, so
 * the box behaves like the filter fields on the registers rather than like
 * a separate results page.
 *
 * Its own input rather than `ui/SearchField`, which hard-codes an element id
 * and is built around the public site's dark hero.
 */
type Engine = {
  index: HelpSearchEntry[];
  search: (index: HelpSearchEntry[], query: string) => HelpSearchHit[];
};

export function HelpSearch({
  capabilities,
  categoryTitles,
  onActiveChange,
}: {
  /** What the reader holds; only the articles these open are indexed. */
  capabilities: readonly string[];
  /** Category id → title, for the eyebrow on each result. */
  categoryTitles: Record<string, string>;
  /** Told whether results are currently replacing the hub's own content. */
  onActiveChange?: (active: boolean) => void;
}) {
  const path = useLocalePath();
  const inputId = useId();
  const engine = useRef<Engine | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<HelpSearchHit[]>([]);

  // Same 300 ms the registers use before they re-query.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [query]);

  const ensureEngine = async (): Promise<Engine> => {
    if (engine.current) return engine.current;
    setLoading(true);
    try {
      const [{ helpArticlesFor }, { buildHelpSearchIndex, searchHelp }] = await Promise.all([
        import("@/lib/admin/help"),
        import("@/lib/admin/help/search"),
      ]);
      engine.current = { index: buildHelpSearchIndex(helpArticlesFor(capabilities)), search: searchHelp };
      return engine.current;
    } finally {
      setLoading(false);
    }
  };

  // The search itself is asynchronous (the engine may still be loading), so
  // the results land from a callback rather than from the effect body. An
  // empty query clears the list the same way, one tick later, to keep the
  // two paths identical.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!debounced) {
        setHits([]);
        onActiveChange?.(false);
        return;
      }
      const loaded = await ensureEngine();
      if (cancelled) return;
      setHits(loaded.search(loaded.index, debounced));
      onActiveChange?.(true);
    };
    void Promise.resolve().then(run);
    return () => {
      cancelled = true;
    };
    // `ensureEngine` is stable in effect: it only reads a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const active = debounced.length > 0;

  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        Search the manual
      </label>
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 start-3.5 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => void ensureEngine()}
          placeholder="Search the manual — “publish”, “cancel a leg”, “kosher certificate”…"
          autoComplete="off"
          className="h-12 w-full rounded-sm border border-line bg-surface ps-11 pe-4 text-[0.9375rem] text-ink transition-colors focus:border-ink focus:outline-none"
        />
        {loading && (
          <Loader2
            size={16}
            className="absolute top-1/2 end-3.5 -translate-y-1/2 animate-spin text-subtle"
            aria-hidden
          />
        )}
      </div>

      {active && (
        <div className="mt-6">
          <p aria-live="polite" className="text-[0.8125rem] text-muted">
            {loading
              ? "Searching…"
              : hits.length === 0
                ? "Nothing matches."
                : `${hits.length} ${hits.length === 1 ? "article" : "articles"}`}
          </p>

          {!loading && hits.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                iconName="searchX"
                title="No article says that"
                description="Try the word as it appears on the screen — the name of the button, the status, or the panel."
                onReset={() => setQuery("")}
                resetLabel="Clear search"
              />
            </div>
          ) : (
            <ol className="mt-3 divide-y divide-line rounded-sm border border-line bg-surface">
              {hits.map(({ entry, snippet }) => (
                <li key={entry.id}>
                  <Link
                    href={path(`/admin/help/${entry.category}/${entry.id}`)}
                    className="block px-5 py-4 transition-colors hover:bg-surface-soft/50"
                  >
                    <span className="block text-[0.6875rem] font-semibold tracking-[0.14em] text-subtle uppercase">
                      {categoryTitles[entry.category] ?? entry.category}
                    </span>
                    <span className="mt-1 block text-[0.9375rem] font-semibold text-ink">{entry.title}</span>
                    <span className="mt-1 block text-[0.8125rem] leading-relaxed text-muted">
                      <HelpInline text={snippet} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
