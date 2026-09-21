import { unstable_rethrow } from "next/navigation";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { TourCard } from "@/components/tours/TourCard";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { listPublicTours } from "@/lib/api/tours";
import { getI18n } from "@/lib/i18n/server";
import type { TourSummary } from "@/types/tour";

/**
 * The homepage's tour rail, from the live catalogue.
 *
 * Featured journeys first, topped up from the rest of the programme: the API
 * sorts featured tours to the front, so one page of three is the whole
 * answer. Guarded: the homepage must not fall over
 * because one rail could not load — an empty rail simply renders nothing.
 *
 * `unstable_rethrow` first, because the catch must not swallow Next's own
 * signals: reading the session cookie inside a prerender throws an internal
 * "dynamic usage" error that tells the framework to render on demand, and
 * catching it would leave a static home page with no rail at all.
 */
export async function SignatureTours() {
  const { t, path, locale } = await getI18n();

  let tours: TourSummary[] = [];

  try {
    const { data } = await listPublicTours({ locale, pageSize: 3 });
    tours = data;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Signature tours failed:", error);
  }

  const [lead, ...rest] = tours;
  if (!lead) return null;

  return (
    <section className="py-16 sm:py-24 lg:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow={t.home.tours.eyebrow}
            title={t.home.tours.title}
            description={t.home.tours.description}
            action={{ label: t.actions.allTours, href: path("/tours") }}
          />
        </Reveal>

        <div className="mt-14 grid gap-10 lg:grid-cols-12 lg:gap-8">
          <Reveal className="lg:col-span-7">
            <TourCard tour={lead} variant="feature" />
          </Reveal>

          <RevealGroup className="grid gap-10 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
            {rest.slice(0, 2).map((tour) => (
              <RevealItem key={tour.id}>
                <TourCard tour={tour} />
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </Container>
    </section>
  );
}

/**
 * Holds the rail's place while it streams, in the same grid and at the same
 * card proportions so the page below it does not jump when the tours land.
 *
 * It does still collapse to nothing in the one case where the rail renders
 * nothing — an empty catalogue, or a failed call. That shift is roughly a
 * viewport and a half down the page, well past anything CLS measures, and it
 * is the price of not holding the hero behind the API.
 */
export function SignatureToursFallback() {
  return (
    <section className="py-16 sm:py-24 lg:py-32">
      <Container>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-5 h-10 w-2/3 max-w-lg" />
        <Skeleton className="mt-4 h-3 w-1/2 max-w-md" />

        <div className="mt-14 grid gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <Skeleton className="aspect-4/3 w-full lg:aspect-16/10" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
          <div className="grid gap-10 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </Container>
    </section>
  );
}
