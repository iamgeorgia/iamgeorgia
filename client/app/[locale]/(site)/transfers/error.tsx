"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";

/**
 * Segment error boundary. Anything that throws anywhere under `/transfers`
 * lands here rather than taking the whole app down, and the traveller is given
 * two ways forward instead of a blank page.
 */
export default function TransfersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const path = useLocalePath();
  const { t } = useI18n();

  useEffect(() => {
    // A live product would report this. Here it is the only place the console
    // should ever hear from the transfers section.
    console.error("Transfers section error:", error);
  }, [error]);

  return (
    <Container className="flex min-h-[60svh] flex-col items-center justify-center py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-soft text-error-text">
        <TriangleAlert size={24} aria-hidden />
      </span>

      <h1 className="type-h2 mt-6 max-w-lg text-balance">{t.transfers.error.title}</h1>
      <p className="type-body mt-4 max-w-md text-muted">{t.transfers.error.body}</p>

      {error.digest && (
        <p className="type-caption mt-4 text-subtle">
          {fill(t.transfers.error.reference, { digest: error.digest })}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>{t.actions.tryAgain}</Button>
        <Button href={path("/transfers")} variant="outline">
          {t.transfers.error.newSearch}
        </Button>
      </div>
    </Container>
  );
}
