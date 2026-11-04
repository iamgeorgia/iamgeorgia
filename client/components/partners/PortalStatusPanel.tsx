import type { LucideIcon } from "lucide-react";

import { formatPartnerDate, partnerKindLabels } from "@/lib/admin/partners";
import { cn } from "@/lib/utils";
import type { Partner } from "@/types";

type Tone = "info" | "attention" | "critical";

const tones: Record<Tone, string> = {
  info: "bg-info/12 text-info",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
};

/**
 * The "application under review" page, and its siblings.
 *
 * A partner who cannot get in still deserves to see that we hold their record
 * and what state it is in — the Partner ID especially, because it is what they
 * quote when they call. What they do not get is anything from behind the gate:
 * this renders from the session's own partner record, which the server already
 * limited to what a partner may see about itself.
 */
export function PortalStatusPanel({
  icon: Icon,
  tone,
  title,
  body,
  note,
  partner,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  body: string;
  note: string | null;
  partner: Partner;
}) {
  return (
    <section className="rounded-md border border-line bg-surface p-6 sm:p-8">
      <span className={cn("inline-flex size-12 items-center justify-center rounded-full", tones[tone])}>
        <Icon size={24} aria-hidden />
      </span>

      <h1 className="mt-5 font-display text-[1.5rem] leading-[1.25] font-normal text-ink sm:text-[1.75rem]">{title}</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{body}</p>

      {note && (
        <div className="mt-5 rounded-sm border border-line bg-background p-4">
          <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
            What we were told
          </p>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-body">{note}</p>
        </div>
      )}

      <dl className="mt-8 divide-y divide-line border-t border-line">
        {[
          { label: "Partner ID", value: <span className="font-mono">{partner.reference}</span> },
          { label: "Company", value: partner.name },
          { label: "Type", value: partnerKindLabels[partner.kind] },
          {
            label: "Submitted",
            value: formatPartnerDate(partner.submittedAt ?? partner.createdAt),
          },
        ].map((item) => (
          <div
            key={item.label}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
          >
            <dt className="text-[0.8125rem] text-muted">{item.label}</dt>
            <dd className="min-w-0 text-end text-[0.875rem] font-medium text-ink wrap-anywhere">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
