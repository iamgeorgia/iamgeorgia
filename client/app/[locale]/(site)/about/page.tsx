import type { Metadata } from "next";
import Image from "next/image";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { PageHero } from "@/components/ui/PageHero";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return pageMetadata({
    path: "/about",
    title: t.about.metaTitle,
    description: t.about.metaDescription,
    image: "/images/about/team.jpg",
  });
}

/**
 * Only the non-translatable half of each frame lives here — the image. Alt
 * text comes from `about.sellImageAlts`, matched by position, so the three
 * entries must stay in the same order.
 */
const gallery = ["/images/about/team.jpg", "/images/culture/shepherd.jpg", "/images/experiences/polyphony.jpg"];

/**
 * What the platform is, in the reader's language. Every word is in the
 * dictionary, and none of it is a number or an anecdote we cannot stand
 * behind — the page describes how booking works here, not a founding myth.
 */
export default async function AboutPage() {
  const { t, path } = await getI18n();
  const about = t.about;

  return (
    <>
      <PageHero
        size="tall"
        eyebrow={about.heroEyebrow}
        title={about.heroTitle}
        description={about.heroDescription}
        image="/images/about/heritage.jpg"
        imageAlt={about.heroImageAlt}
      />

      <section className="py-16 sm:py-24 lg:py-32">
        <Container>
          <Reveal className="max-w-4xl">
            <p className="type-eyebrow text-brand-text">{about.introEyebrow}</p>
            <p className="type-h1 mt-8 text-balance">{about.introTitle}</p>
            <div className="mt-10 max-w-2xl space-y-5">
              <p className="type-body-lg text-body">{about.introBody1}</p>
              <p className="type-body-lg text-body">{about.introBody2}</p>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="bg-ink text-on-dark">
        <div className="grid lg:grid-cols-2">
          <div className="flex items-center px-5 py-16 sm:px-8 sm:py-20 lg:px-16 lg:py-28">
            <Reveal className="max-w-xl">
              <p className="type-eyebrow text-on-dark/50">{about.howEyebrow}</p>
              <h2 className="type-h2 mt-6 text-on-dark text-balance">{about.howTitle}</h2>
              <div className="mt-8 space-y-5 text-on-dark/70">
                <p className="type-body">{about.howBody1}</p>
                <p className="type-body">{about.howBody2}</p>
                <p className="type-body">{about.howBody3}</p>
              </div>
            </Reveal>
          </div>

          <Reveal variant="fade" className="relative min-h-80 lg:min-h-[40rem]">
            <Image
              src="/images/about/landscape.jpg"
              alt={about.howImageAlt}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </Reveal>
        </div>
      </section>

      <section className="py-16 sm:py-24 lg:py-32">
        <Container>
          <div className="grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-16">
            {/* Same pinned-intro treatment as the home page's "Why travel with
                us": identical two-column layout, so it should behave identically. */}
            <div className="lg:col-span-5 lg:sticky lg:top-32 lg:self-start">
              <Reveal>
                <p className="type-eyebrow text-brand-text">{about.valuesEyebrow}</p>
                <h2 className="type-h2 mt-6 text-balance">{about.valuesTitle}</h2>
              </Reveal>
            </div>

            <RevealGroup className="lg:col-span-7">
              <ol className="divide-y divide-line border-t border-line">
                {about.values.map((value, index) => (
                  <RevealItem key={value.title}>
                    <li className="flex gap-6 py-7 lg:gap-10">
                      <span className="type-caption pt-1 text-subtle tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3 className="type-h4">{value.title}</h3>
                        <p className="type-body mt-2.5 max-w-xl text-muted">{value.description}</p>
                      </div>
                    </li>
                  </RevealItem>
                ))}
              </ol>
            </RevealGroup>
          </div>
        </Container>
      </section>

      <section className="bg-surface-earth py-16 sm:py-24 lg:py-28">
        <Container>
          <Reveal>
            <SectionHeading
              eyebrow={about.sellEyebrow}
              title={about.sellTitle}
              description={about.sellDescription}
            />
          </Reveal>

          <Reveal className="mt-14 grid gap-4 sm:grid-cols-3">
            {gallery.map((src, index) => (
              <div key={src} className="relative aspect-4/5 overflow-hidden rounded-sm">
                <Image
                  src={src}
                  alt={about.sellImageAlts[index] ?? ""}
                  fill
                  sizes="(max-width: 640px) 90vw, 30vw"
                  className="object-cover"
                />
              </div>
            ))}
          </Reveal>
        </Container>
      </section>

      <section className="py-16 sm:py-24 lg:py-28">
        <Container>
          <Reveal className="max-w-2xl">
            <h2 className="type-h2 text-balance">{about.ctaTitle}</h2>
            <p className="type-body-lg mt-6 text-body">{about.ctaBody}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button href={path("/contact")} size="lg">
                {about.ctaPlan}
              </Button>
              <Button href={path("/tours")} size="lg" variant="outline">
                {about.ctaBrowse}
              </Button>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
