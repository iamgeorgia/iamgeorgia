"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { useI18n } from "@/lib/i18n/provider";

const baseSections = [
  { id: "overview", label: "Overview" },
  { id: "amenities", label: "Facilities" },
  { id: "location", label: "Location" },
  { id: "rooms", label: "Rooms" },
  { id: "reviews", label: "Reviews" },
  { id: "policies", label: "Policies" },
];

/**
 * Sticky in-page navigation, the pattern travellers expect on a long property
 * page. The active state follows the scroll position via IntersectionObserver.
 *
 * The kosher entry appears only for a property that offers kosher services,
 * and the facilities entry only when that section has something to show — a
 * tab that scrolls to nothing is worse than a shorter nav. Every other section
 * here is always present.
 */
export function HotelSectionNav({
  hasKosher = false,
  hasAmenities = true,
}: {
  hasKosher?: boolean;
  hasAmenities?: boolean;
}) {
  const { t } = useI18n();

  // Between Facilities and Location: the kosher block is a facility section,
  // and it reads out of place after the map.
  //
  // Memoised because the observer effect below depends on it, and a fresh array
  // every render would tear down and rebuild every IntersectionObserver on each
  // scroll-driven state change.
  const sections = useMemo(
    () =>
      (hasKosher
        ? [
            ...baseSections.slice(0, 2),
            { id: "kosher", label: t.hotels.kosher.navLabel },
            ...baseSections.slice(2),
          ]
        : baseSections
      ).filter((section) => hasAmenities || section.id !== "amenities"),
    [hasKosher, hasAmenities, t.hotels.kosher.navLabel],
  );

  const [active, setActive] = useState(sections[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Bias the band towards the top of the viewport, under the sticky chrome.
      { rootMargin: "-140px 0px -60% 0px", threshold: 0 },
    );

    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
    // Re-observed when the section list changes, which it does only when the
    // page's optional anchors differ from the defaults.
  }, [sections]);

  return (
    <nav
      aria-label="Property sections"
      className="sticky top-18 z-30 -mx-5 border-b border-line bg-background/90 backdrop-blur-md sm:-mx-8 lg:top-20 lg:-mx-12"
    >
      {/* Bleeds to the container's edges at every size, matching its padding
          (`Container`: px-5 / sm:px-8 / lg:px-12). */}
      <ul className="scrollbar-none flex gap-1 overflow-x-auto px-5 sm:px-8 lg:px-12">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              className={cn(
                "relative inline-flex h-13 items-center px-4 text-[0.8125rem] font-medium whitespace-nowrap transition-colors",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-0 after:bg-brand after:transition-transform after:duration-300 after:ease-(--ease-out-soft)",
                active === section.id
                  ? "text-ink after:scale-x-100"
                  : "text-muted hover:text-ink",
              )}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
