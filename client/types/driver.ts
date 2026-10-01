import type { ImageAsset } from "./catalogue";
import type { PlacedLocation } from "./geo";
import type {
  TransferAssignmentStatus,
  TransferLegDirection,
  TransferLegStatus,
  TransferStatus,
  TransferVehicleBody,
  TransferVehicleClass,
} from "./transfer";

/**
 * Drivers and fleet cars, mirroring `server/serializers/driver.js` and
 * `server/serializers/fleet.js`.
 *
 * The three driver shapes are allow-lists on the server. What a partner sees
 * (`DriverPublic`) never carries a licence, a date of birth or a document;
 * `phone` is present only once the pick-up is close enough for the server to
 * reveal it, so it is optional here rather than nullable.
 */

export type DriverVerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export type FleetVehicleFeature =
  | "airConditioning"
  | "wifi"
  | "childSeat"
  | "englishDriver"
  | "meetGreet"
  | "flightTracking"
  | "bottledWater"
  | "freeWaiting"
  | "wheelchairAccessible";

/** A car as a partner or passenger may see it once assigned. */
export interface FleetVehiclePublic {
  id: string;
  make: string;
  model: string;
  year: number | null;
  colour: string | null;
  body: TransferVehicleBody;
  plateNumber: string;
  passengerCapacity: number;
  luggageCapacity: number;
  cabinBagCapacity: number;
  features: FleetVehicleFeature[];
  description: string | null;
  mainImage: ImageAsset | null;
}

export interface DriverPublic {
  id: string;
  firstName: string;
  /** The full surname for a partner; the initial only for a passenger. */
  lastName: string | null;
  photo: ImageAsset | null;
  languages: string[];
  yearsExperience: number;
  bio: string | null;
  verified: boolean;
  ratingAvg: number;
  ratingCount: number;
  completedCount: number;
  /** Present only from the contact-reveal time before pick-up. */
  phone?: string;
}

/** The driver's own view, as returned in `Session.driver`. */
export interface DriverSelf extends DriverPublic {
  phone: string;
  email: string | null;
  provider: { id: string; name: string } | null;
  verificationStatus: DriverVerificationStatus;
  isActive: boolean;
  licenceExpiresOn: string | null;
  homeBasePoint: { id: string; slug: string; name: string } | null;
  vehicles: Array<FleetVehiclePublic & { isPrimary: boolean }>;
}

export type DriverLanguage =
  | "ka" | "en" | "ru" | "he" | "tr" | "de" | "fr" | "es" | "it" | "ar" | "hy" | "az" | "uk" | "pl" | "zh" | "ja";

export type DriverDocumentType = "DRIVING_LICENCE" | "ID_DOCUMENT" | "MEDICAL" | "BACKGROUND_CHECK" | "OTHER";
export type VehicleDocumentType = "REGISTRATION" | "INSURANCE" | "TECHNICAL_INSPECTION" | "OTHER";

/** A person as the admin panel shows them beside a record. Mirrors `toContact`. */
export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  position: string | null;
  phone: string | null;
  email: string;
  role: string;
  isPrimaryContact: boolean;
  isActive: boolean;
  /** True until they have set a password through their link. */
  isPending: boolean;
}

/** A private document's facts. Never its bytes: those come from a signed link. */
export interface AttachedDocument {
  id: string;
  docType: string;
  label: string | null;
  validUntil: string | null;
  fileAssetId: string;
  file: {
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    category: string;
  } | null;
  uploadedBy: { id: string; email: string; fullName: string } | null;
  createdAt: string;
}

export interface FleetImage extends ImageAsset {
  imageId: string;
  caption: string | null;
  sortOrder: number;
  isCover: boolean;
}

