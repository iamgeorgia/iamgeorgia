"use client";

import { AlertTriangle, Info, ShieldCheck, XCircle } from "lucide-react";

import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import type { KosherFinding, KosherPackageProfile } from "@/types/package";
import { cn } from "@/lib/utils";

interface KosherPanelProps {
  /** What a live quote found, when there is one. */
  kosher?: { blockers: KosherFinding[]; warnings: KosherFinding[]; overridden: boolean } | null;
  /** What the package promises, before any hotel is resolved. */
  profile?: KosherPackageProfile | null;
  className?: string;
}

/**
 * The kosher position on a package: what it promises, and what a quote found.
 *
 * Blockers and warnings are different in kind and are shown as such. A blocker
 * is why the trip cannot be sold as a kosher package at all; a warning is
 * something true that a traveller should know before booking — a certificate
 * expiring a fortnight after check-out, an arrival that lands inside Shabbat.
 * Warnings never hide, because the whole point of freezing them onto the order
 * is that nobody can later say they were not told.
 *
 * The message text comes from the server already worded for a human. The
 * dictionary supplies the surrounding chrome, not the findings themselves.
 */
export function KosherPanel({ kosher, profile, className }: KosherPanelProps) {
  const { t } = useI18n();

  const blockers = kosher?.blockers ?? [];
  const warnings = kosher?.warnings ?? [];

  if (!profile && blockers.length === 0 && warnings.length === 0) return null;

  return (
    <section className={cn("border border-line bg-surface-soft p-4", className)}>
      <h3 className="type-caption flex items-center gap-2 font-semibold tracking-wide text-ink uppercase">
        <ShieldCheck size={14} className="text-brand-text" aria-hidden />
        {t.packages.kosher.title}
      </h3>

      {profile && (
        <dl className="type-caption mt-3 flex flex-col gap-1.5">
          <Row label={t.packages.kosher.serviceLevel} value={profile.minServiceLevel} />
          <Row
            label={
              profile.certifiedRequired
                ? t.packages.kosher.certified
                : t.packages.kosher.certifiedNo
            }
            value={
              profile.certifiedRequired && profile.certificationScopes.length > 0
                ? profile.certificationScopes.join(", ")
                : ""
            }
          />
          {profile.requiredMealPlanCodes.length > 0 && (
            <Row
              label={t.packages.kosher.mealPlans}
              value={profile.requiredMealPlanCodes.join(", ")}
            />
          )}
          {profile.supervisionAuthority && (
            <Row label={t.packages.kosher.supervision} value={profile.supervisionAuthority} />
          )}
        </dl>
      )}

      {profile && (
        <div className="type-caption mt-3 border-t border-line pt-3 text-muted">
          <p className="font-semibold text-body">{t.packages.kosher.shabbat}</p>
          <p className="mt-1">
            {profile.shabbatMode === "SOLAR"
              ? fill(t.packages.kosher.shabbatSolar, {
                  before: profile.candleLightingOffsetMin,
                  after: profile.havdalahOffsetMin,
                })
              : profile.shabbatMode === "FIXED_HOURS"
                ? fill(t.packages.kosher.shabbatFixed, {
                    start: profile.shabbatFixedStart ?? "—",
                    end: profile.shabbatFixedEnd ?? "—",
                  })
                : t.packages.kosher.shabbatNone}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {profile.noTransfersInShabbat && <li>· {t.packages.kosher.noTransfers}</li>}
            {profile.noToursOnShabbat && <li>· {t.packages.kosher.noTours}</li>}
          </ul>
          {profile.extraRestDays.length > 0 && (
            <p className="mt-1.5">
              {t.packages.kosher.restDays}:{" "}
              {profile.extraRestDays
                .map((day) => day.label ?? `${day.from} – ${day.to}`)
                .join(", ")}
            </p>
          )}
          {profile.hotelRequestCodes.length > 0 && (
            <p className="mt-1.5">
              {fill(t.packages.kosher.requestsAttached, {
                items: profile.hotelRequestCodes.join(", "),
              })}
            </p>
          )}
        </div>
      )}

      {blockers.length > 0 && (
        <Findings
          tone="blocker"
          title={t.packages.kosher.blockersTitle}
          findings={blockers}
          icon={XCircle}
        />
      )}

      {warnings.length > 0 && (
        <Findings
          tone="warning"
          title={t.packages.kosher.warningsTitle}
          findings={warnings}
          icon={AlertTriangle}
        />
      )}

      {kosher?.overridden && (
        <p className="type-caption mt-3 flex items-start gap-2 border-t border-line pt-3 text-muted">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
          {t.packages.kosher.overridden}
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-end text-body">{value}</dd>
    </div>
  );
}

function Findings({
  tone,
  title,
  findings,
  icon: Icon,
}: {
  tone: "blocker" | "warning";
  title: string;
  findings: KosherFinding[];
  icon: typeof XCircle;
}) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p
        className={cn(
          "type-caption flex items-center gap-1.5 font-semibold",
          tone === "blocker" ? "text-brand-text" : "text-body",
        )}
      >
        <Icon size={13} aria-hidden />
        {title}
      </p>
      <ul className="type-caption mt-1.5 flex flex-col gap-1 text-muted">
        {findings.map((finding, index) => (
          // Findings have no id and the same code can appear for two slots.
          <li key={`${finding.code}-${finding.slotIndex ?? index}`}>· {finding.message}</li>
        ))}
      </ul>
    </div>
  );
}
