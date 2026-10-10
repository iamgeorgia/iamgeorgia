/**
 * Partner onboarding types.
 *
 * These mirror the server's serializers exactly (`server/serializers/*.js`),
 * not its Prisma models — the API deliberately returns less than it stores.
 * The clearest example is `financial`: it is *absent* rather than null when the
 * viewer is not entitled to it, so a missing block never gets misread as "this
 * partner supplied no bank details".
 *
 * Enum members are spelled exactly as the server's Prisma enums, so nothing has
 * to be translated at the boundary. Display wording lives in the i18n
 * dictionaries.
 */

export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "MANAGEMENT"
  | "TOUR_OPERATOR"
  | "ACCOUNTANT"
  | "FINANCE_OPERATOR"
  | "DISPATCHER"
  | "PARTNER_OWNER"
  | "PARTNER_ADMIN"
  | "PARTNER_AGENT"
  | "PARTNER_FINANCE"
  | "DRIVER";

/**
 * A partner's lifecycle. Only APPROVED reaches the B2B platform;
 * PENDING_APPROVAL reaches the "application under review" page and nothing else.
 */
export type PartnerStatus =
  | "INVITED"
  | "REGISTRATION_IN_PROGRESS"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export type PartnerKind = "HOTEL" | "TOUR_OPERATOR" | "TRANSPORT" | "EXPERIENCE";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface SocialLink {
  label: string;
  url: string;
}

export interface PartnerDocument {
  label: string;
  received: boolean;
}

/** A person attached to a partner, or an admin shown as an actor. */
export interface PartnerContact {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  position: string | null;
  phone: string | null;
  email: string;
  role: Role;
  /** The one person an admin corresponds with about this company. */
  isPrimaryContact: boolean;
  isActive: boolean;
  /** They have an account but have not set a password through their link yet. */
  isPending: boolean;
}

export interface PartnerFinancial {
  iban: string;
  swift: string;
  bankName: string | null;
  accountHolder: string | null;
  updatedAt: string;
}

export interface PartnerReview {
  approvedAt: string | null;
  approvedBy: PartnerContact | null;
  rejectedAt: string | null;
  rejectedBy: PartnerContact | null;
  /** Shown to the applicant. */
  rejectionReason: string | null;
  /** Admin-only; absent for every other viewer. */
  rejectionNote?: string | null;
  suspendedAt: string | null;
  suspendedBy: PartnerContact | null;
  suspensionReason: string | null;
}

/** The row shape of the partners table and the applications queue. */
export interface PartnerSummary {
  id: string;
  /** The public Partner ID, e.g. "PTR-000001". Immutable, never the database id. */
  reference: string;
  name: string;
  legalName: string | null;
  kind: PartnerKind;
  status: PartnerStatus;
  registrationNumber: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  submittedAt: string | null;
  createdAt: string;
  contact: PartnerContact | null;
}

export interface Partner extends PartnerSummary {
  legalAddress: string | null;
  website: string | null;
  socialLinks: SocialLink[];
  documents: PartnerDocument[];
  /** Basis points: 1000 is 10%. Integer, like every other rate on the server. */
  commissionRateBps: number;
  users: PartnerContact[];
  updatedAt: string;
  review: PartnerReview;
  /** Absent unless the viewer is entitled to it. Never merely null. */
  financial?: PartnerFinancial | null;
  /** Admin-only internal note. */
  notes?: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  partnerId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  resentCount: number;
  createdAt: string;
  invitedBy: PartnerContact | null;
  status: InvitationStatus;
}

export interface AuditEntry {
  id: string;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
  actor: PartnerContact | null;
  actorEmail: string;
  createdAt: string;
}

/** What the registration page may know before anyone has proved anything. */
export interface InvitationPreview {
  email: string;
  expiresAt: string;
  company: {
    name: string;
    kind: PartnerKind;
    legalName: string | null;
    registrationNumber: string | null;
    legalAddress: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  } | null;
  prefill: {
    contact?: Partial<Pick<PartnerContact, "firstName" | "lastName" | "position" | "phone">>;
  };
}

/** The generated link an admin gets back, alongside the email that carried it. */
export interface PartnerLink {
  kind: "invitation" | "activation";
  url: string;
  expiresAt: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
