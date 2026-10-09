import type { AuditQuery, GlobalAuditEntry } from "@/lib/api/audit";
import { STAFF_ROLES } from "@/types/user";

/**
 * Display vocabulary for the audit trail as a whole.
 *
 * The partner page has its own, shorter labels in `lib/admin/partners.ts` —
 * "Approved" reads fine under a partner's name, but in a list of everything
 * that happened it has to say *what* was approved. So the two maps stay
 * separate on purpose.
 *
 * Actions are listed in groups, and the flat label map is derived from the
 * groups, so an action cannot have a label without also appearing in the
 * filter, or the other way round. The list mirrors `enum AuditAction` in
 * `server/prisma/schema.prisma`; an action added there and not here still
 * reads as words through `auditActionLabel`'s fallback.
 */

export interface AuditActionGroup {
  label: string;
  actions: [action: string, label: string][];
}

export const AUDIT_ACTION_GROUPS: AuditActionGroup[] = [
  {
    label: "Sign-ins and accounts",
    actions: [
      ["USER_LOGIN_SUCCEEDED", "Signed in"],
      ["USER_LOGIN_FAILED", "Failed sign-in"],
      ["USER_LOGGED_OUT", "Signed out"],
      ["USER_SESSIONS_REVOKED", "Signed out everywhere"],
      ["USER_INVITED", "Person invited"],
      ["USER_ACTIVATED", "Account activated"],
      ["USER_PROFILE_UPDATED", "Profile updated"],
      ["USER_PASSWORD_CHANGED", "Password changed"],
      ["USER_ROLE_CHANGED", "Role changed"],
      ["USER_DEACTIVATED", "Account deactivated"],
      ["USER_REACTIVATED", "Account reactivated"],
      ["USER_DELETED", "Account deleted"],
      ["USER_PRIMARY_CONTACT_CHANGED", "Primary contact changed"],
    ],
  },
  {
    label: "Partners",
    actions: [
      ["PARTNER_INVITED", "Partner invited"],
      ["PARTNER_CREATED", "Partner created"],
      ["PARTNER_UPDATED", "Partner details edited"],
      ["PARTNER_REGISTRATION_SUBMITTED", "Partner application submitted"],
      ["PARTNER_APPROVED", "Partner approved"],
      ["PARTNER_REJECTED", "Partner rejected"],
      ["PARTNER_SUSPENDED", "Partner suspended"],
      ["PARTNER_REACTIVATED", "Partner reinstated"],
      ["PARTNER_DELETED", "Partner deleted"],
      ["PARTNER_FINANCIAL_VIEWED", "Bank details viewed"],
      ["PARTNER_FINANCIAL_UPDATED", "Bank details updated"],
      ["INVITATION_RESENT", "Invitation resent"],
      ["INVITATION_REVOKED", "Invitation withdrawn"],
    ],
  },
  {
    label: "Hotels",
    actions: [
      ["HOTEL_CREATED", "Hotel created"],
      ["HOTEL_UPDATED", "Hotel edited"],
      ["HOTEL_PUBLISHED", "Hotel published"],
      ["HOTEL_UNPUBLISHED", "Hotel unpublished"],
      ["HOTEL_ARCHIVED", "Hotel archived"],
      ["HOTEL_DELETED", "Hotel deleted"],
      ["AMENITY_CREATED", "Amenity created"],
      ["AMENITY_UPDATED", "Amenity edited"],
      ["ROOM_TYPE_CREATED", "Room type created"],
      ["ROOM_TYPE_UPDATED", "Room type edited"],
      ["ROOM_TYPE_ARCHIVED", "Room type archived"],
      ["CHILD_POLICY_UPDATED", "Child policy updated"],
      ["RATE_PLAN_CREATED", "Rate plan created"],
      ["RATE_PLAN_UPDATED", "Rate plan edited"],
      ["RATE_PLAN_ARCHIVED", "Rate plan archived"],
      ["CANCELLATION_POLICY_CREATED", "Cancellation policy created"],
      ["CANCELLATION_POLICY_UPDATED", "Cancellation policy edited"],
      ["PAYMENT_POLICY_CREATED", "Payment policy created"],
      ["PAYMENT_POLICY_UPDATED", "Payment policy edited"],
      ["HOTEL_MEAL_PLAN_UPDATED", "Meal plans updated"],
      ["INVENTORY_UPDATED", "Room availability updated"],
      ["RATE_UPDATED", "Room prices updated"],
      ["TAX_FEE_UPDATED", "Taxes and fees updated"],
      ["HOTEL_DOCUMENT_UPLOADED", "Hotel document uploaded"],
      ["HOTEL_DOCUMENT_DELETED", "Hotel document deleted"],
    ],
  },
  {
    label: "Kosher",
    actions: [
      ["HOTEL_KOSHER_ENABLED", "Kosher switched on"],
      ["HOTEL_KOSHER_UPDATED", "Kosher details edited"],
      ["HOTEL_KOSHER_DISABLED", "Kosher switched off"],
      ["KOSHER_CERTIFICATION_ADDED", "Kosher certificate added"],
      ["KOSHER_CERTIFICATION_UPDATED", "Kosher certificate edited"],
      ["KOSHER_CERTIFICATION_VERIFIED", "Kosher certificate verified"],
      ["KOSHER_CERTIFICATION_ARCHIVED", "Kosher certificate archived"],
      ["KOSHER_CERTIFICATION_EXPIRING", "Kosher certificate expiring"],
      ["KOSHER_SUPPLIER_UPDATE_HELD", "Supplier kosher change held"],
    ],
  },
  {
    label: "Hotel bookings",
    actions: [
      ["BOOKING_CREATED", "Hotel booking made"],
      ["BOOKING_AMENDED", "Hotel booking amended"],
      ["BOOKING_CANCELLED", "Hotel booking cancelled"],
      ["BOOKING_COMPLETED", "Hotel booking completed"],
      ["BOOKING_REQUEST_ANSWERED", "Booking request answered"],
      ["HOLD_EXPIRED", "Room hold expired"],
      ["INVENTORY_RECONCILED", "Room availability reconciled"],
    ],
  },
  {
    label: "Pricing rules",
    actions: [
      ["PRICING_RULE_CREATED", "Pricing rule created"],
      ["PRICING_RULE_UPDATED", "Pricing rule edited"],
      ["PRICING_RULE_DELETED", "Pricing rule deleted"],
    ],
  },
  {
    label: "Transfer catalogue",
    actions: [
      ["TRANSFER_POINT_CREATED", "Pick-up point created"],
      ["TRANSFER_POINT_UPDATED", "Pick-up point edited"],
      ["TRANSFER_POINT_DELETED", "Pick-up point deleted"],
      ["TRANSFER_PROVIDER_CREATED", "Transfer provider created"],
      ["TRANSFER_PROVIDER_UPDATED", "Transfer provider edited"],
      ["TRANSFER_VEHICLE_CREATED", "Vehicle class created"],
      ["TRANSFER_VEHICLE_UPDATED", "Vehicle class edited"],
      ["TRANSFER_VEHICLE_ARCHIVED", "Vehicle class archived"],
      ["TRANSFER_ROUTE_CREATED", "Route created"],
      ["TRANSFER_ROUTE_UPDATED", "Route edited"],
      ["TRANSFER_ROUTE_PUBLISHED", "Route published"],
      ["TRANSFER_ROUTE_UNPUBLISHED", "Route unpublished"],
      ["TRANSFER_ROUTE_ARCHIVED", "Route archived"],
      ["TRANSFER_ROUTE_PRICED", "Route prices set"],
      ["TRANSFER_EXTRA_UPDATED", "Transfer extra edited"],
      ["TRANSFER_BLACKOUT_CREATED", "Blackout date added"],
      ["TRANSFER_BLACKOUT_DELETED", "Blackout date removed"],
    ],
  },
  {
    label: "Transfer bookings and dispatch",
    actions: [
      ["TRANSFER_BOOKING_CREATED", "Transfer booked"],
      ["TRANSFER_BOOKING_AMENDED", "Transfer amended"],
      ["TRANSFER_BOOKING_CANCELLED", "Transfer cancelled"],
      ["TRANSFER_BOOKING_COMPLETED", "Transfer completed"],
      ["TRANSFER_BOOKING_NO_SHOW", "Transfer marked no-show"],
      ["TRANSFER_ASSIGNMENT_CREATED", "Driver assigned"],
      ["TRANSFER_ASSIGNMENT_ACCEPTED", "Driver accepted a job"],
      ["TRANSFER_ASSIGNMENT_DECLINED", "Driver declined a job"],
      ["TRANSFER_ASSIGNMENT_REVOKED", "Driver assignment withdrawn"],
      ["TRANSFER_LEG_STATUS_CHANGED", "Trip status changed"],
      ["TRANSFER_LEG_CANCELLED", "Trip leg cancelled"],
      ["TRANSFER_PICKUP_REMINDER_SENT", "Pick-up reminder sent"],
      ["TRANSFER_RATING_SUBMITTED", "Driver rated"],
      ["TRANSFER_RATING_MODERATED", "Rating moderated"],
    ],
  },
  {
    label: "Fleet and drivers",
    actions: [
      ["TRANSFER_FLEET_VEHICLE_CREATED", "Car added"],
      ["TRANSFER_FLEET_VEHICLE_UPDATED", "Car edited"],
      ["TRANSFER_FLEET_VEHICLE_ARCHIVED", "Car archived"],
      ["TRANSFER_FLEET_VEHICLE_DELETED", "Car deleted"],
      ["TRANSFER_VEHICLE_DOCUMENT_UPLOADED", "Car document uploaded"],
      ["TRANSFER_VEHICLE_DOCUMENT_DELETED", "Car document deleted"],
      ["TRANSFER_DRIVER_CREATED", "Driver added"],
      ["TRANSFER_DRIVER_UPDATED", "Driver edited"],
      ["TRANSFER_DRIVER_VERIFIED", "Driver verified"],
      ["TRANSFER_DRIVER_DEACTIVATED", "Driver deactivated"],
      ["TRANSFER_DRIVER_REACTIVATED", "Driver reactivated"],
      ["TRANSFER_DRIVER_DELETED", "Driver deleted"],
      ["TRANSFER_DRIVER_DOCUMENT_UPLOADED", "Driver document uploaded"],
      ["TRANSFER_DRIVER_DOCUMENT_DELETED", "Driver document deleted"],
      ["DRIVER_ACCOUNT_CREATED", "Driver sign-in created"],
      ["TRANSFER_BLOCK_CREATED", "Schedule block added"],
      ["TRANSFER_BLOCK_DELETED", "Schedule block removed"],
    ],
  },
  {
    label: "Tours",
    actions: [
      ["TOUR_CREATED", "Tour created"],
      ["TOUR_UPDATED", "Tour edited"],
      ["TOUR_PUBLISHED", "Tour published"],
      ["TOUR_UNPUBLISHED", "Tour unpublished"],
      ["TOUR_ARCHIVED", "Tour archived"],
      ["TOUR_DELETED", "Tour deleted"],
      ["TOUR_OPTION_CREATED", "Tour option created"],
      ["TOUR_OPTION_UPDATED", "Tour option edited"],
      ["TOUR_OPTION_ARCHIVED", "Tour option archived"],
      ["TOUR_SEASON_UPDATED", "Tour season edited"],
      ["TOUR_SEASON_DELETED", "Tour season deleted"],
      ["TOUR_INVENTORY_UPDATED", "Departures updated"],
      ["TOUR_INVENTORY_RECONCILED", "Departures reconciled"],
    ],
  },
  {
    label: "Tour bookings",
    actions: [
      ["TOUR_BOOKING_CREATED", "Tour booking made"],
      ["TOUR_BOOKING_CONFIRMED", "Tour booking confirmed"],
      ["TOUR_BOOKING_DECLINED", "Tour booking declined"],
      ["TOUR_BOOKING_AMENDED", "Tour booking amended"],
      ["TOUR_BOOKING_CANCELLED", "Tour booking cancelled"],
      ["TOUR_BOOKING_COMPLETED", "Tour booking completed"],
      ["TOUR_HOLD_EXPIRED", "Tour hold expired"],
    ],
  },
  {
    label: "Services",
    actions: [
      ["SERVICE_CREATED", "Service created"],
      ["SERVICE_UPDATED", "Service edited"],
      ["SERVICE_PUBLISHED", "Service published"],
      ["SERVICE_UNPUBLISHED", "Service unpublished"],
      ["SERVICE_ARCHIVED", "Service archived"],
      ["SERVICE_DELETED", "Service deleted"],
      ["SERVICE_BOOKING_CREATED", "Service booking made"],
      ["SERVICE_BOOKING_CONFIRMED", "Service booking confirmed"],
      ["SERVICE_BOOKING_DECLINED", "Service booking declined"],
      ["SERVICE_BOOKING_CANCELLED", "Service booking cancelled"],
      ["SERVICE_BOOKING_COMPLETED", "Service booking completed"],
    ],
  },
  {
    label: "Packages",
    actions: [
      ["PACKAGE_CREATED", "Package created"],
      ["PACKAGE_UPDATED", "Package edited"],
      ["PACKAGE_PUBLISHED", "Package published"],
      ["PACKAGE_UNPUBLISHED", "Package unpublished"],
      ["PACKAGE_ARCHIVED", "Package archived"],
      ["PACKAGE_DELETED", "Package deleted"],
      ["PACKAGE_KOSHER_OVERRIDDEN", "Package kosher status overridden"],
    ],
  },
  {
    label: "Orders",
    actions: [
      ["ORDER_CREATED", "Order placed"],
      ["ORDER_CONFIRMED", "Order confirmed"],
      ["ORDER_AMENDED", "Order amended"],
      ["ORDER_CANCELLED", "Order cancelled"],
      ["ORDER_COMPLETED", "Order completed"],
      ["ORDER_ITEM_CONFIRMED", "Order item confirmed"],
      ["ORDER_ITEM_DECLINED", "Order item declined"],
      ["ORDER_ITEM_CANCELLED", "Order item cancelled"],
    ],
  },
  {
    label: "Destinations and files",
    actions: [
      ["DESTINATION_CREATED", "Destination created"],
      ["DESTINATION_UPDATED", "Destination edited"],
      ["DESTINATION_DELETED", "Destination deleted"],
      ["MEDIA_UPLOADED", "File uploaded"],
      ["MEDIA_DELETED", "File deleted"],
      ["PRIVATE_FILE_ACCESSED", "Private file opened"],
    ],
  },
];