/** The operations view of a car. */
export interface FleetVehicleAdmin extends FleetVehiclePublic {
  images: FleetImage[];
  vin: string | null;
  internalNotes: string | null;
  status: TransferStatus;
  provider: { id: string; slug: string; name: string } | null;
  vehicleClass: { id: string; slug: string; name: string; vehicleClass: TransferVehicleClass } | null;
  drivers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    verified: boolean;
    isPrimary: boolean;
  }>;
  documents: AttachedDocument[];
  createdAt: string;
  updatedAt: string;
}

/** The operations view of a driver: everything, documents' facts included. */
export interface DriverAdmin extends DriverSelf {
  lastName: string;
  licenceNumber: string | null;
  dateOfBirth: string | null;
  internalNotes: string | null;
  verifiedAt: string | null;
  verifiedBy: Contact | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  user: Contact | null;
  documents: AttachedDocument[];
  provider: { id: string; slug: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

// --- Dispatch ---------------------------------------------------------------


export interface AssignmentMilestones {
  acceptedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
  noShowReportedAt: string | null;
}

/** The operations view of one offer. Mirrors `toAssignmentAdmin`. */
export interface AssignmentAdmin {
  id: string;
  legId: string;
  bookingId: string;
  status: TransferAssignmentStatus;
  driver: DriverPublic & { phone: string };
  vehicle: FleetVehiclePublic | null;
  windowStart: string;
  windowEnd: string;
  preBufferMinutes: number;
  postBufferMinutes: number;
  assignedAt: string;
  assignedBy: { id: string; email: string; fullName: string } | null;
  overrides: string[];
  declinedAt: string | null;
  declineReason: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  supersededByAssignmentId: string | null;
  milestones: AssignmentMilestones;
  driverNotes: string | null;
  dispatcherNotes: string | null;
  createdAt: string;
}

/**
 * What a partner or passenger sees once the driver has accepted — or, for the
 * driver a partner asked for at checkout, while the offer still waits.
 * Mirrors `toAssignmentForPartner`.
 */
export interface AssignmentForPartner {
  status: TransferAssignmentStatus;
  /** True while the requested driver has not yet said yes. */
  awaitingDriver: boolean;
  driver: DriverPublic;
  vehicle: FleetVehiclePublic | null;
  milestones: Pick<AssignmentMilestones, "enRouteAt" | "arrivedAt" | "pickedUpAt" | "completedAt">;
  etaAvailable: boolean;
}

/** The job as a leg describes it, shared by every audience. */
export interface LegJob {
  id: string;
  legIndex: number;
  direction: TransferLegDirection;
  from: string;
  to: string;
  fromKind: string | null;
  timezone: string;
  pickupAt: string;
  distanceKm: number;
  durationMinutes: number;
  status: TransferLegStatus;
  statusChangedAt: string;
}

/** The passenger block: what a driver needs and nothing about money. */
export interface PassengerBlock {
  reference: string;
  bookingStatus: string;
  tripType: string;
  adults: number;
  children: number;
  childAges: number[];
  passengers: number;
  luggage: number;
  cabinBags: number;
  leadPassengerName: string;
  leadPassengerPhone: string | null;
  flightNumber: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  /** Coordinates for the navigation app; the text above is what to read out. */
  pickupPlace: PlacedLocation | null;
  dropoffPlace: PlacedLocation | null;
  specialRequests: string | null;
  vehicleClassName: string | null;
  extras: Array<{ code: string; name: string; quantity: number }>;
}

/** A row on the dispatch board. Mirrors `toLegAdmin`. */
export interface DispatchLeg extends LegJob {
  booking: PassengerBlock & {
    leadPassengerEmail: string;
    partner: { id: string; reference: string; name: string } | null;
    vehicleClassId: string;
  };
  assignment: AssignmentAdmin | null;
  allowedTransitions: TransferLegStatus[];
}

export interface AssignmentHistoryRow extends AssignmentAdmin {
  leg:
    | (LegJob & {
        booking: { reference: string; bookingStatus: string; leadPassengerName: string; passengers: number };
      })
    | null;
}

/** The driver's own view of a job. Mirrors `toAssignmentForDriver`. */
export interface DriverAssignment {
  id: string;
  status: TransferAssignmentStatus;
  leg: LegJob;
  booking: PassengerBlock;
  vehicle: FleetVehiclePublic | null;
  windowStart: string;
  windowEnd: string;
  assignedAt: string;
  milestones: AssignmentMilestones;
  driverNotes: string | null;
  dispatcherNotes: string | null;
  allowedTransitions: TransferLegStatus[];
  canAccept: boolean;
  canDecline: boolean;
}

export interface ScheduleConflict {
  resourceType: "DRIVER" | "VEHICLE";
  resourceId: string;
  sourceKind: "ASSIGNMENT" | "BLOCK";
  sourceId: string;
  status: string | null;
  bookingReference: string | null;
  windowStart: string;
  windowEnd: string;
}

export interface OccupancyRow extends ScheduleConflict {
  leadPassengerName: string | null;
}

export interface DispatchCandidate {
  driver: DriverPublic & { phone: string };
  provider: { id: string; name: string } | null;
  verified: boolean;
  vehicles: Array<
    FleetVehiclePublic & {
      isPrimary: boolean;
      classMatches: boolean;
      fitsParty: boolean;
      conflicts: ScheduleConflict[];
    }
  >;
  conflicts: ScheduleConflict[];
  warnings: string[];
  suggestedVehicleId: string | null;
}

export type BlockReason = "DAY_OFF" | "SICK" | "MAINTENANCE" | "OTHER";

export interface ResourceBlock {
  id: string;
  driver: { id: string; firstName: string; lastName: string } | null;
  vehicle: { id: string; make: string; model: string; plateNumber: string } | null;
  startsAt: string;
  endsAt: string;
  reason: BlockReason;
  note: string | null;
  createdBy: { id: string; email: string } | null;
  createdAt: string;
}

// --- Ratings ----------------------------------------------------------------

export type RatingStatus = "PENDING" | "PUBLISHED" | "REJECTED";
export type RatingSource = "GUEST" | "PARTNER" | "ADMIN";

/** What the person who left it, or a partner reading a profile, sees. */
export interface RatingPublic {
  id: string;
  score: number;
  /** Only once published. */
  comment: string | null;
  status: RatingStatus;
  source: RatingSource;
  createdAt: string;
}

export interface RatingAdmin extends RatingPublic {
  driver: { id: string; firstName: string; lastName: string } | null;
  booking: { id: string; reference: string } | null;
  leg: { id: string; legIndex: number; pickupAt: string; from: string; to: string } | null;
  submittedBy: { id: string; email: string; fullName: string } | null;
  submittedByEmail: string | null;
  moderatedAt: string | null;
  moderatedBy: { id: string; email: string; fullName: string } | null;
  moderationNote: string | null;
}

/** `GET /api/partner/drivers/:id` — the public profile plus cars and published reviews. */
export interface DriverProfileForPartner extends DriverPublic {
  vehicles: Array<FleetVehiclePublic & { isPrimary: boolean; images?: FleetImage[] }>;
  reviews: RatingPublic[];
}

/** A driver a partner may ask for at checkout, with the cars they could come in. Mirrors `toAvailableDriver`. */
export interface AvailableDriver extends DriverPublic {
  lastName: string;
  provider: { id: string; name: string } | null;
  cars: Array<FleetVehiclePublic & { isPrimary: boolean; images: FleetImage[] }>;
}

/** `POST /api/partner/drivers/available` — who is free for the journey a quote token describes. */
export interface AvailableDrivers {
  vehicleClass: { id: string; slug: string; name: string };
  legs: Array<{ direction: TransferLegDirection; pickupAt: string; windowStart: string; windowEnd: string }>;
  drivers: AvailableDriver[];
}

/** What the checkout form sends when a partner has picked someone. */
export interface DriverChoiceValue {
  driverId: string;
  fleetVehicleId: string;
}
