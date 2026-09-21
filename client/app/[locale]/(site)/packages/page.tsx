import type { Metadata } from "next";
import { CalendarSearch } from "lucide-react";

import { PackageCard } from "@/components/packages/PackageCard";
import { PackageExplorer } from "@/components/packages/PackageExplorer";
import { PackageSearchForm } from "@/components/packages/PackageSearchForm";
import { Container } from "@/components/ui/Container";
import { PageHero } from "@/components/ui/PageHero";
import { listPublicPackages } from "@/lib/api/packages";
import { getI18n } from "@/lib/i18n/server";
import { packageSearchFromParams, packageSearchQueryString } from "@/lib/packages/query";
import { pageMetadata } from "@/lib/seo/metadata";

/**
 * One indexable address for the packages. A dated URL is one buyer's search
 * and says `noindex, follow`; the clean listing canonicalises to itself, as
 * on `/tours` and `/hotels`.
 */
export async function generateMetadata(
  props: PageProps<"/[locale]/packages">,
): Promise<Metadata> {
  const [searchParams, { t }] = await Promise.all([props.searchParams, getI18n()]);

  return pageMetadata({
    path: "/packages",
    title: t.packages.metaTitle,
    description: t.packages.metaDescription,
    index: Object.keys(searchParams).length === 0,
  });
}

/**
 * The catalogue of ready-made trips.
 *
 * Unlike `/tours`, a date here does not change what the *listing* queries:
 * pricing a package means resolving four products through four engines, and
 * doing that for every card would be a search page that takes seconds. The
 * date is carried onto the cards instead, so a buyer who picked one lands on
 * a package page already priced for it.
 *
 * The API decides the channel from the session: an anonymous visitor sees B2C
 * packages, a signed-in partner the whole ACTIVE catalogue at their own rates.
 */
export default async function PackagesPage(props: PageProps<"/[locale]/packages">) {
  const searchParams = await props.searchParams;
  const { t, locale } = await getI18n();
  const search = packageSearchFromParams(searchParams);
  const query = search ? packageSearchQueryString(search) : "";

  const { data: packages } = await listPublicPackages({ locale, pageSize: 100 });
  const regions = [
    ...new Set(packages.map((pkg) => pkg.destination?.name).filter((name): name is string => Boolean(name))),
  ].sort();
  const spotlight = packages.find((pkg) => pkg.featured) ?? null;

  return (
    <>
      <PageHero
        eyebrow={t.packages.heroEyebrow}
        title={t.packages.heroTitle}
        description={t.packages.heroDescription}
        image="/images/tours/truso-valley.jpg"
        imageAlt={t.packages.heroImageAlt}
      />

      <Container className="relative z-20 -mt-10 lg:-mt-14">
        <PackageSearchForm value={search} action="/packages" />
        {!search && (
          <p className="type-caption mt-3 flex items-center gap-2 text-muted">
            <CalendarSearch size={14} className="shrink-0 text-brand-text" aria-hidden />
            {t.packages.search.datesRequired}
          </p>
        )}
      </Container>

      {spotlight && (
        <section className="border-b border-line py-16 lg:py-20">
          <Container>
            <PackageCard pkg={spotlight} variant="feature" query={query} eager />
          </Container>
        </section>
      )}

      <PackageExplorer packages={packages} regions={regions} />
    </>
  );
}
