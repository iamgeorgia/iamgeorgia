"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";

/**
 * The public site's error boundary. Anything that throws under `(site)` —
 * an API that has gone away mid-render, a timeout, a bug — lands here with
 * the header and footer still standing, rather than in the bare root-level
 * page. Sections with something more specific to say (transfers) keep their
 * own boundary nearer the failure.
 *
 * `retry` rather than `reset`: a failed server fetch needs the segment
 * re-fetched, not just re-rendered from the same broken payload.
 */
export default function SiteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const path = useLocalePath();
  const { t } = useI18n();

  useEffect(() => {
    // A live product would report this. Here it is the only place the console
    // should ever hear from the public site.
    console.error("Site error:", error);
  }, [error]);

  return (
    <Container className="flex min-h-[60svh] flex-col items-center justify-center py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-soft text-error-text">
        <TriangleAlert size={24} aria-hidden />
      </span>

      <h1 className="type-h2 mt-6 max-w-lg text-balance">{t.error.title}</h1>
      <p className="type-body mt-4 max-w-md text-muted">{t.error.body}</p>

      {error.digest && (
        <p className="type-caption mt-4 text-subtle">
          {fill(t.error.reference, { digest: error.digest })}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => retry()}>{t.actions.tryAgain}</Button>
        <Button href={path("/")} variant="outline">
          {t.actions.backHome}
        </Button>
      </div>
    </Container>
  );
}
