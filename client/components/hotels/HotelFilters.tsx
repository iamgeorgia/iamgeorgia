"use client";

import { useState } from "react";

import { FilterChip } from "@/components/ui/FilterChip";
import { featureLabel } from "@/lib/hotels/kosher";
import type { HotelFilterFacets, HotelFilterState } from "@/lib/hotels/filters";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { formatPrice } from "@/lib/utils";

/** Destination chips beyond this are folded behind a "show all". */
const DESTINATIONS_COLLAPSED = 8;

interface HotelFiltersProps {
  value: HotelFilterState;
  onChange: (next: HotelFilterState) => void;
  /** What this catalogue can answer — see `lib/hotels/filters`. */
  facets: HotelFilterFacets;
}

/**
 * Presentational filter panel — rendered in the sidebar and the mobile dialog.
 *
 * Every label comes from the dictionary. It used to hard-code its headings and
 * its chips in English, so a visitor reading the site in Georgian, Russian or
 * Hebrew got a panel in a language they had not asked for, sitting inside a
 * page that was otherwise translated.
 */
export function HotelFilters({ value, onChange, facets }: HotelFiltersProps) {
  const { t, intlLocale } = useI18n();
  const [allDestinations, setAllDestinations] = useState(false);

  const toggle = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];

  const bounds = facets.priceBounds;
  // Several properties at the same rate still need a range with a top and a
  // bottom — a slider whose min equals its max is a control that cannot move.
  const sliderMax = bounds ? Math.max(bounds.max, bounds.min + 10) : 0;
  const current = value.maxPrice ?? sliderMax;

  const visibleDestinations = allDestinations
    ? facets.destinations
    : facets.destinations.slice(0, DESTINATIONS_COLLAPSED);

  return (
    <div className="space-y-8">
      {/*
       * Destination.
       *
       * Multi-select, and scoped to what came back. The search form above picks
       * one destination and narrows the request; this narrows within the
       * answer, and choosing two regions at once is the thing that form cannot
       * do. With a destination already in the URL only that one is in the list,
       * the row has nothing to choose between and is not drawn — so the page
       * never shows two controls for the same idea.
       */}
      {facets.destinations.length > 1 && (
        <fieldset>
          <legend className="type-eyebrow text-muted">{t.hotels.filters.destination}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            {visibleDestinations.map((destination) => (
              <FilterChip
                key={destination.slug}
                selected={value.destinations.includes(destination.slug)}
                onClick={() =>
                  onChange({
                    ...value,
                    destinations: toggle(value.destinations, destination.slug),
                  })
                }
              >
                {destination.name}
              </FilterChip>
            ))}
          </div>
          {facets.destinations.length > DESTINATIONS_COLLAPSED && (
            <button
              type="button"
              onClick={() => setAllDestinations((open) => !open)}
              className="type-caption mt-3 text-brand-text underline-offset-4 hover:underline"
            >
              {allDestinations
                ? t.hotels.filters.showFewer
                : fill(t.hotels.filters.showAll, { count: facets.destinations.length })}
            </button>
          )}
        </fieldset>
      )}

      {facets.propertyTypes.length > 1 && (
        <fieldset>
          <legend className="type-eyebrow text-muted">{t.hotels.filters.propertyType}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            {facets.propertyTypes.map((type) => (
              <FilterChip
                key={type}
                selected={value.propertyTypes.includes(type)}
                onClick={() =>
                  onChange({ ...value, propertyTypes: toggle(value.propertyTypes, type) })
                }
              >
                {t.hotels.propertyTypes[type]}
              </FilterChip>
            ))}
          </div>
        </fieldset>
      )}

      {facets.stars.length > 0 && (
        <fieldset>
          <legend className="type-eyebrow text-muted">{t.hotels.filters.starRating}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterChip
              selected={value.minStars === 0}
              onClick={() => onChange({ ...value, minStars: 0 })}
            >
              {t.hotels.filters.anyStars}
            </FilterChip>
            {facets.stars.map((star) => (
              <FilterChip
                key={star}
                selected={value.minStars === star}
                onClick={() => onChange({ ...value, minStars: star })}
              >
                {/* "5+ stars" would be a lie about a five-point scale. */}
                {star === 5
                  ? t.hotels.filters.starsFive
                  : fill(t.hotels.filters.starsPlus, { count: star })}
              </FilterChip>
            ))}
          </div>
        </fieldset>
      )}

      {facets.scores.length > 0 && (
        <fieldset>
          <legend className="type-eyebrow text-muted">{t.hotels.filters.guestScore}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterChip
              selected={value.minScore === 0}
              onClick={() => onChange({ ...value, minScore: 0 })}
            >
              {t.hotels.filters.anyScore}
            </FilterChip>
            {facets.scores.map((score) => (
              <FilterChip
                key={score}
                selected={value.minScore === score}
                onClick={() => onChange({ ...value, minScore: score })}
              >
                {score >= 9 ? t.hotels.filters.exceptional : t.hotels.filters.veryGood}
              </FilterChip>
            ))}
          </div>
        </fieldset>
      )}

      {bounds && (
        <fieldset>
          <legend className="type-eyebrow text-muted">{t.hotels.filters.nightlyBudget}</legend>
          <label className="mt-4 block">
            <span className="type-body-sm flex items-baseline justify-between gap-3 text-body">
              {t.hotels.filters.upTo}
              <span className="type-h4 tabular-nums">
                {value.maxPrice === null ? t.common.any : formatPrice(value.maxPrice, intlLocale)}
              </span>
            </span>
            <input
              type="range"
              min={bounds.min}
              max={sliderMax}
              step={10}
              value={current}
              onChange={(event) => {
                const next = Number(event.target.value);
                // The top of the range is "any", not "at most the dearest
                // property in the list" — otherwise a slider nobody has touched
                // reads as a filter and counts as one.
                onChange({ ...value, maxPrice: next >= sliderMax ? null : next });
              }}
              className="mt-3 h-1 w-full cursor-pointer appearance-none rounded-full bg-sand accent-brand"
              aria-label={t.a11y.maximumNightlyPrice}
            />
            <span className="type-caption mt-2 flex justify-between text-muted tabular-nums">
              <span>{formatPrice(bounds.min, intlLocale)}</span>
              <span>{formatPrice(sliderMax, intlLocale)}+</span>
            </span>
          </label>
        </fieldset>
      )}

      {facets.amenities.length > 0 && (
        <fieldset>
          <legend className="type-eyebrow text-muted">{t.hotels.filters.facilities}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            {facets.amenities.map((amenity) => (
              <FilterChip
                key={amenity}
                selected={value.amenities.includes(amenity)}
                onClick={() => onChange({ ...value, amenities: toggle(value.amenities, amenity) })}
              >
                {t.hotels.amenityLabels[amenity]}
              </FilterChip>
            ))}
          </div>
        </fieldset>
      )}

      {/*
       * Kosher.
       *
       * Two rows, deliberately. The first pair are claims about the property as
       * a whole and are ordered weakest-first, so "certified" reads as the
       * stronger ask it is. The second row is facilities, which behave exactly
       * like the amenity chips above because that is exactly what they are.
       *
       * Selecting "certified" implies kosher services, so the two are not
       * independent toggles — asking for a certificate and not for kosher
       * services is not a thing anybody means.
       */}
      {facets.offersKosher && (
        <fieldset>
          <legend className="type-eyebrow text-muted">{t.hotels.kosher.filterHeading}</legend>
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterChip
              selected={value.kosherOnly}
              onClick={() =>
                onChange({
                  ...value,
                  kosherOnly: !value.kosherOnly,
                  // Turning the broader filter off cannot leave the narrower one
                  // on, or the panel would show one chip selected and filter by
                  // another.
                  kosherCertified: value.kosherOnly ? false : value.kosherCertified,
                })
              }
            >
              {t.hotels.kosher.filterAnyKosher}
            </FilterChip>
            {facets.offersCertified && (
              <FilterChip
                selected={value.kosherCertified}
                onClick={() =>
                  onChange({
                    ...value,
                    kosherCertified: !value.kosherCertified,
                    kosherOnly: value.kosherCertified ? value.kosherOnly : true,
                  })
                }
              >
                {t.hotels.kosher.filterCertified}
              </FilterChip>
            )}
          </div>

          {facets.kosherFacilities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {facets.kosherFacilities.map((code) => (
                <FilterChip
                  key={code}
                  selected={value.kosherFacilities.includes(code)}
                  onClick={() =>
                    onChange({ ...value, kosherFacilities: toggle(value.kosherFacilities, code) })
                  }
                >
                  {featureLabel(t, code)}
                </FilterChip>
              ))}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
