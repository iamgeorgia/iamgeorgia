import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { HelpArticleList } from "@/components/admin/help/HelpArticleList";
import { HelpCategoryIcon } from "@/components/admin/help/HelpCategoryList";
import { requireScreen } from "@/lib/auth/session";
import { helpArticlesIn, helpCategoryById, helpCategoriesFor } from "@/lib/admin/help";
import { getI18n } from "@/lib/i18n/server";

type Props = PageProps<"/[locale]/admin/help/[category]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  return { title: helpCategoryById(category)?.title ?? "Help & tutorials" };
}

/**
 * One area of the manual: its articles in reading order. An area the
 * viewer's role may not read answers not-found, matching the 403 the
 * underlying screens would give — a dispatcher reading about fares would be
 * reading about a screen they cannot open.
 */
export default async function HelpCategoryPage({ params }: Props) {
  const session = await requireScreen();
  const { category: categoryId } = await params;
  const { path } = await getI18n();
  const capabilities = session.user.capabilities ?? [];

  const category = helpCategoryById(categoryId);
  if (!category || !helpCategoriesFor(capabilities).some((readable) => readable.id === category.id)) notFound();

  const articles = helpArticlesIn(category.id, capabilities);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Help & tutorials", href: path("/admin/help") },
          { label: category.title },
        ]}
      />
      <AdminPageHeader title={category.title} description={category.summary} help={false} />

      <div className="mt-8 max-w-4xl">
        {articles.length > 0 ? (
          <HelpArticleList articles={articles} />
        ) : (
          <div className="flex flex-col items-center rounded-sm border border-dashed border-line bg-surface-soft/40 px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-background text-brand-text">
              <HelpCategoryIcon name={category.iconName} size={20} />
            </span>
            <p className="mt-4 text-[0.9375rem] text-muted">Nothing written for this area yet.</p>
          </div>
        )}
      </div>
    </AdminContainer>
  );
}
