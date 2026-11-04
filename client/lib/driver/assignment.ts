import type { AssignmentMilestones, DriverAssignment, PassengerBlock } from "@/types/driver";
import type { TransferLegStatus } from "@/types/transfer";

/** The zone a day is counted in when no job says otherwise. */
export const DRIVER_FALLBACK_TIME_ZONE = "Asia/Tbilisi";

export const zoneOf = (assignment: DriverAssignment) => assignment.leg.timezone || DRIVER_FALLBACK_TIME_ZONE;

/**
 * The moves a driver can make on a job, in the order they happen. The server
 * says which are legal (`allowedTransitions`); this only orders them, so the
 * first legal one is the big button.
 */
const ORDER: TransferLegStatus[] = ["EN_ROUTE", "ARRIVED", "ON_BOARD", "COMPLETED", "NO_SHOW_REPORTED"];

export const driverMoves = (assignment: DriverAssignment): TransferLegStatus[] =>
  ORDER.filter((state) => assignment.allowedTransitions.includes(state));

/** An accepted job a driver can still hand back. */
export const canHandBack = (assignment: DriverAssignment): boolean =>
  assignment.canDecline && assignment.leg.status === "ACCEPTED";

/**
 * Whether the job page has any button to show. Plain module, not the client
 * component, so the server page can decide its layout with it.
 */
export const hasAssignmentControls = (assignment: DriverAssignment): boolean =>
  assignment.canAccept || driverMoves(assignment).length > 0 || canHandBack(assignment);

/** Turned down by this driver, or taken away by dispatch. */
export const isWithdrawn = (assignment: DriverAssignment) =>
  assignment.status === "DECLINED" || assignment.status === "REVOKED";

const DONE: TransferLegStatus[] = ["COMPLETED", "NO_SHOW_REPORTED", "NO_SHOW", "CANCELLED"];

/** Nothing left to drive: finished, a no-show, cancelled, or no longer this driver's. */
export const isFinished = (assignment: DriverAssignment) => isWithdrawn(assignment) || DONE.includes(assignment.leg.status);

/** Accepted and still to be driven, or under way. */
export const isLive = (assignment: DriverAssignment) => assignment.status === "ACCEPTED" && !isFinished(assignment);

// --- Progress -----------------------------------------------------------------

export interface ProgressStep {
  status: TransferLegStatus;
  label: string;
  at: keyof AssignmentMilestones;
}

/** A job's five steps, each with the milestone that stamps it. */
export const PROGRESS_STEPS: ProgressStep[] = [
  { status: "ACCEPTED", label: "Accepted", at: "acceptedAt" },
  { status: "EN_ROUTE", label: "On my way", at: "enRouteAt" },
  { status: "ARRIVED", label: "Arrived", at: "arrivedAt" },
  { status: "ON_BOARD", label: "Passenger on board", at: "pickedUpAt" },
  { status: "COMPLETED", label: "Dropped off", at: "completedAt" },
];

/**
 * How far along the job is: the index of the last step reached, or -1 before
 * acceptance. A no-show stops at "Arrived" — the passenger never boarded.
 */
export function progressIndex(status: TransferLegStatus): number {
  if (status === "NO_SHOW_REPORTED" || status === "NO_SHOW") return 2;
  return PROGRESS_STEPS.findIndex((step) => step.status === status);
}

// --- Needs --------------------------------------------------------------------

export interface JobNeed {
  key: string;
  label: string;
  /** Things the car must carry, as against things to know. */
  kind: "equipment" | "note";
}

/**
 * What the car must carry or the driver must know before setting off, read
 * off the booking: child seats (with ages, which decide the seat), paid
 * extras, and whether the passenger wrote a request.
 */
export function jobNeeds(booking: PassengerBlock): JobNeed[] {
  const needs: JobNeed[] = [];
  const ages = booking.childAges;

  if (ages.length > 0) {
    const seats = ages.length === 1 ? "Child seat" : `${ages.length} child seats`;
    const years = ages.map((age) => (age < 1 ? "under 1" : String(age))).join(", ");
    needs.push({ key: "child-seats", label: `${seats} · ${ages.length === 1 ? "age" : "ages"} ${years}`, kind: "equipment" });
  }

  for (const extra of booking.extras) {
    needs.push({
      key: `extra-${extra.code}`,
      // Non-breaking either side of the ×, so a chip that wraps never leaves
      // the quantity alone on its own line.
      label: extra.quantity > 1 ? `${extra.name}\u00a0×\u00a0${extra.quantity}` : extra.name,
      kind: "equipment",
    });
  }

  if (booking.specialRequests?.trim()) {
    needs.push({ key: "requests", label: "Passenger request", kind: "note" });
  }

  return needs;
}

// --- Time ---------------------------------------------------------------------

/** "40 min", "1 h 05 min", "3 h". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${String(rest).padStart(2, "0")} min`;
}

/**
 * A gap as a person says it: minutes, then hours and minutes within the
 * day, then days and hours for the next three, then whole days — "in 170 h"
 * is not a time anyone reads.
 */
function formatSpan(minutes: number): string {
  if (minutes < 24 * 60) return formatDuration(minutes);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const dayWord = days === 1 ? "1 day" : `${days} days`;
  return days < 3 && hours > 0 ? `${dayWord} ${hours} h` : dayWord;
}

/**
 * When something happens, from where the clock is now: "in 1 h 20 min",
 * "in 4 min", "now", "12 min ago", "in 2 days 4 h". Minutes are rounded
 * towards the moment, so "in 1 min" lasts until it is "now".
 */
export function untilLabel(atIso: string, nowMs: number): { label: string; past: boolean; soon: boolean } {
  const minutes = (Date.parse(atIso) - nowMs) / 60_000;

  if (Math.abs(minutes) < 1) return { label: "now", past: false, soon: true };

  const span = formatSpan(minutes > 0 ? Math.ceil(minutes) : Math.floor(-minutes));
  return minutes > 0
    ? { label: `in ${span}`, past: false, soon: minutes <= 60 }
    : { label: `${span} ago`, past: true, soon: false };
}

/** "Good morning" by the pick-up zone's clock, not the server's. */
export function greetingFor(nowMs: number, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date(nowMs)),
  );
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
