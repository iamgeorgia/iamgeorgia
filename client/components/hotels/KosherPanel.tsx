"use client";

import { BadgeCheck, Check, FileText, Info, Mail, Phone } from "lucide-react";

import { KosherBadge } from "./KosherBadge";
import { kosherIcon } from "./kosherIcons";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { featureLabel, groupFeatures, kosherExpiryNote } from "@/lib/hotels/kosher";
import type { KosherProfile, NearbyPlace } from "@/types/catalogue";
import { dateTimeFormat } from "@/lib/intl";

/**
 * The kosher block on a hotel page.
 *
 * The layout carries the argument the data model makes: **one** line in here is
 * a verified claim, and it is rendered with the certified treatment; everything
 * below it is the property's own statement and says so in as many words. An
 * agent who reads only the ticks should still come away knowing which of them
 * anybody checked.
 *
 * Certification facts are shown to everyone. The scan is not — `documentAvailable`
 * says one exists, and reaching the bytes is a signed, audited request that a
 * public visitor has no session for.
 */

interface KosherPanelProps {
  kosher: KosherProfile;
  /** Nearby places, so a mikveh 400 m away can be named rather than merely ticked. */
  nearby?: NearbyPlace[];
  /** True for a signed-in partner or member of staff. */
  isTrade?: boolean;
}

/** Nearby entries worth pulling into this section rather than the map one. */
const RELIGIOUS_KINDS = new Set(["SYNAGOGUE", "MIKVEH", "KOSHER_RESTAURANT", "KOSHER_SHOP", "ERUV"]);

