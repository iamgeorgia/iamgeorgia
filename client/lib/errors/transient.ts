/**
 * Failures that are about the moment, not about the screen.
 *
 * A panel screen is a server render that asks the API for its records. Three
 * things make that fail without anything being wrong with the screen: the
 * browser stopped loading the page before its records had streamed in (the
 * stop button, a refresh on top of a refresh, a dropped connection); the API
 * paced the caller (429, after several quick refreshes); or the API did not
 * answer at all. Each of them passes by itself, so an error boundary should
 * say which it was and ask again rather than present it as a broken screen.
 *
 * A boundary cannot read a server render's error — production strips its
 * message — but Next hands through a `digest` the error already carries. So
 * the API client stamps one on these failures (`transientDigest`) and the
 * boundary reads it back (`classifyFailure`). No JSX and no imports, so the
 * node test suite can load it.
 */

export type TransientKind = "interrupted" | "rate-limited" | "unreachable";

export interface TransientFailure {
  kind: TransientKind;
  /** How long the server said to wait, when it said. */
  retryAfterMs: number | null;
}

const DIGEST_PREFIX = "IAG_TRANSIENT";

/**
 * The digest for an API failure worth retrying, or undefined for one that is
 * an answer (a refusal, a missing record, a bug) and would only repeat.
 * Status 0 is the API client's "nothing answered".
 */
export function transientDigest(status: number, retryAfterSeconds?: number | null): string | undefined {
  const kind: TransientKind | null =
    status === 429 ? "rate-limited" : status === 0 || status === 502 || status === 503 || status === 504 ? "unreachable" : null;
  if (!kind) return undefined;

  const wait = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? Math.ceil(retryAfterSeconds) : "";
  return `${DIGEST_PREFIX};${kind};${wait}`;
}

/**
 * A page whose stream was cut short reaches the boundary as one of two
 * errors, depending on which side noticed first. Next's own, when the page
 * had already ended by the time it started rendering: known by its code and —
 * should the code ever move — by its wording. Or React's "Connection closed."
 * for a payload that ended early, which is what Firefox produces when the
 * stop button is pressed mid-load; a production build minifies that message
 * to its number, 412, so both spellings are matched.
 */
const INTERRUPTED_CODE = "E117";
const INTERRUPTED_MESSAGE = /connection to the page was unexpectedly closed|^Connection closed\.?$|^Minified React error #412\b/i;

/** What kind of passing failure an error boundary caught, or null for a real one. */
export function classifyFailure(error: unknown): TransientFailure | null {
  if (typeof error !== "object" || error === null) return null;
  const { digest, message, __NEXT_ERROR_CODE: code } = error as { digest?: unknown; message?: unknown; __NEXT_ERROR_CODE?: unknown };

  if (typeof digest === "string" && digest.startsWith(`${DIGEST_PREFIX};`)) {
    const [, kind, wait] = digest.split(";");
    if (kind === "rate-limited" || kind === "unreachable") {
      const seconds = wait ? Number(wait) : NaN;
      return { kind, retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : null };
    }
  }

  if (code === INTERRUPTED_CODE || (typeof message === "string" && INTERRUPTED_MESSAGE.test(message))) {
    return { kind: "interrupted", retryAfterMs: null };
  }

  return null;
}

/** The longest a boundary will wait on the server's word before asking again. */
const MAX_WAIT_MS = 60_000;

/**
 * Waits before each automatic retry, by kind. An interrupted page has
 * nothing to wait for; a paced caller waits out what the server said, or a
 * widening guess when it said nothing; an unreachable server is given a
 * little longer each time. Short lists on purpose: past them the boundary
 * stops asking and leaves the button to the person.
 */
const SCHEDULE_MS: Record<TransientKind, number[]> = {
  interrupted: [300, 2_000],
  "rate-limited": [5_000, 15_000, 30_000],
  unreachable: [2_000, 5_000, 10_000],
};

/**
 * How long to wait before automatic retry number `attempt` (0 for the first),
 * or null once the screen has been retried as often as is useful.
 */
export function retryDelayMs(failure: TransientFailure, attempt: number): number | null {
  const fallback = SCHEDULE_MS[failure.kind][attempt];
  if (fallback === undefined) return null;
  if (failure.retryAfterMs === null) return fallback;

  // A second past what the server said: its window and this clock are not
  // the same clock, and arriving a moment early is another refusal.
  return Math.min(Math.max(failure.retryAfterMs, 0) + 1_000, MAX_WAIT_MS);
}
