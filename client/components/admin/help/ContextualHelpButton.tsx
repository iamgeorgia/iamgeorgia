"use client";

import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { useState } from "react";

import { useAdminViewer } from "@/components/admin/AdminViewerContext";
import { stripLocale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { HelpDialog, type HelpDialogContent } from "./HelpDialog";

/**
 * The Help button every page header carries.
 *
 * It knows nothing until it is clicked: the registry — every article's
 * text — is imported then, not with the screen, so the panel's shared
 * bundle grows by a button and nothing else. On click it resolves the
 * article for the path it is on (locale stripped, as the sidebar does) or,
 * failing that, the area the path belongs to, and opens the dialog.
 *
 * A page may name its article outright (`articleId`) where the path is not
 * enough, and the help pages themselves render nothing here — a Help button
 * on the manual would open the manual.
 */
export function ContextualHelpButton({
  articleId,
  section,
  className,
}: {
  articleId?: string;
  section?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const viewer = useAdminViewer();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<HelpDialogContent | null>(null);

  const canonical = stripLocale(pathname);
  // Outside the panel shell there is no viewer and no manual to open; on
  // the manual itself a Help button would open the page it sits on.
  if (!viewer) return null;
  if (canonical === "/admin/help" || canonical.startsWith("/admin/help/")) return null;

  const openHelp = async () => {
    setOpen(true);
    if (content && !articleId) return; // Already resolved for this screen.
    setLoading(true);

    try {
      const help = await import("@/lib/admin/help");
      const role = help.helpRoleOf(viewer?.role ?? "ADMIN");
      const named = articleId ? help.helpArticleById(articleId) : undefined;
      const match = named
        ? { article: named, section }
        : help.helpForPath(canonical);
      const readable = match && match.article.roles.includes(role) ? match : null;
      const fallback = readable ? null : help.helpFallbackForPath(canonical);
      const categories = help.helpCategoriesFor(role);
      const counts = Object.fromEntries(
        categories.map((category) => [category.id, help.helpArticlesIn(category.id, role).length]),
      );

      setContent({
        match: readable,
        targets: readable ? help.helpLinkTargets(readable.article, role) : {},
        fallback,
        fallbackCategories: fallback ? categories.filter((category) => category.id === fallback.id) : categories,
        fallbackCounts: counts,
        categoryTitle: readable
          ? (help.helpCategoryById(readable.article.category)?.title ?? null)
          : (fallback?.title ?? null),
      });
    } catch (error) {
      // The manual must never take a screen down. With nothing resolved the
      // dialog offers the hub, which is still more than nothing.
      console.error("Help could not be loaded:", error);
      setContent({
        match: null,
        targets: {},
        fallback: null,
        fallbackCategories: [],
        fallbackCounts: {},
        categoryTitle: null,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void openHelp()}
        aria-label="Help for this screen"
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-3.5 text-[0.8125rem] font-semibold text-body transition-colors hover:border-ink hover:bg-surface-soft hover:text-ink",
          className,
        )}
      >
        <CircleHelp size={16} className="text-brand-text" aria-hidden />
        Help
      </button>

      <HelpDialog open={open} onClose={() => setOpen(false)} loading={loading} content={content} />
    </>
  );
}
