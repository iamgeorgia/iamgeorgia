import { bookingFiltersFromParams } from "./bookingFilters";
import type { AdminTransferBookingQuery, TransferRouteQuery } from "@/lib/api/transfers";
import type {
  TransferBookingStatus,
  TransferExtraBasis,
  TransferFeature,
  TransferKind,
  TransferPointKind,
  TransferRouteCategory,
  TransferRouteTier,
  TransferVehicleBody,
  TransferVehicleClass,
} from "@/types/transfer";

/**
 * Reading the transfer panel's filters out of a URL.
 *
 * The same contract as `lib/admin/hotels.ts`: the browser writes a query
 * string, the page re-renders on the server, and nothing scales with how many
 * routes exist. Unknown values are dropped rather than rejected — a
 * hand-edited or stale URL should show an unfiltered list, not an error.
 */

const TIERS: TransferRouteTier[] = ["TIER_1", "TIER_2", "TIER_3"];
const CATEGORIES: TransferRouteCategory[] = [
  "AIRPORT",
  "CITY",
  "RESORT",
  "TOURIST_ROUTE",
  "COMBINED",
];

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const TRANSFER_BOOKING_STATUSES: TransferBookingStatus[] = [
  "PENDING_APPROVAL",
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
];

/** The transfer bookings register's query, from its URL: its statuses plus the shared keys. */
export function transferBookingQueryFromParams(params: Params): AdminTransferBookingQuery {
  const { status, ...shared } = bookingFiltersFromParams(params, { statuses: TRANSFER_BOOKING_STATUSES });

  return { ...shared, status, pageSize: 25 };
}

const positiveInt = (value: string | string[] | undefined, fallback: number) => {
  const parsed = Number.parseInt(first(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function transferRouteQueryFromParams(params: Params): TransferRouteQuery {
  const tier = first(params.tier);
  const category = first(params.category);
  const search = first(params.search)?.trim();

  return {
    ...(tier && TIERS.includes(tier as TransferRouteTier)
      ? { tier: tier as TransferRouteTier }
      : {}),
    ...(category && CATEGORIES.includes(category as TransferRouteCategory)
      ? { category: category as TransferRouteCategory }
      : {}),
    ...(search ? { search } : {}),
    page: positiveInt(params.page, 1),
    pageSize: positiveInt(params.pageSize, 25),
  };
}

/** Human labels for the enums, so the panel is not shouting SCREAMING_CASE. */
export const tierLabels: Record<TransferRouteTier, string> = {
  TIER_1: "Tier 1",
  TIER_2: "Tier 2",
  TIER_3: "Tier 3",
};

export const categoryLabels: Record<TransferRouteCategory, string> = {
  AIRPORT: "Airport",
  CITY: "City",
  RESORT: "Resort",
  TOURIST_ROUTE: "Tourist route",
  COMBINED: "Multi-stop",
};

export const tierOptions = TIERS.map((value) => ({ value, label: tierLabels[value] }));
export const categoryOptions = CATEGORIES.map((value) => ({
  value,
  label: categoryLabels[value],
}));

/** Which routes count as ready to sell, for the panel's headline figures. */
export const isPublished = (status?: string) => status === "ACTIVE";

/* --- Catalogue vocabulary -------------------------------------------------
 *
 * The enums the transfer forms offer, written out once. These are the panel's
 * own labels and stay in English: the admin surface is not translated, and a
 * dictionary lookup here would put four locales between an operator and a
 * dropdown for no gain.
 *
 * Each list mirrors an enum in `server/validation/transfer.js`. They are
 * checked against it by `tsc` only in the sense that the value types come from
 * `@/types/transfer` — if a new class is added server-side, the type widens and
 * the `Record` below stops compiling until this list is updated, which is the
 * behaviour worth having.
 */

const POINT_KINDS: TransferPointKind[] = [
  "AIRPORT",
  "CITY",
  "RESORT",
  "HOTEL",
  "LANDMARK",
  "STATION",
];

export const pointKindLabels: Record<TransferPointKind, string> = {
  AIRPORT: "Airport",
  CITY: "City",
  RESORT: "Resort",
  HOTEL: "Hotel",
  LANDMARK: "Landmark",
  STATION: "Station",
};

export const pointKindOptions = POINT_KINDS.map((value) => ({
  value,
  label: pointKindLabels[value],
}));

const VEHICLE_CLASSES: TransferVehicleClass[] = [
  "ECONOMY",
  "COMFORT",
  "MINIVAN",
  "VAN",
  "GROUP",
  "JEEP_4X4",
  "VIP",
];

export const vehicleClassLabels: Record<TransferVehicleClass, string> = {
  ECONOMY: "Economy",
  COMFORT: "Comfort",
  MINIVAN: "Minivan",
  VAN: "Van",
  GROUP: "Group",
  JEEP_4X4: "4x4",
  VIP: "VIP",
};

export const vehicleClassOptions = VEHICLE_CLASSES.map((value) => ({
  value,
  label: vehicleClassLabels[value],
}));

const VEHICLE_BODIES: TransferVehicleBody[] = ["sedan", "suv", "minivan", "van", "bus"];

export const vehicleBodyOptions = VEHICLE_BODIES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

export const transferKindOptions: { value: TransferKind; label: string }[] = [
  { value: "PRIVATE", label: "Private — the whole vehicle" },
  { value: "SHARED", label: "Shared — priced per seat" },
];

export const featureLabels: Record<TransferFeature, string> = {
  airConditioning: "Air conditioning",
  wifi: "Wi-Fi on board",
  childSeat: "Child seat available",
  englishDriver: "English-speaking driver",
  meetGreet: "Meet and greet",
  flightTracking: "Flight tracking",
  bottledWater: "Bottled water",
  freeWaiting: "Free waiting time",
};

export const featureOptions = (Object.keys(featureLabels) as TransferFeature[]).map((value) => ({
  value,
  label: featureLabels[value],
}));

export const extraBasisLabels: Record<TransferExtraBasis, string> = {
  FIXED: "Per booking",
  PER_PASSENGER: "Per passenger",
  PER_HOUR: "Per hour",
  PERCENT: "Share of the fare",
};

export const extraBasisOptions = (Object.keys(extraBasisLabels) as TransferExtraBasis[]).map(
  (value) => ({ value, label: extraBasisLabels[value] }),
);

/**
 * Both now live in `lib/admin/geography.ts`.
 *
 * The destination screens ask for the same slug rule and the same short
 * time-zone list, and a second copy is how two forms end up normalising a
 * slug differently. Re-exported from here so every transfer component that
 * already imports them keeps working.
 */
export { slugify, timezoneOptions } from "./geography";

/** Minutes to the `2h 45m` the panel writes journey times in. */
export const formatDuration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
