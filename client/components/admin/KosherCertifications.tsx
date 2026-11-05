"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, BadgeCheck, FileText, Plus, ShieldAlert, ShieldQuestion, X } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { FormError, SelectInput, SubmitButton, TextArea, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import {
  addKosherCertification,
  archiveKosherCertification,
  updateKosherCertification,
  verifyKosherCertification,
  type KosherCertificationInput,
} from "@/lib/api/kosher";
import { describeError } from "@/lib/api/client";
import type {
  HotelDocument,
  KosherCertification,
  KosherCertificationScope,
  KosherCertificationState,
  KosherProfile,
} from "@/types/catalogue";
import { cn } from "@/lib/utils";

/**
 * Certificates, and the one action that produces the word "certified".
 *
 * Verifying is a button of its own, not a field on the certificate form, and
 * the two never appear in the same request. That is the whole security posture:
 * the server's edit schema has no `verification` key, so no combination of
 * fields anybody can send through the form below reaches it.
 *
 * Editing a verified certificate withdraws its verification, and the form says
 * so before it is submitted rather than after. Verification attaches to a set
 * of facts — this authority, this number, these dates — not to a row id.
 */

const SCOPES: { value: KosherCertificationScope; label: string; hint: string }[] = [
  { value: "PROPERTY", label: "Whole property", hint: "Certifies the property. Answers a search for a certified hotel." },
  { value: "KITCHEN", label: "Kitchen", hint: "Certifies the kitchen. Answers a search for a certified hotel." },
  { value: "RESTAURANT", label: "Restaurant only", hint: "Does not make the property certified." },
  { value: "PASSOVER", label: "Passover only", hint: "Does not make the property certified." },
];

const STATE_STYLES: Record<
  KosherCertificationState,
  { icon: typeof BadgeCheck; tone: string; label: string }
> = {
  VERIFIED: { icon: BadgeCheck, tone: "text-success", label: "Verified" },
  PENDING_VERIFICATION: { icon: ShieldQuestion, tone: "text-warning-text", label: "Awaiting review" },
  EXPIRED: { icon: ShieldAlert, tone: "text-error-text", label: "Expired" },
  UNVERIFIED: { icon: ShieldQuestion, tone: "text-muted", label: "Not checked" },
  REJECTED: { icon: X, tone: "text-error-text", label: "Rejected" },
  ARCHIVED: { icon: Archive, tone: "text-subtle", label: "Archived" },
  NONE: { icon: ShieldQuestion, tone: "text-muted", label: "None" },
};

const EMPTY: KosherCertificationInput = {
  authorityName: "",
  reference: null,
  scope: "PROPERTY",
  issuedOn: null,
  expiresOn: null,
  documentId: null,
};

interface KosherCertificationsProps {
  hotelId: string;
  kosher: KosherProfile;
  documents: HotelDocument[];
}

