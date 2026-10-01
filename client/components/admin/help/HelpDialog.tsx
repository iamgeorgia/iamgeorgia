"use client";

import Link from "next/link";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { useLocalePath } from "@/lib/i18n/provider";
import type { HelpCategory, HelpLinkTargets, HelpMatch } from "@/lib/admin/help/types";
import { HelpArticleView } from "./HelpArticleView";
import { HelpCategoryList } from "./HelpCategoryList";

/**
 * The contextual help, opened over the screen it explains.
 *
 * A dialog rather than a side panel because `ui/Modal` already does the
 * work a reader needs — focus stays inside, Escape closes, focus returns to
 * the Help button — and a drawer that let the reader keep typing in the form
 * behind it would be a new primitive with its own accessibility to get
 * right. "Open as a page" is there for anyone who wants the article beside
 * the screen in a second window.
 */
export interface HelpDialogContent {
  match: HelpMatch | null;
  targets: HelpLinkTargets;
  /** Shown instead of an article when no article claims the screen. */
  fallback: HelpCategory | null;
  fallbackCategories: HelpCategory[];
  fallbackCounts: Record<string, number>;
  categoryTitle: string | null;
}

export function HelpDialog({
  open,
  onClose,
  loading,
  content,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  content: HelpDialogContent | null;
}) {
  const path = useLocalePath();
  const article = content?.match?.article ?? null;
  const title = article?.title ?? content?.fallback?.title ?? "Help";
  const pageHref = article
    ? `/admin/help/${article.category}/${article.id}${content?.match?.section ? `#${content.match.section}` : ""}`
    : content?.fallback
      ? `/admin/help/${content.fallback.id}`
      : "/admin/help";

  return (
    <Modal open={open} onClose={onClose} title={title} hideTitle size="lg">
      {/*
        The bar stays put while the article scrolls beneath it, and leaves the
        end of the row to the dialog's close button (absolute, over the top
        end corner) — `min-h` matches that button's centre line.
      */}
      <div className="sticky top-0 z-10 flex min-h-15 items-center justify-between gap-4 border-b border-line bg-background/95 ps-5 pe-16 backdrop-blur-sm sm:min-h-17 sm:ps-8 sm:pe-20">
        <p className="min-w-0 truncate text-[0.6875rem] font-semibold tracking-[0.14em] text-subtle uppercase">
          {content?.categoryTitle ?? "Help & tutorials"}
        </p>
        <Link
          href={path(pageHref)}
          className="inline-flex shrink-0 items-center gap-1 text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
        >
          Open as a page
          <ArrowUpRight size={14} className="rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      <div className="px-5 pt-6 pb-8 sm:px-8 sm:pt-7 sm:pb-10">
        {loading || !content ? (
          <p className="flex items-center justify-center gap-2 py-12 text-[0.875rem] text-muted">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Finding the right page…
          </p>
        ) : article ? (
          <HelpArticleView
            article={article}
            targets={content.targets}
            section={content.match?.section}
            compact
          />
        ) : (
          <div>
            <h2 className="font-display text-[1.375rem] leading-tight text-ink">
              {content.fallback?.title ?? "Help & tutorials"}
            </h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
              This screen has no page of its own yet. The articles for its area are listed below.
            </p>
            <div className="mt-5">
              <HelpCategoryList
                categories={content.fallbackCategories}
                counts={content.fallbackCounts}
                compact
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
