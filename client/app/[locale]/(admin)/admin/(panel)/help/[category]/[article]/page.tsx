import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer } from "@/components/admin/AdminPage";
import { HelpArticleView } from "@/components/admin/help/HelpArticleView";
import { getSession } from "@/lib/auth/session";
import { helpArticleById, helpCategoryById, helpLinkTargets, helpRoleOf } from "@/lib/admin/help";
import { getI18n } from "@/lib/i18n/server";

type Props = PageProps<"/[locale]/admin/help/[category]/[article]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { article } = await params;
  return { title: helpArticleById(article)?.title ?? "Help & tutorials" };
}

/**
 * One article, at reading width. The category in the URL must be the
 * article's own — a link that names the wrong one is a stale link, not a
 * second address for the same page.
 */
export default async function HelpArticlePage({ params }: Props) {
  const { category: categoryId, article: articleId } = await params;
  const [session, { path }] = await Promise.all([getSession(), getI18n()]);
  const role = helpRoleOf(session?.user.role ?? "ADMIN");

  const article = helpArticleById(articleId);
  const category = helpCategoryById(categoryId);
  if (!article || !category || article.category !== category.id || !article.roles.includes(role)) {
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
      <HelpArticleView article={article} targets={helpLinkTargets(article, role)} className="mt-2" />
    </AdminContainer>
  );
}
