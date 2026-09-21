import Image from "next/image";
import { ArrowDown } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getI18n } from "@/lib/i18n/server";

/**
 * The entrance here is CSS, not Framer Motion. The headline is the LCP element,
 * so it must not depend on hydration to become visible — everything below the
 * fold uses the scroll-triggered motion primitives instead.
 */
export async function Hero() {
  const { t, path } = await getI18n();

  return (
    <section className="relative flex min-h-[92svh] flex-col justify-end overflow-hidden bg-ink">
      <div className="animate-hero-zoom absolute inset-0">
        <Image
          src="/images/home/hero.jpg"
          alt={t.home.hero.imageAlt}
          fill
          preload
          fetchPriority="high"
          sizes="100vw"
          className="object-cover"
        />
      </div>
      <div className="scrim-full absolute inset-0" aria-hidden />
      <div className="scrim-side absolute inset-0" aria-hidden />

      <Container className="relative pt-28 pb-12 sm:pt-32 lg:pb-16">
        <div className="max-w-4xl">
          <p className="type-eyebrow animate-hero-rise-soft text-on-dark/70" style={{ animationDelay: "0.1s" }}>
            {t.home.hero.eyebrow}
          </p>

          <h1
            className="type-display animate-hero-rise mt-6 text-on-dark text-balance"
            style={{ animationDelay: "0.2s" }}
          >
            {t.home.hero.title}
          </h1>

          <p
            className="type-body-lg animate-hero-rise-soft mt-7 max-w-xl text-on-dark/80"
            style={{ animationDelay: "0.32s" }}
          >
            {t.home.hero.body}
          </p>

          <div
            className="animate-hero-rise-soft mt-10 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "0.44s" }}
          >
            <Button href={path("/tours")} size="lg" variant="light">
              {t.actions.exploreTours}
            </Button>
            <Button href={path("/hotels")} size="lg" variant="outlineLight">
              {t.actions.browseHotels}
            </Button>
          </div>
        </div>
      </Container>

      {/*
       * The ribbon grounds the hero and gives the scroll somewhere to go. It
       * states what the platform does — live availability, local suppliers,
       * four languages, terms shown up front — rather than figures, because
       * there are no audited figures to show yet and an invented one is a
       * claim a guest could hold us to.
       */}
      <div
        className="animate-hero-rise-soft relative border-t border-on-dark/15"
        style={{ animationDelay: "0.56s" }}
      >
        <Container>
          <dl className="grid grid-cols-2 gap-y-6 py-7 lg:grid-cols-4">
            {t.studio.credentials.map((item) => (
              <div key={item.label} className="lg:px-2">
                <dt className="type-h4 text-on-dark">{item.value}</dt>
                <dd className="type-caption mt-1 text-on-dark/60">{item.label}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </div>

      <span
        className="pointer-events-none absolute end-6 bottom-40 hidden items-center gap-2 text-on-dark/45 lg:flex"
        aria-hidden
      >
        <span className="type-eyebrow [writing-mode:vertical-rl]">{t.a11y.scroll}</span>
        <ArrowDown size={14} />
      </span>
    </section>
  );
}
