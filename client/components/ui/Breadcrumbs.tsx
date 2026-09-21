import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: Crumb[];
  tone?: "dark" | "light";
  className?: string;
}

/**
 * A Server Component: it has no state and every importer is a server page or
 * layout, so it renders once on the server and ships no JavaScript.
 */
export async function Breadcrumbs({ items, tone = "dark", className }: BreadcrumbsProps) {
  const { t } = await getI18n();

  return (
    <nav aria-label={t.a11y.breadcrumb} className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className={cn(
                    "type-caption transition-colors",
                    tone === "light" ? "text-on-dark/70 hover:text-on-dark" : "text-muted hover:text-brand-text",
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn("type-caption font-medium", tone === "light" ? "text-on-dark" : "text-ink")}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight
                  size={13}
                  // The separator points along the reading direction.
                  className={cn(tone === "light" ? "text-on-dark/40" : "text-subtle", "rtl:-scale-x-100")}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
