import type { Metadata } from "next";
import { Suspense } from "react";

import { CTASection } from "@/components/home/CTASection";
import { CultureStory } from "@/components/home/CultureStory";
import { FeaturedHotels, FeaturedHotelsFallback } from "@/components/home/FeaturedHotels";
import { Hero } from "@/components/home/Hero";
import { SignatureTours, SignatureToursFallback } from "@/components/home/SignatureTours";
import { Statement } from "@/components/home/Statement";
import { WhyIamGeorgia } from "@/components/home/WhyIamGeorgia";
import { site } from "@/constants/site";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo/metadata";

/**
 * `absoluteTitle` opts out of the root `%s — I'am Georgia` template: the home
 * tab should read as the brand plus its tagline, not "Home — I'am Georgia".
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return pageMetadata({
    path: "/",
    title: `${site.name} — ${t.meta.tagline}`,
    description: t.meta.description,
    absoluteTitle: true,
  });
}

/**
 * Section order is deliberate: immersive → quiet → cards → immersive → cards →
 * quiet → immersive. No two neighbouring sections share a layout, which is what
 * keeps a long homepage from feeling like a template. The page sells only what
 * the platform sells — hotels, tours and transfers.
 *
 * `SignatureTours` and `FeaturedHotels` read the API, and read it through the
 * session cookie — so this page renders on demand. Without a boundary around
 * each of them the whole document, hero included, waits on those calls before
 * a single byte is flushed, which puts an API round-trip in front of the LCP
 * element. Behind Suspense the hero ships immediately and the rails stream in
 * after it.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Statement />
      <Suspense fallback={<SignatureToursFallback />}>
        <SignatureTours />
      </Suspense>
      <CultureStory />
      <Suspense fallback={<FeaturedHotelsFallback />}>
        <FeaturedHotels />
      </Suspense>
      <WhyIamGeorgia />
      <CTASection />
    </>
  );
}
