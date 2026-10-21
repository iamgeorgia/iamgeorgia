import Link from "next/link";
import { ShieldOff } from "lucide-react";

import { AdminContainer } from "@/components/admin/AdminPage";
import { capabilityLabel } from "@/lib/admin/capabilities";

/**
 * What a viewer sees when they open a screen their role does not.
 *
 * Inside the shell, so the sidebar — which never offered the screen — stays
 * and the operator can carry on. Says *which* capability the screen needs,
 * in the words the Roles editor uses, so the message is actionable: the
 * person who hands out roles can read it and know what to grant. Never says
 * whether the record exists, because this page is reached before anything
 * was read.
 */
export function AccessDenied({
  path,
  required,
  needs,
}: {
  /** The canonical path that was refused, for the heading. */
  path?: string | null;
  /** The capabilities any one of which would have opened it. */
  required: readonly string[];
  /** Localised link helper. */
  needs: (href: string) => string;
}) {
  const labels = required.map(capabilityLabel);

  return (
    <AdminContainer>
      <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-line bg-surface-soft/40 px-6 py-24 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-background text-brand-text">
          <ShieldOff size={24} aria-hidden />
        </span>

        <h1 className="mt-6 font-display text-2xl text-ink">This screen is not part of your role</h1>
        <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-muted">
          {labels.length > 0 ? (
            <>
              Opening {path ? <code className="rounded-sm bg-background px-1.5 py-0.5 text-[0.8125rem]">{path}</code> : "it"} needs{" "}
              {labels.length === 1 ? (
                <strong className="font-medium text-ink">{labels[0]}</strong>
              ) : (
                <>
                  one of:{" "}
                  {labels.map((label, index) => (
                    <span key={label}>
                      <strong className="font-medium text-ink">{label}</strong>
                      {index < labels.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </>
              )}
              . Whoever manages roles can grant it.
            </>
          ) : (
            <>
              {path ? <code className="rounded-sm bg-background px-1.5 py-0.5 text-[0.8125rem]">{path}</code> : "That address"} is not a
              screen this panel knows. Check the address, or start from the overview.
            </>
          )}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={needs("/admin")}
            className="inline-flex h-11 items-center rounded-sm bg-brand px-5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Back to overview
          </Link>
          <Link
            href={needs("/admin/help/getting-started/gs-roles")}
            className="inline-flex h-11 items-center rounded-sm border border-ink/20 px-5 text-[0.875rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
          >
            What each role sees
          </Link>
        </div>
      </div>
    </AdminContainer>
  );
}