export const auditActionLabels: Record<string, string> = Object.fromEntries(
  AUDIT_ACTION_GROUPS.flatMap((group) => group.actions),
);

const AUDIT_ACTIONS = new Set(Object.keys(auditActionLabels));

/** `TOUR_OPTION_CREATED` → "Tour option created", for anything not in the map. */
export function humanizeConstant(value: string): string {
  const words = value.toLowerCase().split("_").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function auditActionLabel(action: string): string {
  return auditActionLabels[action] ?? humanizeConstant(action);
}

/**
 * What a row is about, in words. Keys are the strings the server writes in
 * `entityType` (`AUDIT_ENTITY` in `server/lib/audit.js`).
 */
export const auditEntityLabels: Record<string, string> = {
  User: "Person",
  Partner: "Partner",
  Invitation: "Invitation",
  Destination: "Destination",
  Hotel: "Hotel",
  RoomType: "Room type",
  RatePlan: "Rate plan",
  Amenity: "Amenity",
  HotelKosherCertification: "Kosher certificate",
  HotelDocument: "Hotel document",
  HotelBooking: "Hotel booking",
  HotelBookingRequest: "Booking request",
  PricingRule: "Pricing rule",
  FileAsset: "File",
  TransferPoint: "Pick-up point",
  TransferProvider: "Transfer provider",
  TransferVehicle: "Vehicle class",
  TransferRoute: "Transfer route",
  TransferExtra: "Transfer extra",
  TransferBlackout: "Transfer blackout",
  TransferBooking: "Transfer booking",
  TransferBookingLeg: "Transfer leg",
  TransferFleetVehicle: "Car",
  TransferDriver: "Driver",
  TransferAssignment: "Driver assignment",
  TransferResourceBlock: "Schedule block",
  TransferDriverRating: "Driver rating",
  Tour: "Tour",
  TourOption: "Tour option",
  TourSeason: "Tour season",
  TourBooking: "Tour booking",
  Service: "Service",
  ServiceBooking: "Service booking",
  Package: "Package",
  Order: "Order",
  OrderItem: "Order item",
};

/** For the filter: sorted by label, since nobody thinks of these in schema order. */
export const AUDIT_ENTITY_TYPES = Object.keys(auditEntityLabels).sort((a, b) =>
  auditEntityLabels[a].localeCompare(auditEntityLabels[b]),
);

/** `TransferResourceBlock` → "Transfer resource block", for a type the map does not know. */
export function auditEntityLabel(entityType: string): string {
  return (
    auditEntityLabels[entityType] ??
    humanizeConstant(entityType.replace(/([a-z0-9])([A-Z])/g, "$1_$2"))
  );
}

/**
 * Where a row's subject lives in the panel, or null when nowhere a link would
 * reliably land.
 *
 * Only targets whose route accepts the id the trail stores are listed. The
 * hotel, tour and package screens are addressed by slug in the URL but the
 * server resolves either, and the hotel and tour booking screens take the id
 * as readily as the reference. Orders and transfer bookings resolve by
 * reference alone, so they link only when the row's metadata carries one.
 * Each target names the capability its sidebar item asks for, so a viewer is
 * never handed a link that would bounce them.
 *
 * A person links to the staff screen only when the row shows they are staff:
 * that screen reads platform accounts, and a partner's user would 404 there.
 */
const ENTITY_TARGETS: Record<string, { href: (id: string) => string; capability: string[] }> = {
  Partner: { href: (id) => `/admin/partners/${id}`, capability: ["partners.read"] },
  Hotel: { href: (id) => `/admin/hotels/${id}`, capability: ["catalogue.write", "bookings.read"] },
  Destination: { href: (id) => `/admin/destinations/${id}`, capability: ["catalogue.write", "bookings.read"] },
  Tour: { href: (id) => `/admin/tours/${id}`, capability: ["catalogue.write", "bookings.read"] },
  Package: { href: (id) => `/admin/packages/${id}`, capability: ["catalogue.write", "bookings.read"] },
  Service: { href: (id) => `/admin/services/${id}`, capability: ["catalogue.write", "bookings.read"] },
  TransferPoint: { href: (id) => `/admin/transfers/points/${id}`, capability: ["catalogue.write", "bookings.read"] },
  TransferRoute: { href: (id) => `/admin/transfers/routes/${id}`, capability: ["catalogue.write", "bookings.read"] },
  TransferVehicle: { href: (id) => `/admin/transfers/vehicles/${id}`, capability: ["catalogue.write", "bookings.read"] },
  TransferFleetVehicle: { href: (id) => `/admin/transfers/fleet/${id}`, capability: ["dispatch.read"] },
  TransferDriver: { href: (id) => `/admin/transfers/drivers/${id}`, capability: ["dispatch.read"] },
  HotelBooking: { href: (id) => `/admin/bookings/${id}`, capability: ["bookings.read"] },
  TourBooking: { href: (id) => `/admin/tours/bookings/${id}`, capability: ["bookings.read"] },
};

const BY_REFERENCE: Record<string, { href: (reference: string) => string; capability: string[] }> = {
  Order: { href: (reference) => `/admin/orders/${reference}`, capability: ["bookings.read"] },
  TransferBooking: { href: (reference) => `/admin/transfers/bookings/${reference}`, capability: ["bookings.read"] },
};

/** Removed subjects have nothing left to open. */
const GONE = /_DELETED$/;

const isStaffRole = (role: unknown): boolean =>
  typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);

