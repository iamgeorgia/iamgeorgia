"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import { useLocalePath } from "@/lib/i18n/provider";
import type { HelpArticle, HelpLinkTargets } from "@/lib/admin/help/types";
import { cn } from "@/lib/utils";
import { HelpBlockView } from "./HelpBlocks";

/**
 * One article, rendered in full.
 *
 * The same component serves the article page and the contextual dialog:
 * `compact` drops the page-level heading rank and tightens the spacing, and
 * `section` scrolls the reader to the heading the screen's route mapped to.
 * Heading ids are prefixed per instance so an article opened in a dialog
 * over a screen never collides with an element id on that screen.
 */
export function HelpArticleView({
  article,
  targets,
  section,
  compact,
  className,
}: {
  article: HelpArticle;
  targets: HelpLinkTargets;
  /** A `heading` id to open the article at. */
  section?: string;
  compact?: boolean;
  className?: string;
}) {
  const path = useLocalePath();
  const container = useRef<HTMLElement>(null);
  const instance = useId();
  // Only the dialog needs a prefix; on the page the ids stay plain so a
  // `#section` link in the address bar works as the reader expects.
  const headingId = (id: string) => (compact ? `${instance}-${id}` : id);

  const headings = article.blocks.flatMap((block) =>
    block.type === "heading" ? [{ id: block.id, text: block.text }] : [],
  );
  const related = (article.related ?? [])
    .map((id) => targets[id])
    .filter((target): target is NonNullable<typeof target> => Boolean(target));

  const scrollTo = (id: string) => {
    container.current?.querySelector<HTMLElement>(`[id="${headingId(id)}"]`)?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  };

  // On mount only: the section the route mapped to, once the blocks are in
  // the DOM. Inside the dialog `scrollIntoView` scrolls the dialog's own
  // panel; on the page the browser's hash handling does the same job.
  //
  // Two frames, not one: the dialog moves focus into itself on the first
  // frame after mounting, and a `focus()` scrolls its target into view —
  // which would undo a scroll made in that same frame.
  useEffect(() => {
    if (!section || !compact) return;
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => scrollTo(section));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Title = compact ? "h2" : "h1";

  return (
    <article ref={container} className={cn("max-w-(--container-prose)", className)}>
      <header>
        <Title
          className={cn(
            "font-display font-normal tracking-[-0.015em] text-ink",
            compact ? "text-[1.375rem] leading-tight" : "text-[1.75rem] leading-tight lg:text-[2rem]",
          )}
        >
          {article.title}
        </Title>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{article.summary}</p>
      </header>

      {headings.length > 1 && (
        <nav aria-label="On this page" className="mt-5 rounded-sm border border-line bg-surface-soft/40 px-4 py-3">
          <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-subtle uppercase">On this page</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {headings.map((heading) => (
              <li key={heading.id}>
                {compact ? (
                  <button
                    type="button"
                    onClick={() => scrollTo(heading.id)}
                    className="text-[0.8125rem] font-medium text-brand-text hover:underline"
                  >
                    {heading.text}
                  </button>
                ) : (
                  <a
                    href={`#${heading.id}`}
                    className="text-[0.8125rem] font-medium text-brand-text hover:underline"
                  >
                    {heading.text}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className={cn("flex flex-col", compact ? "mt-5 gap-4" : "mt-8 gap-5")}>
        {article.blocks.map((block, index) => (
          <HelpBlockView key={index} block={block} targets={targets} headingId={headingId} />
        ))}
      </div>

      {related.length > 0 && (
        <footer className="mt-8 border-t border-line pt-5">
          <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-subtle uppercase">Related</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {related.map((target) => (
              <li key={target.id}>
                <Link
                  href={path(target.href)}
                  className="text-[0.875rem] font-medium text-brand-text underline-offset-4 hover:underline"
                >
                  {target.title}
                </Link>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}
