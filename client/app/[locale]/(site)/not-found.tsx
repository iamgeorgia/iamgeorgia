import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getI18n } from "@/lib/i18n/server";
import { navLabel, primaryNavigation } from "@/lib/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.notFound.metaTitle };
}

/**
 * The public site's 404, for a `notFound()` thrown by a catalogue page and for
 * any URL under a locale that matches nothing (`[...rest]/page.tsx` routes
 * those here). It renders inside the `(site)` layout, so the header and
 * footer come from there. The root `not-found.tsx` above this group is
 * deliberately bare: whatever it imports is shipped to every route in the
 * app, admin panel and driver app included.
 */
export default async function NotFound() {
  const { t, path } = await getI18n();
  return (
    <section className="relative flex min-h-[86svh] items-center overflow-hidden bg-ink">
      <Image
        src="/images/about/landscape.jpg"
        alt=""
        fill
        sizes="100vw"
        className="object-cover opacity-40"
      />
      <div className="scrim-full absolute inset-0" aria-hidden />
      <div className="scrim-side absolute inset-0" aria-hidden />

      <Container className="relative py-28">
        <p className="type-eyebrow animate-hero-rise-soft text-on-dark/60">{t.notFound.eyebrow}</p>

        <h1
          className="type-display animate-hero-rise mt-6 max-w-3xl text-on-dark text-balance"
          style={{ animationDelay: "0.1s" }}
        >
          {t.notFound.title}
        </h1>

        <p
          className="type-body-lg animate-hero-rise-soft mt-7 max-w-lg text-on-dark/75"
          style={{ animationDelay: "0.2s" }}
        >
          {t.notFound.body}
        </p>

        <div
          className="animate-hero-rise-soft mt-10 flex flex-wrap gap-3"
          style={{ animationDelay: "0.3s" }}
        >
          <Button href={path("/")} size="lg" variant="light">
            {t.notFound.backHome}
          </Button>
          <Button href={path("/contact")} size="lg" variant="outlineLight">
            {t.notFound.askUs}
          </Button>
        </div>

        <nav
          aria-label={t.notFound.sections}
          className="animate-hero-rise-soft mt-16 border-t border-on-dark/15 pt-8"
          style={{ animationDelay: "0.4s" }}
        >
          <ul className="flex flex-wrap gap-x-8 gap-y-3">
            {primaryNavigation.map((item) => (
              <li key={item.key}>
                <Link
                  href={path(item.href)}
                  className="group inline-flex items-center gap-2 text-sm font-medium text-on-dark/70 transition-colors hover:text-on-dark"
                >
                  {navLabel(t, item.key)}
                  <ArrowRight
                    size={14}
                    className="transition-transform duration-200 ease-(--ease-out-soft) group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </section>
  );
}
