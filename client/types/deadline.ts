import type { BookingApprovalProduct } from "./booking";
import type { CustomerKind } from "./customer";

/**
 * The deadline calendar and the reminder schedule, as the server sends them
 * (`server/services/booking/deadline.service.js` → `toDeadline`,
 * `toReminderPolicy`; `server/validation/deadline.js` for the inputs).
 *
 * Three deadlines per booking, projected beside the booking index: PAYMENT
 * (the receivable's due date), FREE_CANCELLATION (the last free moment of
 * the frozen schedule) and CONFIRMATION (the platform's approval deadline or
 * the supplier's answer deadline — `meta.awaiting` says which).
 */

export type DeadlineKind = "PAYMENT" | "FREE_CANCELLATION" | "CONFIRMATION";
export type DeadlineStatus = "OPEN" | "MET" | "MISSED" | "CANCELLED";
export type DeadlineSource = "SYSTEM" | "MANUAL";
export type DeadlineProduct = BookingApprovalProduct;

export interface DeadlineHistoryEntry {
  id: string;
  fromAt: string | null;
  toAt: string;
  source: DeadlineSource;
  reason: string | null;
  changedBy: string | null;
  at: string;
}

export interface Deadline {
  id: string;
  kind: DeadlineKind;
  status: DeadlineStatus;
  source: DeadlineSource;
  product: DeadlineProduct;
  bookingId: string;
  reference: string;
  title: string | null;
  leadName: string | null;
  partnerId: string | null;
  customerId: string | null;
  assignedManagerUserId: string | null;
  /** The names behind the three ids, looked up once per page; null where there is nobody. */
  partner: { id: string; name: string } | null;
  customer: { id: string; name: string; kind: CustomerKind } | null;
  assignedManager: { id: string; name: string } | null;
  receivableId: string | null;
  /** ISO instant. */
  dueAt: string;
  /** The booking's own zone — the one the due moment should be read in. */
  timezone: string;
  overdue: boolean;
  /** Whole days until due (negative once past); null unless OPEN. */
  daysLeft: number | null;
  meta: { awaiting?: "PLATFORM" | "SUPPLIER" } & Record<string, unknown>;
  completedAt: string | null;
  /** Canonical, unprefixed path to the booking — admin or portal, by who asked. */
  href: string;
  updatedAt: string;
  /** Only on `GET /:id` and the answer to a move. */
  history?: DeadlineHistoryEntry[];
}

export type DeadlineSort = "soonest" | "latest";

/** `GET /admin/deadlines` and `GET /partner/deadlines` — `from`/`to` are instants. */
export interface DeadlineQuery {
  kind?: DeadlineKind | DeadlineKind[];
  status?: DeadlineStatus | DeadlineStatus[];
  product?: DeadlineProduct | DeadlineProduct[];
  partnerId?: string;
  managerId?: string;
  customerId?: string;
  /** One booking's three rows, by its reference or its id. */
  reference?: string;
  bookingId?: string;
  from?: string;
  to?: string;
  sort?: DeadlineSort;
  page?: number;
  pageSize?: number;
}

export interface MoveDeadlineInput {
  dueAt: string;
  reason: string;
}

// --- reminder policies -------------------------------------------------------

export type ReminderChannel = "IN_APP" | "EMAIL";
export type ReminderRecipient = "STAFF" | "PARTNER" | "GUEST";
export type ReminderPolicyScope = "PLATFORM" | "PARTNER";

export interface ReminderPolicy {
  id: string;
  kind: DeadlineKind;
  scope: ReminderPolicyScope;
  partner: { id: string; name: string; reference: string } | null;
  /** Days before the deadline a reminder goes out; 0 is the day itself. */
  offsetsDays: number[];
  channels: ReminderChannel[];
  recipients: ReminderRecipient[];
  enabled: boolean;
  updatedAt: string;
}

/** `PUT /admin/settings/reminder-policies`. `remove` deletes a partner override. */
export interface ReminderPolicyInput {
  kind: DeadlineKind;
  partnerId?: string | null;
  offsetsDays: number[];
  channels: ReminderChannel[];
  recipients: ReminderRecipient[];
  enabled: boolean;
  remove?: boolean;
}
