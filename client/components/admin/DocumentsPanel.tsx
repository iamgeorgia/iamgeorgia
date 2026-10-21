"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ExternalLink, FileText, Trash2, Upload } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { FormError, SelectInput, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { uploadMedia, type MediaCategory } from "@/lib/api/media";
import type { AttachedDocument } from "@/types/driver";

/**
 * A private document library, for a car or a driver.
 *
 * Two steps, following the galleries: the bytes go to the media library once
 * and are attached afterwards. The category is PRIVATE on the server whatever
 * the caller asks, so there is no `src` anywhere on this screen: opening one
 * fetches a short-lived signed link, and that request is authorised and
 * audited as `PRIVATE_FILE_ACCESSED`.
 *
 * Functions arrive as props from a thin client wrapper (`FleetDocuments`,
 * `DriverDocuments`), because a Server Component cannot hand a function down.
 *
 * Opening a file is a read; uploading and removing are writes, and which
 * capability the server asks for depends on whose library this is. A caller
 * can name it with `needs`; left out, it follows the category — fleet and
 * driver files are dispatch's, everything else is the catalogue's — which is
 * the rule the media endpoint applies to the upload itself.
 */

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/avif";

const OPS_CATEGORIES: ReadonlySet<MediaCategory> = new Set<MediaCategory>([
  "VEHICLE_DOCUMENT",
  "DRIVER_DOCUMENT",
  "FLEET_IMAGE",
]);

export function DocumentsPanel<T extends string>({
  title,
  description,
  documents,
  docTypes,
  category,
  attach,
  detach,
  link,
  needs,
}: {
  title: string;
  description?: string;
  documents: AttachedDocument[];
  docTypes: Array<{ value: T; label: string }>;
  category: MediaCategory;
  attach: (body: { fileAssetId: string; docType: T; label: string | null; validUntil: string | null }) => Promise<unknown>;
  detach: (documentId: string) => Promise<unknown>;
  link: (documentId: string) => Promise<{ url: string }>;
  /** The capabilities any one of which allows uploading and removing here. Derived from `category` when omitted. */
  needs?: string | string[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const can = useCan();

  const writeNeeds = needs ?? (OPS_CATEGORIES.has(category) ? "dispatch.write" : "catalogue.write");
  const canEdit = can(...(Array.isArray(writeNeeds) ? writeNeeds : [writeNeeds]));

  const [docType, setDocType] = useState<T>(docTypes[0]?.value);
  const [label, setLabel] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const labelFor = (value: string) => docTypes.find((type) => type.value === value)?.label ?? value;

  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);

    try {
      const asset = await uploadMedia(file, category);
      await attach({
        fileAssetId: asset.id,
        docType,
        label: label.trim() || null,
        validUntil: validUntil || null,
      });

      setLabel("");
      setValidUntil("");
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const open = async (document: AttachedDocument) => {
    setBusy(`open-${document.id}`);
    setError(null);

    try {
      const { url } = await link(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (document: AttachedDocument) => {
    if (!window.confirm("Remove this document? The file stays in the media library.")) return;

    setBusy(`delete-${document.id}`);
    setError(null);

    try {
      await detach(document.id);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const expired = (document: AttachedDocument) =>
    document.validUntil !== null && document.validUntil < new Date().toISOString().slice(0, 10);

  return (
    <AdminPanel title={title} description={description ?? "Private — never given a public URL. Every open is recorded."}>
      {documents.length === 0 ? (
        <p className="text-[0.875rem] text-muted">Nothing on file yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText size={15} className="shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] text-ink">
                    {labelFor(document.docType)}
                    {document.label ? ` · ${document.label}` : ""}
                  </p>
                  <p className="text-[0.75rem] text-subtle">
                    {document.file?.originalFilename}
                    {document.file && ` · ${Math.round(document.file.sizeBytes / 1024)} KB`}
                    {document.validUntil && (
                      <span className={expired(document) ? "text-error-text" : undefined}>
                        {" "}
                        · {expired(document) ? "expired" : "valid until"} {document.validUntil}
                      </span>
                    )}
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
        <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <SelectInput
            label="Type"
            value={docType}
            onChange={(event) => setDocType(event.target.value as T)}
            options={docTypes}
          />
          <TextInput label="Label" value={label} onChange={(event) => setLabel(event.target.value)} />
          <TextInput
            label="Valid until"
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
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
        <ReadOnlyNote className="mt-5" needs={writeNeeds} what="Uploading or removing a document" />
      )}

      <FormError message={error} />
    </AdminPanel>
  );
}
