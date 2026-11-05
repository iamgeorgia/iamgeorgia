"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { PortalContainer, PortalMessage } from "@/components/partners/PortalPage";
import { Button } from "@/components/ui/Button";
import { failureCopy } from "@/lib/errors/failureCopy";
import { useAutoRetry } from "@/lib/errors/useAutoRetry";
import { useLocalePath } from "@/lib/i18n/provider";

/**
 * The partner platform's error boundary. Sits inside the portal shell, so a
 * dashboard or booking page that fails to render is replaced by this while the
 * navigation and the sign-out button stay where they were. A failure in the
 * shell itself is rarer and falls through to the root-level `global-error`.
 *
 * `retry` rather than `reset`: the pages here are server-rendered from the
 * API, and re-rendering the same failed payload would only fail the same way.
 *
 * A load cut short, a paced burst of refreshes and an API that did not answer
 * pass by themselves, so those are named and retried without being asked
 * (`useAutoRetry`), as in the admin panel.
 */
export default function PortalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const path = useLocalePath();
  const copy = failureCopy(useAutoRetry(error, retry), "page");

  useEffect(() => {
    // A live product would report this. Here it is the only place the console
    // should ever hear from the portal.
    console.error("Portal error:", error);
  }, [error]);

  return (
    <PortalContainer narrow>
      <PortalMessage
        icon={TriangleAlert}
        tone="critical"
        title={copy?.title ?? "This page could not load"}
        className="max-w-2xl"
        actions={
          <>
            <Button onClick={() => retry()}>Try again</Button>
            <Button href={path("/portal/dashboard")} variant="outline">
              Dashboard
            </Button>
          </>
        }
      >
        <p>
          {copy?.body ??
            "The records behind it did not come back. Nothing has been changed on any booking — try again, or go back to the dashboard."}
        </p>
        {copy?.status && (
          <p role="status" className="mt-2 font-medium">
            {copy.status}
          </p>
        )}
        {error.digest && !copy && <p className="mt-2 text-[0.8125rem] text-subtle">Reference: {error.digest}</p>}
      </PortalMessage>
    </PortalContainer>
  );
}