export function auditEntityHref(
  entry: Pick<GlobalAuditEntry, "action" | "entityType" | "entityId" | "metadata" | "actor">,
  capabilities: readonly string[],
): string | null {
  if (GONE.test(entry.action)) return null;

  const holds = (needed: string[]) => needed.some((capability) => capabilities.includes(capability));
  const id = encodeURIComponent(entry.entityId);

  const direct = ENTITY_TARGETS[entry.entityType];
  if (direct) return holds(direct.capability) ? direct.href(id) : null;

  const byReference = BY_REFERENCE[entry.entityType];
  if (byReference) {
    const reference = entry.metadata?.reference;
    if (typeof reference !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(reference)) return null;
    return holds(byReference.capability) ? byReference.href(reference) : null;
  }

  if (entry.entityType === "User" && holds(["users.staff.manage"])) {
    const metadata = entry.metadata ?? {};
    const staff =
      (entry.actor?.id === entry.entityId && isStaffRole(entry.actor.role)) ||
      (isStaffRole(metadata.role) && !metadata.partnerId) ||
      isStaffRole(metadata.to);
    return staff ? `/admin/users/${id}` : null;
  }

  return null;
}

/**
 * The trail is read in Tbilisi time.
 *
 * Every operator works there, and one fixed zone means the server render and
 * the browser agree on every timestamp — formatting in "whatever zone the
 * process happens to run in" would print UTC on the host and local time in
 * the browser. Georgia has kept UTC+4 without daylight saving since 2005,
 * which is what lets a calendar day become a pair of instants below without
 * a time-zone database.
 */