export function KosherPanel({ kosher, nearby = [], isTrade = false }: KosherPanelProps) {
  const { t, intlLocale } = useI18n();

  if (!kosher.offersKosher) return null;

  const formatDate = (iso: string) =>
    dateTimeFormat(intlLocale, { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(`${iso}T00:00:00Z`),
    );

  const certification = kosher.certification;
  const expiryNote = kosherExpiryNote(kosher, t, formatDate);
  const groups = groupFeatures(kosher.features);
  const religiousNearby = nearby.filter((place) => place.kind && RELIGIOUS_KINDS.has(place.kind));

  return (
    <section className="border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-4 sm:px-6">
        <h2 className="type-h3">{t.hotels.kosher.title}</h2>
        <p className="type-body-sm text-muted">
          {t.hotels.kosher.serviceLevel[kosher.serviceLevel]}
        </p>
      </header>

      <div className="px-5 py-5 sm:px-6">
        <KosherBadge kosher={kosher} className="text-[0.9375rem]" />

        {expiryNote && (
          <p
            className={`type-body-sm mt-1.5 ${
              kosher.certificationState === "EXPIRED" ? "text-error-text" : "text-warning-text"
            }`}
          >
            {expiryNote}
          </p>
        )}

        {/* --- the verified half ------------------------------------------- */}
        {certification && (
          <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
            <dt className="type-caption text-muted">{t.hotels.kosher.certification}</dt>
            <dd className="type-body-sm text-body">
              {certification.authorityWebsite ? (
                <a
                  href={certification.authorityWebsite}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-4 hover:text-ink"
                >
                  {certification.authorityName}
                </a>
              ) : (
                certification.authorityName
              )}
              {certification.reference && (
                <span className="text-subtle"> · {certification.reference}</span>
              )}
            </dd>

            <dt className="type-caption text-muted">{t.hotels.kosher.scopeLabel}</dt>
            <dd className="type-body-sm text-body">{t.hotels.kosher.scopes[certification.scope]}</dd>

            <dt className="type-caption text-muted">{t.hotels.kosher.validUntil}</dt>
            <dd className="type-body-sm text-body">
              {certification.expiresOn
                ? formatDate(certification.expiresOn)
                : t.hotels.kosher.noExpiry}
            </dd>

            {/* Who checked it, and when. An assurance nobody can attribute is
                not much of an assurance. */}
            {certification.verifiedAt && certification.state === "VERIFIED" && (
              <>
                <dt className="type-caption text-muted">
                  <BadgeCheck size={14} className="me-1 inline text-success" aria-hidden />
                </dt>
                <dd className="type-body-sm text-body">
                  {fill(t.hotels.kosher.verifiedOn, {
                    date: formatDate(certification.verifiedAt.slice(0, 10)),
                  })}
                </dd>
              </>
            )}

            {certification.documentAvailable && (
              <>
                <dt className="type-caption text-muted">
                  <FileText size={14} className="me-1 inline" aria-hidden />
                </dt>
                <dd className="type-body-sm text-muted">
                  {/* Never a link for a public visitor. The bytes live behind a
                      signed, audited request, and a certificate scan on an open
                      URL is a forgeable artefact. */}
                  {isTrade ? t.hotels.kosher.viewCertificate : t.hotels.kosher.certificateTradeOnly}
                </dd>
              </>
            )}
          </dl>
        )}

        {/* --- the declared half ------------------------------------------- */}
        {groups.length > 0 && (
          <div className="mt-7 space-y-6 border-t border-line pt-6">
            {groups.map(({ group, codes }) => (
              <div key={group}>
                <h3 className="type-eyebrow text-muted">{t.hotels.kosher.groups[group]}</h3>
                <ul className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {codes.map((code) => {
                    const Icon = kosherIcon(code);

                    return (
                      <li key={code} className="flex items-center gap-2.5">
                        <Icon size={15} className="shrink-0 text-brand-text" aria-hidden />
                        <span className="type-body-sm text-body">{featureLabel(t, code)}</span>
                      </li>
                    );
                  })}
                </ul>

                {/* Which synagogue, and how far on foot — the numbers a tick
                    cannot carry. Only shown against the group they belong to. */}
                {group === "Religious" && religiousNearby.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-s-2 border-line ps-4">
                    {religiousNearby.map((place) => (
                      <li key={`${place.kind}-${place.name}`} className="type-body-sm text-muted">
                        {place.name}
                        <span className="text-subtle">
                          {" · "}
                          {place.walkingMinutes !== undefined
                            ? fill(t.hotels.kosher.walkingMinutes, { count: place.walkingMinutes })
                            : place.distance}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {/* The line that keeps the section honest. Without it, twenty green
                ticks under a certified badge read as twenty certified facts. */}
            <p className="type-caption flex items-start gap-2 text-subtle">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
              {t.hotels.kosher.selfDeclared}
            </p>
          </div>
        )}

        {kosher.notes && (
          <div className="mt-7 border-t border-line pt-6">
            <h3 className="type-eyebrow text-muted">{t.hotels.kosher.notesHeading}</h3>
            <p className="type-body-sm mt-3 text-body">{kosher.notes}</p>
          </div>
        )}

        {(kosher.contact.email || kosher.contact.phone) && (
          <div className="mt-7 border-t border-line pt-6">
            <h3 className="type-eyebrow text-muted">{t.hotels.kosher.contact}</h3>
            <div className="type-body-sm mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              {kosher.contact.email && (
                <a
                  href={`mailto:${kosher.contact.email}`}
                  className="inline-flex items-center gap-2 text-body underline underline-offset-4 hover:text-ink"
                >
                  <Mail size={14} aria-hidden />
                  {kosher.contact.email}
                </a>
              )}
              {kosher.contact.phone && (
                <a
                  href={`tel:${kosher.contact.phone}`}
                  className="inline-flex items-center gap-2 text-body underline underline-offset-4 hover:text-ink"
                >
                  <Phone size={14} aria-hidden />
                  {kosher.contact.phone}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** A compact tick list, for anywhere the full panel is too much. */
export function KosherFeatureList({ codes }: { codes: string[] }) {
  const { t } = useI18n();

  if (codes.length === 0) return null;

  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {codes.map((code) => (
        <li key={code} className="flex items-center gap-2">
          <Check size={14} className="shrink-0 text-success" aria-hidden />
          <span className="type-body-sm text-body">{featureLabel(t, code)}</span>
        </li>
      ))}
    </ul>
  );
}
