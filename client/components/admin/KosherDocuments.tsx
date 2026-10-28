"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ExternalLink, FileText, Trash2, Upload } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { FormError, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { attachHotelDocument, detachHotelDocument } from "@/lib/api/kosher";
import { getSignedUrl, uploadMedia } from "@/lib/api/media";
import { describeError } from "@/lib/api/client";
import type { HotelDocument } from "@/types/catalogue";

/**
 * Certificate scans.
 *
 * Two steps, following the gallery: the bytes go to the media library once and
 * are attached afterwards, so a file can be detached and re-attached without
 * moving or changing its object key.
 *
 * Uploaded as `KOSHER_CERTIFICATE`, which the server maps to PRIVATE — a
 * category cannot be uploaded public however the caller asks. There is
 * therefore no `src` anywhere on this screen: opening one fetches a short-lived
 * signed link, and that request is authorized and audited as
 * `PRIVATE_FILE_ACCESSED` like any other document read.
 */

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/avif";

export function KosherDocuments({
  hotelId,
  documents,
}: {
  hotelId: string;
  documents: HotelDocument[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const can = useCan();
  // Opening a file is a read; attaching and detaching are catalogue writes.
  const canEdit = can("catalogue.write");

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const certificates = documents.filter((document) => document.docType === "KOSHER_CERTIFICATE");

  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);

    try {
      const asset = await uploadMedia(file, "KOSHER_CERTIFICATE");

      await attachHotelDocument(hotelId, {
        fileAssetId: asset.id,
        docType: "KOSHER_CERTIFICATE",
        label: label.trim() || null,
      });

      setLabel("");
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  /** The only way to reach the bytes: a signed link, fetched on demand. */
  const open = async (document: HotelDocument) => {
    setBusy(`open-${document.id}`);
    setError(null);

    try {
      const { url } = await getSignedUrl(document.fileAssetId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (document: HotelDocument) => {
    setBusy(`delete-${document.id}`);
    setError(null);

    try {
      await detachHotelDocument(hotelId, document.id);
      router.refresh();
    } catch (caught) {
      // 409 while a verified certificate still points at it, which is the
      // message worth showing rather than swallowing.
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminPanel
      title="Certificate files"
      description="PDF or a photograph. Private — never given a public URL."
    >
      {certificates.length === 0 ? (
        <p className="text-[0.875rem] text-muted">Nothing uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {certificates.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText size={15} className="shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] text-ink">
                    {document.label ?? document.file?.originalFilename}
                  </p>
                  <p className="text-[0.75rem] text-subtle">
                    {document.file?.mimeType}
                    {document.file && ` · ${Math.round(document.file.sizeBytes / 1024)} KB`}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void open(document)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.75rem] font-medium text-body transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
                >
                  <ExternalLink size={13} aria-hidden />
                  Open
                </button>
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void remove(document)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.75rem] font-medium text-body transition-colors hover:border-error/50 hover:text-error-text disabled:opacity-50"
                  >
                    <Trash2 size={13} aria-hidden />
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextInput
            label="Label"
            hint="Optional. How this file is named in the certificate picker."
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-line px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink hover:text-ink">
            <Upload size={14} aria-hidden />
            {busy === "upload" ? "Uploading…" : "Upload"}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              disabled={busy !== null}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
      ) : (
        <ReadOnlyNote className="mt-5" needs="catalogue.write" what="Uploading or removing a certificate file" />
      )}

      <FormError message={error} />
    </AdminPanel>
  );
}
