import { ApiError } from "@/lib/api/client";

/** True when the server refused because the owner has not accepted the current platform terms. */
export function isTermsOutdated(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) return false;

  const details = error.details;
  return (
    Boolean(details) &&
    typeof details === "object" &&
    (details as { reason?: unknown }).reason === "TERMS_OUTDATED"
  );
}
