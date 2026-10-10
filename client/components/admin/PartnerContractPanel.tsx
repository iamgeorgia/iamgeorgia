"use client";

import { useRouter } from "next/navigation";
import { ExternalLink, FileCheck2, Loader2 } from "lucide-react";
import { useState } from "react";

import { AdminDefinitionList, AdminPanel } from "./AdminPage";
import { FormError, SubmitButton, TextArea, TextInput, labelClass } from "./FormControls";
import { ApiError, describeError } from "@/lib/api/client";
import { getContractLink, setContractRequirement, uploadContract } from "@/lib/api/partners";
import { formatPartnerDate, formatPartnerDateTime } from "@/lib/admin/partners";
import type { PartnerContract } from "@/types/partner";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * The signed agreement for one partner.
 *
 * Opening the PDF asks the server for a short-lived link each time, rather
 * than holding one on the page: the link expires, and every open is recorded
 * against the person who asked. The upload and the "not required" switch are
 * `partners.contract.write` only; the server checks that again.
 */
export function PartnerContractPanel({
  partnerId,
  contract,
  canWrite,
  canOpen,
}: {
  partnerId: string;
  contract: PartnerContract;
  canWrite: boolean;
  canOpen: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [signedAt, setSignedAt] = useState("");
  const [version, setVersion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [switching, setSwitching] = useState(false);
  const [reason, setReason] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const open = async () => {
    setOpening(true);
    setError(null);
    // The tab is opened first, inside the click, so a popup blocker lets it
    // through; the address is filled in once the server has answered.
    const tab = window.open("", "_blank");
    try {
      const link = await getContractLink(partnerId);
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.location.href = link.url;
      }
    } catch (caught) {
      tab?.close();
      setError(
        caught instanceof ApiError && caught.status === 404
          ? "There is no contract on file."
          : describeError(caught, "Could not open the contract."),
      );
    } finally {
      setOpening(false);
    }
  };

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setUploaded(false);

    const errors: Record<string, string> = {};
    if (!file) errors.file = "Choose the signed PDF.";
    else if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) errors.file = "The contract must be a PDF.";
    else if (file.size > MAX_BYTES) errors.file = "That file is larger than 20 MB.";
    if (!signedAt) errors.signedAt = "Enter the date it was signed.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !file) return;

    setUploading(true);
    try {
      await uploadContract(partnerId, { file, signedAt, version });
      setUploaded(true);
      setFile(null);
      setVersion("");
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not file the contract."));
    } finally {
      setUploading(false);
    }
  };

  const changeRequirement = async () => {
    setSwitchBusy(true);
    setSwitchError(null);
    try {
      await setContractRequirement(partnerId, !contract.required, reason.trim());
      setSwitching(false);
      setReason("");
      router.refresh();
    } catch (caught) {
      setSwitchError(describeError(caught, "Could not change the requirement."));
    } finally {
      setSwitchBusy(false);
    }
  };

  return (
    <AdminPanel
      title="Contract"
      description="The signed agreement. A partner cannot be approved without one, unless it is marked as not needed."
    >
      {contract.onFile ? (
        <>
          <AdminDefinitionList
            items={[
              { label: "Signed on", value: formatPartnerDate(contract.signedAt) },
              { label: "Version", value: contract.version ?? "—" },
              { label: "File", value: contract.filename ?? "—" },
              {
                label: "Filed",
                value: contract.uploadedAt
                  ? `${formatPartnerDateTime(contract.uploadedAt)}${contract.uploadedBy ? ` by ${contract.uploadedBy.email}` : ""}`
                  : "—",
              },
            ]}
          />
          {canOpen && (
            <button
              type="button"
              onClick={open}
              disabled={opening}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
            >
              {opening ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ExternalLink size={15} aria-hidden />}
              Open contract
            </button>
          )}
        </>
      ) : (
        <p className="flex items-start gap-2 text-[0.875rem] leading-relaxed text-body">
          <FileCheck2 size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
          {contract.required
            ? "No contract is on file yet. Upload the signed PDF below before approving this partner."
            : "No contract is on file, and none is required for this partner."}
        </p>
      )}

      {!contract.required && (
        <p className="mt-4 rounded-sm bg-warning/12 p-3 text-[0.8125rem] leading-relaxed text-warning-text">
          Contract not required. This partner can be approved without one.
        </p>
      )}

      {canWrite && (
        <form onSubmit={upload} noValidate className="mt-5 space-y-4 border-t border-line pt-5">
          <p className={labelClass}>{contract.onFile ? "Replace the contract" : "File the contract"}</p>
          <div>
            <label htmlFor="contract-file" className="mb-1.5 block text-[0.75rem] text-muted">
              Signed PDF (up to 20 MB)
            </label>
            <input
              id="contract-file"
              type="file"
              accept="application/pdf,.pdf"
              disabled={uploading}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setUploaded(false);
              }}
              className="block w-full text-[0.8125rem] text-body file:me-3 file:rounded-sm file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-[0.8125rem] file:text-body"
            />
            {fieldErrors.file && (
              <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">
                {fieldErrors.file}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Signed on"
              type="date"
              value={signedAt}
              disabled={uploading}
              onChange={(event) => {
                setSignedAt(event.target.value);
                setUploaded(false);
              }}
              error={fieldErrors.signedAt}
            />
            <TextInput
              label="Version (optional)"
              value={version}
              disabled={uploading}
              placeholder="2026-1"
              onChange={(event) => setVersion(event.target.value)}
              error={fieldErrors.version}
            />
          </div>
          <FormError message={error} />
          <div className="flex justify-end">
            <SubmitButton type="submit" busy={uploading} saved={uploaded}>
              {uploaded ? "Filed" : "Upload contract"}
            </SubmitButton>
          </div>
        </form>
      )}

      {!canWrite && <FormError message={error} />}

      {canWrite && (
        <div className="mt-5 border-t border-line pt-5">
          {!switching ? (
            <button
              type="button"
              onClick={() => setSwitching(true)}
              className="text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
            >
              {contract.required ? "This partner does not need a contract" : "Require a contract again"}
            </button>
          ) : (
            <div className="space-y-3 rounded-sm bg-surface-soft p-3">
              <TextArea
                label={contract.required ? "Why is no contract needed?" : "Why is a contract needed again?"}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <FormError message={switchError} />
              <div className="flex gap-2">
                <SubmitButton busy={switchBusy} disabled={reason.trim().length === 0} onClick={changeRequirement}>
                  {contract.required ? "Mark as not required" : "Require a contract"}
                </SubmitButton>
                <button
                  type="button"
                  disabled={switchBusy}
                  onClick={() => {
                    setSwitching(false);
                    setReason("");
                    setSwitchError(null);
                  }}
                  className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body hover:border-ink/40 hover:text-ink disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminPanel>
  );
}
