"use client";

import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { describeError } from "@/lib/api/client";
import { acceptTerms } from "@/lib/api/partners";
import { useLocalePath } from "@/lib/i18n/provider";

/**
 * The owner's acceptance of a platform terms version.
 *
 * The version being accepted travels with the request, so if the terms move on
 * between the page loading and the click the server refuses rather than record
 * agreement to text the owner has not seen.
 */
export function PortalTermsAccept({ version }: { version: string }) {
  const router = useRouter();
  const path = useLocalePath();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);

    try {
      await acceptTerms(version);
      router.replace(path("/portal/dashboard"));
      router.refresh();
    } catch (caught) {
      setError(describeError(caught, "Could not record your acceptance. Try again."));
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-4 border-t border-line pt-6">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-brand"
        />
        <span className="text-[0.9375rem] leading-snug text-body">
          I have read the platform terms (version {version}) and accept them on behalf of my company.
        </span>
      </label>

      {error && (
        <p role="alert" className="text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!checked || busy}
        onClick={accept}
        className="inline-flex h-12 items-center gap-2 rounded-sm bg-brand px-6 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
        Accept the terms
      </button>
    </div>
  );
}
