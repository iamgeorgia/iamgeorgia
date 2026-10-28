import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, ChevronRight, ShieldAlert, Wrench } from "lucide-react";

import { AdminContainer, AdminPageHeader, AdminPanel } from "@/components/admin/AdminPage";
import { HelpCategoryList } from "@/components/admin/help/HelpCategoryList";
import { HelpHub } from "@/components/admin/help/HelpHub";
import { QuickStartCard } from "@/components/admin/help/QuickStartCard";
import { requireScreen } from "@/lib/auth/session";
import {
  helpArticleById,
  helpArticlePath,
  helpArticlesIn,
  helpCategoriesFor,
  helpReadable,
  quickStartFor,
  quickStartTitle,
} from "@/lib/admin/help";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Help & tutorials" };

/**
 * The manual's front page: search, the reader's Quick Start, the areas, and
 * the three chapters worth reading before touching anything. Everything on
 * it is static data filtered to what the viewer can open — the registry never
 * makes a request, so this is the one panel screen that cannot fail to load.
 */
export default async function HelpHubPage() {
  const session = await requireScreen();
  const { path } = await getI18n();
  const capabilities = session.user.capabilities ?? [];

  const categories = helpCategoriesFor(capabilities);
  const counts = Object.fromEntries(
    categories.map((category) => [category.id, helpArticlesIn(category.id, capabilities).length]),
  );
  const categoryTitles = Object.fromEntries(categories.map((category) => [category.id, category.title]));

  // Only chapters that exist for this reader; a link to an unwritten one
  // would be a 404 on the manual's own front page.
  const readFirst = [
    { id: "rf-dangerous-actions", icon: ShieldAlert, label: "Dangerous actions — the do-not list" },
    { id: "pb-statuses", icon: BookOpen, label: "Draft, on sale, off sale, archived — what each status means" },
    { id: "rf-troubleshooting", icon: Wrench, label: "When something goes wrong" },
  ]
    .map((entry) => ({ ...entry, article: helpArticleById(entry.id) }))
    .filter((entry) => entry.article && helpReadable(entry.article, capabilities));

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Help & tutorials"
        description="How the panel works, screen by screen. Every screen also has a Help button beside its title that opens the page written for it."
        help={false}
      />

      <div className="mt-8">
        <HelpHub capabilities={capabilities} categoryTitles={categoryTitles}>
          <div className="mt-8">
            <QuickStartCard title={quickStartTitle(capabilities)} steps={quickStartFor(capabilities)} />
          </div>

          <section className="mt-10">
            <h2 className="text-[0.6875rem] font-semibold tracking-[0.16em] text-subtle uppercase">Browse by area</h2>
            <div className="mt-3">
              <HelpCategoryList categories={categories} counts={counts} />
            </div>
          </section>

          {readFirst.length > 0 && (
            <div className="mt-10">
              <AdminPanel title="Read before you click" description="Short, and worth ten minutes on the first day." bodyClassName="p-2">
                <ul className="divide-y divide-line">
                  {readFirst.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        href={path(helpArticlePath({ article: entry.article! }))}
                        className="flex items-center gap-3 rounded-sm px-3 py-3 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-surface-soft/60"
                      >
                        <entry.icon size={17} className="shrink-0 text-brand-text" aria-hidden />
                        <span className="min-w-0 flex-1">{entry.label}</span>
                        <ChevronRight size={16} className="shrink-0 text-subtle rtl:-scale-x-100" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </AdminPanel>
            </div>
          )}
        </HelpHub>
      </div>
    </AdminContainer>
  );
}