export function KosherCertifications({ hotelId, kosher, documents }: KosherCertificationsProps) {
  const router = useRouter();
  const can = useCan();
  // Adding, verifying, rejecting and archiving are all catalogue writes on the
  // server; a reader sees the register and its states, and none of the buttons.
  const canEdit = can("catalogue.write");

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<KosherCertificationInput>(EMPTY);
  const [noExpiry, setNoExpiry] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The certificate whose reject/hold form is open, and the note being typed. */
  const [deciding, setDeciding] = useState<{ id: string; notes: string } | null>(null);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);

    try {
      await action();
      router.refresh();
      return true;
    } catch (caught) {
      setError(describeError(caught));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const ok = await run("create", () =>
      addKosherCertification(hotelId, {
        ...draft,
        authorityName: draft.authorityName.trim(),
        reference: draft.reference?.trim() || null,
        // Null is the deliberate "this authority issues no expiry", which is a
        // different thing from a form that left the box empty — hence the
        // explicit checkbox rather than an empty date field meaning both.
        expiresOn: noExpiry ? null : draft.expiresOn || null,
        issuedOn: draft.issuedOn || null,
      }),
    );

    if (ok) {
      setAdding(false);
      setDraft(EMPTY);
      setNoExpiry(false);
    }
  };

  /** The only path to VERIFIED, and only ever from this button. */
  const decide = (certification: KosherCertification, decision: "VERIFIED" | "REJECTED" | "PENDING_VERIFICATION", notes?: string) =>
    run(`verify-${certification.id}`, () =>
      verifyKosherCertification(hotelId, certification.id, { decision, notes: notes ?? null }),
    );

  const documentLabel = (id: string | null) => {
    if (!id) return null;
    const document = documents.find((entry) => entry.id === id);
    return document?.label ?? document?.file?.originalFilename ?? "Attached file";
  };

  const certificateOptions = documents
    .filter((document) => document.docType === "KOSHER_CERTIFICATE")
    .map((document) => ({
      value: document.id,
      label: document.label ?? document.file?.originalFilename ?? document.id,
    }));

  return (
    <AdminPanel
      title="Certification"
      description="The only thing that makes a property read as kosher certified."
      action={
        canEdit &&
        !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink hover:text-ink"
          >
            <Plus size={14} aria-hidden />
            Add a certificate
          </button>
        )
      }
    >
      {kosher.certifications.length === 0 && !adding && (
        <p className="text-[0.875rem] text-muted">
          No certificate on file. This property reads as offering kosher services, not as certified.
        </p>
      )}

      <ul className="divide-y divide-line">
        {kosher.certifications.map((certification) => {
          const style = STATE_STYLES[certification.state];
          const Icon = style.icon;
          const archived = Boolean(certification.archivedAt);
          const decidingThis = deciding?.id === certification.id;

          return (
            <li
              key={certification.id}
              className={cn("py-4 first:pt-0 last:pb-0", archived && "opacity-60")}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-ink">
                    <Icon size={15} className={cn("shrink-0", style.tone)} aria-hidden />
                    {certification.authorityName}
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-muted">
                    {SCOPES.find((scope) => scope.value === certification.scope)?.label}
                    {certification.reference && ` · ${certification.reference}`}
                    {" · "}
                    {certification.expiresOn
                      ? `valid to ${certification.expiresOn}`
                      : "no expiry"}
                  </p>

                  {certification.documentId && (
                    <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-subtle">
                      <FileText size={13} aria-hidden />
                      {documentLabel(certification.documentId)}
                    </p>
                  )}

                  {certification.verifiedBy && certification.state === "VERIFIED" && (
                    <p className="mt-1 text-[0.75rem] text-subtle">
                      Verified by {certification.verifiedBy.name}
                    </p>
                  )}

                  {certification.verificationNotes && (
                    <p className="mt-1 text-[0.75rem] text-subtle">
                      {certification.verificationNotes}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className={cn("text-[0.75rem] font-semibold", style.tone)}>
                    {style.label}
                    {certification.state === "VERIFIED" &&
                      certification.expiresInDays !== null &&
                      certification.expiresInDays <= 60 &&
                      ` · ${certification.expiresInDays}d left`}
                  </span>

                  {canEdit && !archived && certification.state !== "VERIFIED" && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void decide(certification, "VERIFIED")}
                      className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-brand px-3 text-[0.75rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
                    >
                      <BadgeCheck size={13} aria-hidden />
                      Verify
                    </button>
                  )}

                  {canEdit && !archived && certification.state !== "REJECTED" && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        setDeciding(decidingThis ? null : { id: certification.id, notes: "" })
                      }
                      className="inline-flex h-8 items-center rounded-sm border border-line px-3 text-[0.75rem] font-medium text-body transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
                    >
                      Reject
                    </button>
                  )}

                  {canEdit && !archived && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`archive-${certification.id}`, () =>
                          archiveKosherCertification(hotelId, certification.id),
                        )
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.75rem] font-medium text-body transition-colors hover:border-error/50 hover:text-error-text disabled:opacity-50"
                    >
                      <Archive size={13} aria-hidden />
                      {certification.state === "UNVERIFIED" ? "Delete" : "Archive"}
                    </button>
                  )}
                </div>
              </div>

              {/* A rejection with no reason is not a decision the property can
                  act on, so the server requires a note and so does this. */}
              {decidingThis && (
                <div className="mt-3 rounded-sm border border-line bg-background p-3">
                  <TextArea
                    label="Why"
                    hint="Sent nowhere automatically, but recorded against the certificate and readable by whoever picks this up next."
                    rows={2}
                    maxLength={1000}
                    value={deciding.notes}
                    onChange={(event) => setDeciding({ ...deciding, notes: event.target.value })}
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDeciding(null)}
                      className="inline-flex h-9 items-center rounded-sm border border-line px-3 text-[0.8125rem] text-body hover:border-ink hover:text-ink"
                    >
                      Cancel
                    </button>
                    <SubmitButton
                      busy={busy === `verify-${certification.id}`}
                      disabled={!deciding.notes.trim()}
                      onClick={async () => {
                        const ok = await decide(certification, "REJECTED", deciding.notes.trim());
                        if (ok) setDeciding(null);
                      }}
                    >
                      Reject certificate
                    </SubmitButton>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {adding && (
        <div className="mt-5 rounded-sm border border-line bg-background p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Supervising authority"
              hint="As the certificate names it. Not translated — it is a proper noun."
              value={draft.authorityName}
              onChange={(event) => setDraft({ ...draft, authorityName: event.target.value })}
            />
            <TextInput
              label="Certificate number"
              value={draft.reference ?? ""}
              onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
            />
            <SelectInput
              label="Scope"
              hint={SCOPES.find((scope) => scope.value === draft.scope)?.hint}
              options={SCOPES.map(({ value, label }) => ({ value, label }))}
              value={draft.scope ?? "PROPERTY"}
              onChange={(event) =>
                setDraft({ ...draft, scope: event.target.value as KosherCertificationScope })
              }
            />
            <SelectInput
              label="Certificate file"
              hint="Uploaded to this property's documents first. Private — reached through a signed link."
              placeholder={certificateOptions.length > 0 ? "No file" : "No certificates uploaded yet"}
              options={certificateOptions}
              value={draft.documentId ?? ""}
              onChange={(event) => setDraft({ ...draft, documentId: event.target.value || null })}
            />
            <TextInput
              label="Issued on"
              type="date"
              value={draft.issuedOn ?? ""}
              onChange={(event) => setDraft({ ...draft, issuedOn: event.target.value })}
            />
            <div>
              <TextInput
                label="Expires on"
                type="date"
                disabled={noExpiry}
                value={noExpiry ? "" : (draft.expiresOn ?? "")}
                onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })}
              />
              <label className="mt-2 flex items-center gap-2 text-[0.8125rem] text-body">
                <input
                  type="checkbox"
                  checked={noExpiry}
                  onChange={(event) => setNoExpiry(event.target.checked)}
                  className="size-4 accent-brand"
                />
                This authority issues no expiry
              </label>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY);
                setNoExpiry(false);
              }}
              className="inline-flex h-10 items-center rounded-sm border border-line px-4 text-[0.8125rem] text-body hover:border-ink hover:text-ink"
            >
              Cancel
            </button>
            <SubmitButton
              busy={busy === "create"}
              disabled={!draft.authorityName.trim() || (!noExpiry && !draft.expiresOn)}
              onClick={create}
            >
              Add certificate
            </SubmitButton>
          </div>

          <p className="mt-3 text-[0.75rem] text-subtle">
            A new certificate starts unverified. It changes nothing an agency sees until somebody
            checks it against the authority and presses Verify.
          </p>
        </div>
      )}

      {!canEdit && (
        <ReadOnlyNote
          className="mt-5"
          needs="catalogue.write"
          what="Adding, verifying, rejecting or archiving a certificate"
        />
      )}

      <FormError message={error} />
    </AdminPanel>
  );
}

/** Exported for the certificate editor, which reuses the same withdrawal rule. */
export const withdrawsVerification = (patch: Partial<KosherCertificationInput>): boolean =>
  ["authorityName", "reference", "scope", "issuedOn", "expiresOn", "documentId"].some(
    (field) => field in patch,
  );

/** Kept beside the panel so the two never disagree about what an edit does. */
export const editCertification = updateKosherCertification;
