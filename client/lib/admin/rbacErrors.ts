import { ApiError, describeError } from "@/lib/api/client";
import { capabilityLabel } from "./capabilities";

/**
 * Turns the server's role and override refusals into sentences, falling back
 * to its own message. The server names the refusal in `details.reason`.
 */
export function describeRbacError(error: unknown): string {
  if (!(error instanceof ApiError)) return describeError(error);

  const details = (error.details ?? {}) as { reason?: string; missing?: string[]; members?: number };
  const code = details.reason ?? "";

  if (code === "ROLE_LOCKED") return "This role's capabilities are fixed and cannot be changed.";

  if (code === "ROLE_ABOVE_CEILING" || (error.status === 403 && Array.isArray(details.missing))) {
    const missing = (details.missing ?? []).map(capabilityLabel);
    return missing.length
      ? `You can only hand out what you hold yourself. You do not hold: ${missing.join(", ")}.`
      : error.message;
  }

  if (code === "SYSTEM_ROLE") return "A built-in role cannot be deleted.";

  if (code === "ROLE_IN_USE") {
    return typeof details.members === "number"
      ? `${details.members} ${details.members === 1 ? "account holds" : "accounts hold"} this role. Move them to another role first.`
      : error.message;
  }

  return error.message;
}
