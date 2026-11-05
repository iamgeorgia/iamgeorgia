import type { AutoRetry } from "./useAutoRetry";

export interface FailureCopy {
  title: string;
  body: string;
  /** What the boundary is doing about it by itself, when it is doing anything. */
  status: string | null;
}

/**
 * The words for a failure that passes by itself, or null for one that does
 * not — the boundary then keeps its own. `what` names the thing that failed
 * the way that boundary does: "screen", "page", "admin panel".
 */
export function failureCopy({ failure, secondsLeft }: AutoRetry, what: string): FailureCopy | null {
  if (!failure) return null;

  const status = secondsLeft === null ? null : secondsLeft <= 1 ? "Loading it again…" : `Trying again in ${secondsLeft} seconds…`;

  switch (failure.kind) {
    case "interrupted":
      return {
        title: `This ${what} stopped loading`,
        body: "Loading was interrupted before the records arrived — the stop button, a refresh on top of a refresh, or a dropped connection. Nothing has been changed.",
        status,
      };
    case "rate-limited":
      return {
        title: "Too many requests in a short time",
        body: "The server is pacing requests from this address, which happens after several quick refreshes. Nothing has been changed, and it clears within a minute.",
        status,
      };
    case "unreachable":
      return {
        title: "The server did not answer",
        body: "It may be restarting, or the connection may have dropped. Nothing has been changed.",
        status,
      };
  }
}
