import { notFound } from "next/navigation";

/**
 * Anything under a locale that no other route claims ends here, which routes
 * it to the branded `(site)/not-found.tsx` rather than the bare root one. A
 * static or more specific segment always wins over a catch-all, so this can
 * never shadow a real page — and it fires before any Suspense boundary, so
 * the response is a genuine 404, not a streamed 200.
 */
export default function CatchAllPage(): never {
  notFound();
}
