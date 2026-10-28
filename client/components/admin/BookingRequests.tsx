"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Clock, X } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { FormError, SubmitButton, TextArea } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { answerBookingRequest } from "@/lib/api/kosher";
import { describeError } from "@/lib/api/client";
import type { Booking, BookingRequestStatus } from "@/types/booking";
import { cn } from "@/lib/utils";

/**
 * The property's answers to a booking's requirements.
 *
 * The panel exists because a requirement is not the reservation. The rooms were
 * claimed and priced at confirmation and nothing here changes that — answering
 * "no" to a kosher meal does not cancel a booking, and the panel never offers
 * to. What it does is record what the property said, so an agency can tell its
 * guest something true.
 *
 * Declining requires a reason. A refusal an agency cannot explain is the one
 * outcome that reliably becomes a complaint.
 */

const TONES: Record<BookingRequestStatus, { icon: typeof Check; tone: string; label: string }> = {
  // Neutral, not amber: waiting on a property is the ordinary state of a
  // perfectly good booking, and colouring it as a problem would make every
  // kosher reservation look like one.
  REQUESTED: { icon: Clock, tone: "text-muted", label: "Awaiting the property" },
  CONFIRMED: { icon: Check, tone: "text-success", label: "Confirmed" },
  DECLINED: { icon: X, tone: "text-error-text", label: "Not available" },
  WITHDRAWN: { icon: X, tone: "text-subtle", label: "Withdrawn" },
};

/**
 * Codes are machine keys; this is the admin panel's English for them.
 *
 * The panel is English-only throughout, so it reads them from a map here rather
 * than from the locale dictionaries the public site uses. An unmapped code
 * falls back to itself, which is ugly but never blank.
 */
const LABELS: Record<string, string> = {
  kosherRestaurant: "Kosher restaurant",
  kosherKitchen: "Kosher kitchen",
  kosherBreakfast: "Kosher breakfast",
  kosherLunch: "Kosher lunch",
  kosherDinner: "Kosher dinner",
  separateMeatDairy: "Separate meat and dairy preparation",
  kosherMealOnRequest: "Kosher meal on request",
  passoverKosher: "Kosher for Passover",
  kosherWine: "Kosher wine",
  shabbatElevator: "Shabbat elevator",
  shabbatMeals: "Shabbat meals",
  manualRoomKeys: "Physical room keys",
  shabbatLighting: "Shabbat room lighting",
  shabbatHotPlate: "Shabbat hot plate",
  shabbatLateCheckout: "Late Saturday checkout",
  synagogueOnSite: "Synagogue on property",
  synagogueNearby: "Synagogue nearby",
  prayerRoom: "Prayer room",
  minyanDaily: "Daily minyan",
  mikvehOnSite: "Mikveh on property",
  mikvehNearby: "Mikveh nearby",
  eruv: "Within an eruv",
};

export function BookingRequests({ booking }: { booking: Booking }) {
  const router = useRouter();
  const can = useCan();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<{ id: string; note: string } | null>(null);

  if (booking.requests.length === 0) return null;

  // Answering on the property's behalf is a change to the booking.
  const canAnswer = can("bookings.write");

  const answer = async (
    requestId: string,
    status: "CONFIRMED" | "DECLINED",
    responseNote?: string,
  ) => {
    setBusy(requestId);
    setError(null);

    try {
      await answerBookingRequest(booking.reference, requestId, { status, responseNote });
      setDeclining(null);
      // A Server Component page: re-read rather than patch a local copy that
      // could drift from what the server actually stored.
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminPanel
      title="Requirements"
      description={
        booking.requestsPending > 0
          ? `${booking.requestsPending} still to answer. The rooms are confirmed regardless.`
          : "All answered."
      }
    >
      <ul className="divide-y divide-line">
        {booking.requests.map((request) => {
          const { icon: Icon, tone, label } = TONES[request.status];
          const open = request.status === "REQUESTED";
          const decliningThis = declining?.id === request.id;

          return (
            <li key={request.id} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[0.875rem] text-ink">
                    <Icon size={14} className={cn("shrink-0", tone)} aria-hidden />
                    {LABELS[request.code] ?? request.code}
                  </p>
                  {request.note && (
                    <p className="mt-1 ps-6 text-[0.8125rem] text-muted">{request.note}</p>
                  )}
                  {request.responseNote && (
                    <p className="mt-1 ps-6 text-[0.75rem] text-subtle">{request.responseNote}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn("text-[0.75rem] font-semibold", tone)}>{label}</span>

                  {open && canAnswer && (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void answer(request.id, "CONFIRMED")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-brand px-3 text-[0.75rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
                      >
                        <Check size={13} aria-hidden />
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          setDeclining(decliningThis ? null : { id: request.id, note: "" })
                        }
                        className="inline-flex h-8 items-center rounded-sm border border-line px-3 text-[0.75rem] font-medium text-body transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </div>

              {decliningThis && (
                <div className="mt-3 rounded-sm border border-line bg-background p-3">
                  <TextArea
                    label="Why it cannot be done"
                    hint="Shown to the agency on the booking. A refusal with no reason is one they cannot pass on."
                    rows={2}
                    maxLength={500}
                    value={declining.note}
                    onChange={(event) => setDeclining({ ...declining, note: event.target.value })}
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDeclining(null)}
                      className="inline-flex h-9 items-center rounded-sm border border-line px-3 text-[0.8125rem] text-body hover:border-ink hover:text-ink"
                    >
                      Cancel
                    </button>
                    <SubmitButton
                      busy={busy === request.id}
                      disabled={!declining.note.trim()}
                      onClick={() =>
                        void answer(request.id, "DECLINED", declining.note.trim())
                      }
                    >
                      Decline
                    </SubmitButton>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!canAnswer && booking.requestsPending > 0 && (
        <ReadOnlyNote needs="bookings.write" what="Answering a requirement" className="mt-4" />
      )}

      <FormError message={error} />
    </AdminPanel>
  );
}