export const AUDIT_TIME_ZONE = "Asia/Tbilisi";
const TBILISI_OFFSET = "+04:00";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: AUDIT_TIME_ZONE,
});
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: AUDIT_TIME_ZONE,
});

/** "8 Oct 2026" and "14:32:05", Tbilisi time. */
export function formatAuditTime(value: string): { date: string; time: string } {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: value, time: "" };
  return { date: DATE.format(parsed), time: TIME.format(parsed) };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that is a real calendar day, or undefined. */
function calendarDay(value: string | undefined): string | undefined {
  if (!value || !DAY.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : undefined;
}

/** First and last instant of a Tbilisi calendar day, as UTC ISO strings. */
const startOfDay = (day: string) => new Date(`${day}T00:00:00.000${TBILISI_OFFSET}`).toISOString();
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999${TBILISI_OFFSET}`).toISOString();

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENTITY_TYPE = /^[A-Za-z]{1,64}$/;

export const AUDIT_PAGE_SIZE = 50;

/**
 * Reads filter state out of the URL.
 *
 * The URL keeps dates as plain days (`from=2026-10-01`) so it stays readable
 * and the date inputs can show it back; they become instants only here. Like
 * `partnerQueryFromParams`, anything unrecognised is dropped rather than sent:
 * the server answers 400 to an unknown action or a backwards range, and a
 * hand-edited URL should show the whole trail rather than an error page.
 */
export function auditQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): AuditQuery {
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const action = single(params.action);
  const entityType = single(params.entityType);
  const entityId = single(params.entityId);
  const actorUserId = single(params.actor);
  const page = Number(single(params.page));

  let from = calendarDay(single(params.from));
  let to = calendarDay(single(params.to));
  // A range typed backwards is still a range. Plain-day strings compare in
  // calendar order, so swapping is all it takes.
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q: single(params.q)?.trim().slice(0, 120) || undefined,
    action: action && AUDIT_ACTIONS.has(action) ? action : undefined,
    entityType: entityType && ENTITY_TYPE.test(entityType) ? entityType : undefined,
    entityId: entityId && ID.test(entityId) ? entityId : undefined,
    actorUserId: actorUserId && ID.test(actorUserId) ? actorUserId : undefined,
    from: from ? startOfDay(from) : undefined,
    to: to ? endOfDay(to) : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: AUDIT_PAGE_SIZE,
  };
}
