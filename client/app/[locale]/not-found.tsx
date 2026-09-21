import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getI18n } from "@/lib/i18n/server";
import { navLabel, primaryNavigation } from "@/lib/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.notFound.metaTitle };
}

/**
 * The bare 404, above every route group.
 *
 * Next bundles this file's client dependencies into the first load of every
 * route under the root layout — the admin panel, the partner portal and the
 * driver app included. So it renders nothing that needs JavaScript: no site
 * header with its menus, no newsletter form, no motion library. The public
 * site has its own branded version in `(site)/not-found.tsx`, which is what a
 * visitor normally sees; this one is reached only from outside that group.
 */
export default async function NotFound() {
  const { t, path } = await getI18n();

  return (
    <main id="main" className="flex flex-1 items-center bg-ink">
      <Container className="py-28">
        <p className="type-eyebrow animate-hero-rise text-on-dark/60">{t.notFound.eyebrow}</p>

        <h1
          className="type-display animate-hero-rise mt-6 max-w-3xl text-on-dark text-balance"
          style={{ animationDelay: "0.1s" }}
        >
          {t.notFound.title}
        </h1>

        <p
          className="type-body-lg animate-hero-rise mt-7 max-w-lg text-on-dark/75"
          style={{ animationDelay: "0.2s" }}
        >
          {t.notFound.body}
        </p>

        <div className="animate-hero-rise mt-10 flex flex-wrap gap-3" style={{ animationDelay: "0.3s" }}>
          <Button href={path("/")} size="lg" variant="light">
            {t.notFound.backHome}
          </Button>
          <Button href={path("/contact")} size="lg" variant="outlineLight">
            {t.notFound.askUs}
          </Button>
        </div>

        <nav
          aria-label={t.notFound.sections}
          className="animate-hero-rise mt-16 border-t border-on-dark/15 pt-8"
          style={{ animationDelay: "0.4s" }}
        >
          <ul className="flex flex-wrap gap-x-8 gap-y-3">
            {primaryNavigation.map((item) => (
              <li key={item.key}>
                <Link
                  href={path(item.href)}
                  className="text-sm font-medium text-on-dark/70 transition-colors hover:text-on-dark"
                >
                  {navLabel(t, item.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </main>
  );
}
