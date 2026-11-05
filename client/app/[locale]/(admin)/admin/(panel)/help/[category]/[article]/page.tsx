import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer } from "@/components/admin/AdminPage";
import { HelpArticleView } from "@/components/admin/help/HelpArticleView";
import { requireScreen } from "@/lib/auth/session";
import { helpArticleById, helpCategoryById, helpLinkTargets, helpReadable } from "@/lib/admin/help";
import { getI18n } from "@/lib/i18n/server";

type Props = PageProps<"/[locale]/admin/help/[category]/[article]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { article } = await params;
  return { title: helpArticleById(article)?.title ?? "Help & tutorials" };
}

/**
 * One article, at reading width. The category in the URL must be the
 * article's own — a link that names the wrong one is a stale link, not a
 * second address for the same page. An article about a screen the viewer
 * is not offered answers not-found, matching what the screen itself does.
 */
export default async function HelpArticlePage({ params }: Props) {
  const session = await requireScreen();
  const { category: categoryId, article: articleId } = await params;
  const { path } = await getI18n();
  const capabilities = session.user.capabilities ?? [];

  const article = helpArticleById(articleId);
  const category = helpCategoryById(categoryId);
  if (!article || !category || article.category !== category.id || !helpReadable(article, capabilities)) {
    notFound();
  }

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Help & tutorials", href: path("/admin/help") },
          { label: category.title, href: path(`/admin/help/${category.id}`) },
          { label: article.title },
        ]}
      />
      <HelpArticleView article={article} targets={helpLinkTargets(article, capabilities)} className="mt-2" />
    </AdminContainer>
  );
}
