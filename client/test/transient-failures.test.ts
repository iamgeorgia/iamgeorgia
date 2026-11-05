import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ApiError, NetworkError } from "@/lib/api/client";
import { classifyFailure, retryDelayMs, transientDigest } from "@/lib/errors/transient";

/**
 * The contract between the API client and the panels' error boundaries: which
 * failures pass by themselves, how one survives the trip through a server
 * render (as a digest), and how often a boundary asks again before it stops.
 */
describe("transient failures", () => {
  it("stamps a digest on the API pacing the caller or not answering, and on nothing else", () => {
    assert.equal(transientDigest(429, 12), "IAG_TRANSIENT;rate-limited;12");
    assert.equal(transientDigest(429), "IAG_TRANSIENT;rate-limited;");
    assert.equal(transientDigest(503, null), "IAG_TRANSIENT;unreachable;");
    assert.equal(transientDigest(0), "IAG_TRANSIENT;unreachable;");

    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      assert.equal(transientDigest(status), undefined, String(status));
    }
  });

  it("is what the API client's errors carry", () => {
    assert.equal(new ApiError(429, "Too many requests. Try again shortly.", undefined, 30).digest, "IAG_TRANSIENT;rate-limited;30");
    assert.equal(new NetworkError("timeout").digest, "IAG_TRANSIENT;unreachable;");
    assert.equal(new ApiError(404, "Not found").digest, undefined);
    assert.equal(new ApiError(500, "Internal server error").digest, undefined);
  });

  it("reads the digest back on the other side of a server render, where the message is gone", () => {
    const stripped = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "IAG_TRANSIENT;rate-limited;30" });
    assert.deepEqual(classifyFailure(stripped), { kind: "rate-limited", retryAfterMs: 30_000 });

    const unreachable = Object.assign(new Error("…"), { digest: "IAG_TRANSIENT;unreachable;" });
    assert.deepEqual(classifyFailure(unreachable), { kind: "unreachable", retryAfterMs: null });
  });

  it("recognises a page whose stream was cut short", () => {
    const stopped = Object.defineProperty(
      new Error("The connection to the page was unexpectedly closed, possibly due to the stop button being clicked, loss of Wi-Fi, or an unstable internet connection."),
      "__NEXT_ERROR_CODE",
      { value: "E117", enumerable: false },
    );
    assert.deepEqual(classifyFailure(stopped), { kind: "interrupted", retryAfterMs: null });
    // By wording alone, should the code ever change; and React's own.
    assert.equal(classifyFailure(new Error(stopped.message))?.kind, "interrupted");
    assert.equal(classifyFailure(new Error("Connection closed."))?.kind, "interrupted");
    // The same error as a production build words it.
    assert.equal(
      classifyFailure(new Error("Minified React error #412; visit https://react.dev/errors/412 for the full message or use the non-minified dev environment for full errors and additional helpful warnings."))?.kind,
      "interrupted",
    );
    assert.equal(classifyFailure(new Error("Minified React error #4120; visit https://react.dev/errors/4120"))?.kind, undefined);
    assert.equal(classifyFailure(new Error("Minified React error #441; visit https://react.dev/errors/441"))?.kind, undefined);
  });

  it("leaves a real failure alone", () => {
    assert.equal(classifyFailure(new Error("Cannot read properties of undefined")), null);
    assert.equal(classifyFailure(Object.assign(new Error("…"), { digest: "2841907563" })), null);
    assert.equal(classifyFailure(Object.assign(new Error("…"), { digest: "IAG_TRANSIENT;something-else;" })), null);
    assert.equal(classifyFailure(null), null);
    assert.equal(classifyFailure("Connection closed."), null);
  });

  it("retries an interrupted load at once, and gives up after two", () => {
    const failure = { kind: "interrupted", retryAfterMs: null } as const;
    assert.equal(retryDelayMs(failure, 0), 300);
    assert.equal(retryDelayMs(failure, 1), 2_000);
    assert.equal(retryDelayMs(failure, 2), null);
  });

  it("waits out what the server said, a second over, and never more than a minute", () => {
    assert.equal(retryDelayMs({ kind: "rate-limited", retryAfterMs: 12_000 }, 0), 13_000);
    assert.equal(retryDelayMs({ kind: "rate-limited", retryAfterMs: 0 }, 0), 1_000);
    assert.equal(retryDelayMs({ kind: "rate-limited", retryAfterMs: 900_000 }, 1), 60_000);
    // Told nothing, it widens its own guess…
    assert.deepEqual(
      [0, 1, 2].map((attempt) => retryDelayMs({ kind: "rate-limited", retryAfterMs: null }, attempt)),
      [5_000, 15_000, 30_000],
    );
    // …and either way stops after three, whatever the server keeps saying.
    assert.equal(retryDelayMs({ kind: "rate-limited", retryAfterMs: 12_000 }, 3), null);
    assert.equal(retryDelayMs({ kind: "unreachable", retryAfterMs: null }, 3), null);
  });
});
