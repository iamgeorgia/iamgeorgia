/**
 * The single door to the Express API.
 *
 * Two entry points, because the two halves of the App Router reach the server
 * differently. In the browser the session cookie rides along automatically once
 * `credentials: "include"` is set. On the server there is no ambient cookie
 * jar — a Server Component has to read the incoming request's cookies and
 * forward them explicitly, or every render would look unauthenticated.
 *
 * Nothing else in the app should call `fetch` against the API directly: this is
 * where the base URL, the credential mode and the error shape are decided once.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

/** The server's error envelope: `{ error: { message, details? } }`. */
export interface ApiErrorBody {
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  /** Zod issues, when the failure was a validation one. */
  get issues(): { path: (string | number)[]; message: string }[] {
    return Array.isArray(this.details)
      ? (this.details as { path: (string | number)[]; message: string }[])
      : [];
  }

  /** Flattens zod issues into `{ "company.email": "…" }` for a form. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const issue of this.issues) {
      const key = issue.path.join(".");
      if (key && !errors[key]) errors[key] = issue.message;
    }
    return errors;
  }
}

/**
 * The request never got an answer: the server was unreachable, the connection
 * dropped, or the timeout below fired first.
 *
 * A subclass rather than a sibling, so the `instanceof ApiError` checks across
 * the app keep working and the message is already the one to show. `status` is
 * 0 because there was no HTTP status — nothing on the other end spoke.
 */
export class NetworkError extends ApiError {
  readonly kind: "network" | "timeout";

  constructor(kind: "network" | "timeout", cause?: unknown) {
    super(
      0,
      kind === "timeout"
        ? "The server took too long to respond. Check your connection and try again."
        : "Could not reach the server. Check your connection and try again.",
    );
    this.name = "NetworkError";
    this.kind = kind;
    this.cause = cause;
  }
}

/** Wording for a failure the code did not anticipate — a bug, not a network. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Try again.";

/**
 * What to tell the person at the keyboard.
 *
 * An ApiError already carries the server's own wording (or, for a NetworkError,
 * a message about the connection), which beats anything invented at the call
 * site. Anything else is a thrown TypeError or similar — a bug rather than a
 * refusal — and gets the fallback, which a caller can specialise with domain
 * context ("Could not close those dates.").
 */
export function describeError(error: unknown, fallback = GENERIC_ERROR_MESSAGE): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * How long a call may wait for the API before it is declared lost.
 *
 * Generous, because image uploads and bulk repricing are real work; but finite,
 * because a Server Component awaiting a socket that will never answer holds
 * the whole page render open with it.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Overrides the default request timeout, for calls known to be slow. */
  timeoutMs?: number;
  /**
   * A body to send as-is, for multipart uploads.
   *
   * Kept separate from `body` because the two need opposite treatment: JSON
   * must be stringified and given a content-type, while FormData must be
   * neither — setting a content-type on it strips the multipart boundary the
   * browser generates, and the server then cannot parse a single field.
   */
  rawBody?: BodyInit;
  /** Forwarded cookie header, for calls made during a server render. */
  cookie?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    body,
    rawBody,
    cookie,
    headers,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...rest
  } = options;

  // One controller for both reasons to give up. A caller's own signal is
  // forwarded onto it rather than handed to fetch directly, so the timeout
  // still applies to a call that also wants to be cancellable.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  let response: Response;

  // Only the fetch itself is wrapped. `redirect()` and `notFound()` are thrown
  // by callers after this returns, and a NetworkError must never swallow one.
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      // The session is an httpOnly cookie, so it only travels cross-origin when
      // the request asks for it and the server allows it.
      credentials: "include",
      // The panel shows live records; a cached approval queue would be worse
      // than a slow one.
      cache: rest.cache ?? "no-store",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (caught) {
    if (timedOut) throw new NetworkError("timeout", caught);
    // The caller cancelled on purpose; that is their signal, not a failure to
    // report as one.
    if (signal?.aborted) throw caught;
    throw new NetworkError("network", caught);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  // Not everything that answers this fetch speaks the error envelope: a rate
  // limiter, a proxy's 502 page or a crashed process all reply in plain text
  // or HTML. Parsing defensively turns those into an ApiError the callers
  // already know how to handle, instead of a SyntaxError thrown mid-render.
  let payload: unknown = null;
  let parsed = true;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      parsed = false;
    }
  }

  if (!response.ok) {
    const error = parsed ? (payload as { error?: ApiErrorBody } | null)?.error : undefined;
    throw new ApiError(
      response.status,
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
    );
  }

  if (!parsed) {
    throw new ApiError(response.status, `Malformed response from ${path}`, text.slice(0, 200));
  }

  return payload as T;
}

/** Browser-side call. The session cookie is attached by the browser. */
export const apiFetch = request;

/**
 * Options for a public read that may be served from Next's data cache.
 *
 * Only for endpoints whose answer does not depend on who is asking — the
 * destination tree, transfer points and routes — and only through `apiFetch`,
 * because a forwarded cookie would make one visitor's answer everyone's.
 * The session-dependent catalogue (hotels, tours, packages, vehicles) must
 * keep going through `serverFetch` with its default `no-store`.
 */
export const cachedFor = (seconds: number): RequestOptions => ({
  cache: "force-cache",
  next: { revalidate: seconds },
});

/**
 * Server-side call, forwarding the viewer's cookies.
 *
 * `next/headers` is imported lazily so this module stays importable from
 * Client Components, which is what lets `apiFetch` and the types live together.
 */
export async function serverFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();

  return request<T>(path, { ...options, cookie: jar.toString() });
}

/** Runs a server call that is allowed to fail with 401/403, returning null. */
export async function serverFetchOptional<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T | null> {
  try {
    return await serverFetch<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
}
