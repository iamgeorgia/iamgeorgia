import { ApiError } from "@/lib/api/client";

/**
 * Sign-in refusals that are about the company, not the password.
 *
 * The server answers 403 with `details.reason` set to one of these when the
 * person's partner has been blocked or terminated. They get their own wording
 * (in every locale) because "wrong password" would send them in circles.
 */
export type AccountBlockKey = "accountBlocked" | "accountTerminated";

export function accountBlockKey(error: unknown): AccountBlockKey | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;

  const details = error.details;
  const reason =
    details && typeof details === "object" && "reason" in details
      ? String((details as { reason: unknown }).reason)
      : null;

  if (reason === "PARTNER_BLOCKED") return "accountBlocked";
  if (reason === "PARTNER_TERMINATED") return "accountTerminated";
  return null;
}
