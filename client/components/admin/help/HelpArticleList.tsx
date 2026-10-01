"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { useLocalePath } from "@/lib/i18n/provider";
import type { HelpArticle } from "@/lib/admin/help/types";
import { WhereChip } from "./HelpBlocks";

/**
 * A category's articles as rows: the title, the one-line summary, and — when
 * the article opens with one — the path to the screen it explains, so a
 * reader can tell which row is about the screen they are looking for.
 */
export function HelpArticleList({ articles }: { articles: HelpArticle[] }) {
  const path = useLocalePath();

  return (
    <ol className="divide-y divide-line rounded-sm border border-line bg-surface">
      {articles.map((article) => {
        const where = article.blocks.find((block) => block.type === "where");
        return (
          <li key={article.id}>
            <Link
              href={path(`/admin/help/${article.category}/${article.id}`)}
              className="group flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-soft/50"
            >
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-semibold text-ink group-hover:text-brand-text">
                  {article.title}
                </span>
                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-muted">{article.summary}</span>
                {where && where.type === "where" && (
                  <span className="mt-2 block">
                    <WhereChip path={where.path} />
                  </span>
                )}
              </span>
              <ChevronRight size={16} className="mt-1 shrink-0 text-subtle rtl:-scale-x-100" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
