"use client";

import Link from "next/link";
import { ExternalLink, FileText, Loader2 } from "lucide-react";

import { PortalPanel } from "@/components/partners/PortalPage";
import { useState } from "react";

import { ApiError, describeError } from "@/lib/api/client";
import { getOwnContractLink } from "@/lib/api/partners";
import { formatPartnerDate } from "@/lib/admin/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import type { Partner } from "@/types";

/**
 * The two documents a partner is bound by: the platform terms it accepted, and
 * the contract we hold for it. Shown on the settings page; the PDF is fetched
 * as a short-lived signed link each time, never stored on the page.
 */
export function PortalAgreements({ partner }: { partner: Partner }) {
  const path = useLocalePath();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { contract, terms } = partner;

  const openContract = async () => {
    setOpening(true);
    setError(null);
    // Opened inside the click so a popup blocker lets it through.
    const tab = window.open("", "_blank");
    try {
      const link = await getOwnContractLink();
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.location.href = link.url;
      }
    } catch (caught) {
      tab?.close();
      setError(
        caught instanceof ApiError && caught.status === 404
          ? "There is no contract on file yet."
          : describeError(caught, "Could not open the contract."),
      );
    } finally {
      setOpening(false);
    }
  };

  if (!contract && !terms) return null;

  return (
    <PortalPanel
      id="agreements"
      title="Agreements"
      description="The terms you accepted and the contract we hold for your company."
    >
      <dl className="divide-y divide-line text-[0.875rem]">
        {terms && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
            <dt className="text-muted">Platform terms</dt>
            <dd className="text-end text-ink">
              {terms.acceptedVersion
                ? `Version ${terms.acceptedVersion}, accepted ${formatPartnerDate(terms.acceptedAt)}`
                : "Not accepted yet"}{" "}
              <Link
                href={path("/portal/terms")}
                className="ms-2 text-brand-text underline-offset-4 hover:underline"
              >
                {terms.outdated ? "Review and accept" : "View"}
              </Link>
            </dd>
          </div>
        )}
        {contract && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
            <dt className="text-muted">Contract</dt>
            <dd className="text-end text-ink">
              {contract.onFile ? (
                <button
                  type="button"
                  onClick={openContract}
                  disabled={opening}
                  className="inline-flex min-h-9 items-center gap-1.5 text-start text-brand-text underline-offset-4 hover:underline disabled:opacity-60"
                >
                  {opening ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <ExternalLink size={14} aria-hidden />
                  )}
                  Open contract
                  {contract.signedAt ? ` (signed ${formatPartnerDate(contract.signedAt)})` : ""}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <FileText size={14} aria-hidden />
                  {contract.required ? "Not on file yet" : "Not required for your company"}
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}
    </PortalPanel>
  );
}
