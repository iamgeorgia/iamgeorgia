import { amenityIcon } from "./amenityIcons";
import type { FacilityView } from "@/lib/hotels/facilities";

interface HotelAmenitiesProps {
  /** Already labelled and deduplicated — see `facilityViews`. */
  facilities: FacilityView[];
}

export function HotelAmenities({ facilities }: HotelAmenitiesProps) {
  return (
    // One column until there is room for two readable labels (~360px): a
    // 320px phone left each label about 80px, less than one Georgian word.
    <ul className="grid grid-cols-1 gap-x-6 gap-y-4 min-[22.5rem]:grid-cols-2 sm:grid-cols-3">
      {facilities.map((facility) => {
        const Icon = amenityIcon(facility.code, facility.icon);
        return (
          <li key={facility.code} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-brand-text">
              <Icon size={16} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="type-body-sm block text-body">{facility.label}</span>
              {/* The property's own words, as the API sent them — "Paid public
                  parking" is the fact a guest is reading for. */}
              {facility.note && (
                <span className="type-caption block text-muted">{facility.note}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
