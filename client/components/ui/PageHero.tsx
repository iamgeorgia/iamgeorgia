import Image from "next/image";

import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { Container } from "./Container";

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
  image: string;
  imageAlt: string;
  breadcrumbs?: Crumb[];
  /** Search or filter UI docked beneath the copy. */
  children?: React.ReactNode;
  size?: "compact" | "tall";
}

/**
 * Shared index-page hero. Shorter and calmer than the homepage hero so section
 * landing pages feel like a level down rather than a second front door.
 */
export function PageHero({
  eyebrow,
  title,
  description,
  image,
  imageAlt,
  breadcrumbs,
  children,
  size = "compact",
}: PageHeroProps) {
  return (
    <section
      className={
        size === "tall"
          ? "relative flex min-h-[68svh] items-end overflow-hidden bg-ink"
          : "relative flex min-h-[52svh] items-end overflow-hidden bg-ink"
      }
    >
      <Image
        src={image}
        alt={imageAlt}
        fill
        preload
        fetchPriority="high"
        sizes="100vw"
        className="animate-hero-zoom object-cover"
      />
      <div className="scrim-full absolute inset-0" aria-hidden />
      <div className="scrim-side absolute inset-0" aria-hidden />

      <Container className="relative pt-28 pb-14 sm:pt-32 lg:pb-16">
        {breadcrumbs && (
          <div className="animate-hero-rise-soft mb-6" style={{ animationDelay: "0.05s" }}>
            <Breadcrumbs items={breadcrumbs} tone="light" />
          </div>
        )}

        {eyebrow && (
          <p
            className="type-eyebrow animate-hero-rise-soft text-on-dark/70"
            style={{ animationDelay: "0.1s" }}
          >
            {eyebrow}
          </p>
        )}

        <h1
          className="type-h1 animate-hero-rise mt-5 max-w-3xl text-on-dark text-balance"
          style={{ animationDelay: "0.18s" }}
        >
          {title}
        </h1>

        {description && (
          <p
            className="type-body-lg animate-hero-rise-soft mt-6 max-w-xl text-on-dark/80"
            style={{ animationDelay: "0.28s" }}
          >
            {description}
          </p>
        )}

        {children && (
          <div className="animate-hero-rise-soft mt-10" style={{ animationDelay: "0.38s" }}>
            {children}
          </div>
        )}
      </Container>
    </section>
  );
}
