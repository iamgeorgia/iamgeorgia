import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  AlertTriangle,
  ArrowRight,
  CalculatorIcon,
  ExternalLink,
  ImageIcon,
  Languages,
  Layers,
  ShieldCheck,
} from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { HotelStatusBadge } from "@/components/admin/HotelStatusBadge";
import { PackageActions } from "@/components/admin/PackageActions";
import { ApiError } from "@/lib/api/client";
import { getPackage } from "@/lib/api/packages";
import {
  adjustmentKindLabels,
  adjustmentScopeLabels,
  componentTypeLabels,
  packageCardImage,
} from "@/lib/admin/packages";
import { formatBps, formatMoney } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import type { PackageComponent } from "@/types/package";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Package" };

/** What a slot is pinned to, in one phrase, for the summary table. */
const slotTarget = (component: PackageComponent): string => {
  switch (component.componentType) {
    case "HOTEL_STAY":
      return component.hotel?.name ?? "Any hotel at the destination";
    case "TRANSFER":
      return component.route
        ? component.route.title
        : component.fromPoint && component.toPoint
          ? `${component.fromPoint.name} → ${component.toPoint.name}`
          : "—";
    case "TOUR":
      return component.tour?.title ?? "—";
    case "SERVICE":
    default:
      return component.service?.name ?? "—";
  }
};

/** How the adjustment reads, given what its value means for its kind. */
const adjustmentSummary = (pkg: {
  adjustment?: { kind: string; value: number; appliesTo: string };
  currency: string;
}): string => {
  const adjustment = pkg.adjustment;

  if (!adjustment || adjustment.kind === "NONE") return "None";

  const value =
    adjustment.kind === "DISCOUNT_BPS"
      ? formatBps(adjustment.value)
      : formatMoney(adjustment.value, pkg.currency);

  return `${adjustmentKindLabels[adjustment.kind as keyof typeof adjustmentKindLabels]} · ${value} · ${
    adjustmentScopeLabels[adjustment.appliesTo as keyof typeof adjustmentScopeLabels]
  }`;
};

/**
 * One package: the hub its sub-screens hang off.
 *
 * The segment is `[slug]` but takes the id or the slug — the API accepts
 * either. Two checklists sit in the sidebar and they answer different
 * questions: the publish checklist is what is missing, and the kosher
 * eligibility is what is *wrong* with hotels the template already names,
 * re-judged against live certificates on every read.
 */
export default async function AdminPackagePage({
  params,
}: PageProps<"/[locale]/admin/packages/[slug]">) {
  await requireScreen();
  const { slug } = await params;
  const { path } = await getI18n();

  let pkg;

  try {
    pkg = await getPackage(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const cover = packageCardImage(pkg);
  const blockers = pkg.kosherEligibility?.blockers ?? [];
  const warnings = pkg.kosherEligibility?.warnings ?? [];

  const subScreens = [
    {
      href: `/admin/packages/${pkg.id}/components`,
      icon: Layers,
      title: "Parts",
      description:
        pkg.components.length > 0
          ? `${pkg.components.length} slots, and what each may be filled with`
          : "No slots yet — a package needs at least one",
    },
    {
      href: `/admin/packages/${pkg.id}/details`,
      icon: ArrowRight,
      title: "Details & pricing",
      description: "Name, dates, party limits and the adjustment",
    },
    {
      href: `/admin/packages/${pkg.id}/preview`,
      icon: CalculatorIcon,
      title: "Preview a quote",
      description: "The real engine, run as staff, on any date",
    },
    {
      href: `/admin/packages/${pkg.id}/kosher`,
      icon: ShieldCheck,
      title: "Kosher",
      description: pkg.kosherProfile ? "Profile set — rules and Shabbat" : "Not a kosher package",
    },
    {
      href: `/admin/packages/${pkg.id}/images`,
      icon: ImageIcon,
      title: "Images",
      description: `${pkg.images.length} in the gallery`,
    },
    {
      href: `/admin/packages/${pkg.id}/translations`,
      icon: Languages,
      title: "Translations",
      description: "Georgian, Russian and Hebrew prose",
    },
  ];

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Packages", href: path("/admin/packages") }, { label: pkg.name }]}
      />

      <AdminPageHeader
        title={pkg.name}
        description={`${pkg.nights} nights · ${pkg.componentCount} parts · ${pkg.destination?.name ?? "no destination"}`}
        actions={
          <div className="flex items-center gap-3">
            {pkg.status === "ACTIVE" && (
              <Link
                href={path(`/packages/${pkg.slug}`)}
                className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
              >
                <ExternalLink size={15} aria-hidden />
                View live page
              </Link>
            )}
            {pkg.status && <HotelStatusBadge status={pkg.status} />}
          </div>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-6 lg:col-span-2">
          <nav aria-label="Package sections" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subScreens.map((screen) => (
              <Link
                key={screen.href}
                href={path(screen.href)}
                className="group rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink"
              >
                <screen.icon size={18} className="text-brand-text" aria-hidden />
                <p className="mt-3 flex items-center gap-1 font-medium text-ink">
                  {screen.title}
                  <ArrowRight
                    size={14}
                    aria-hidden
                    className="opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100"
                  />
                </p>
                <p className="mt-1 text-[0.8125rem] text-muted">{screen.description}</p>
              </Link>
            ))}
          </nav>

          <AdminPanel title="Package">
            <AdminDefinitionList
              items={[
                { label: "Slug", value: pkg.slug },
                {
                  label: "Destination",
                  value: pkg.destination
                    ? `${pkg.destination.name} (${pkg.destination.path})`
                    : "—",
                },
                { label: "Nights", value: String(pkg.nights) },
                { label: "Currency", value: pkg.currency },
                { label: "Time zone", value: pkg.timezone },
                {
                  label: "Party",
                  value: `${pkg.party.minAdults}+ adults${pkg.party.maxPax ? `, up to ${pkg.party.maxPax} travellers` : ""}`,
                },
                {
                  label: "Travel window",
                  value:
                    pkg.validFrom || pkg.validUntil
                      ? `${pkg.validFrom ?? "any"} to ${pkg.validUntil ?? "any"}`
                      : "Unrestricted",
                },
                {
                  label: "On sale",
                  value:
                    pkg.sellableFrom || pkg.sellableUntil
                      ? `${pkg.sellableFrom ?? "any"} to ${pkg.sellableUntil ?? "any"}`
                      : "Unrestricted",
                },
                { label: "Adjustment", value: adjustmentSummary(pkg) },
                {
                  label: "From price",
                  value: pkg.priceFrom
                    ? `${formatMoney(pkg.priceFrom.amountCents, pkg.priceFrom.currency)} (sampled)`
                    : "Not sampled yet",
                },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Parts" bodyClassName="p-0">
            <DataTable
              columns={[
                { label: "#", align: "end" },
                { label: "Slot" },
                { label: "Type", hideBelow: "md" },
                { label: "Pinned to" },
                { label: "Day", align: "end", hideBelow: "md" },
              ]}
              caption="The slots this package is assembled from"
            >
              {pkg.components.length === 0 ? (
                <EmptyRow
                  colSpan={5}
                  message="No slots yet. A package needs at least one required part before it can be published."
                />
              ) : (
                pkg.components.map((component) => (
                  <Row key={component.slotIndex}>
                    <Cell align="end" className="tabular-nums text-muted">
                      {component.slotIndex}
                    </Cell>
                    <Cell>
                      <Link
                        href={path(`/admin/packages/${pkg.id}/components`)}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {component.label}
                      </Link>
                      {!component.required && (
                        <span className="ms-2 text-[0.75rem] text-muted">optional</span>
                      )}
                    </Cell>
                    <Cell hideBelow="md">{componentTypeLabels[component.componentType]}</Cell>
                    <Cell>{slotTarget(component)}</Cell>
                    <Cell align="end" className="tabular-nums" hideBelow="md">
                      {component.dayOffset === 0 ? "arrival" : `+${component.dayOffset}`}
                      {component.nights ? ` · ${component.nights}n` : ""}
                    </Cell>
                  </Row>
                ))
              )}
            </DataTable>
          </AdminPanel>
        </div>

        <div className="flex flex-col gap-6">
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element -- editorial or API-served
            <img src={cover} alt={pkg.name} className="aspect-4/3 w-full rounded-sm object-cover" />
          )}

          <AdminPanel
            title="Publishing"
            description={
              pkg.publishChecklist.length === 0
                ? "Everything required is in place."
                : "What still stands between this package and going on sale."
            }
          >
            {pkg.publishChecklist.length > 0 && (
              <ul className="mb-4 space-y-2">
                {pkg.publishChecklist.map((item) => (
                  <li key={item.code} className="flex items-start gap-2 text-[0.8125rem] text-body">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                    {item.message}
                  </li>
                ))}
              </ul>
            )}
            <PackageActions pkg={pkg} />
          </AdminPanel>

          {pkg.kosherProfile && (blockers.length > 0 || warnings.length > 0) && (
            <AdminPanel
              title="Kosher eligibility"
              description="Re-checked against live certificates every time this page loads."
            >
              {blockers.length > 0 && (
                <>
                  <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-error-text">
                    <AlertTriangle size={14} aria-hidden />
                    Cannot be sold as kosher
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {blockers.map((finding, index) => (
                      // A code can repeat across slots, so it is not a key on its own.
                      <li
                        key={`${finding.code}-${finding.slotIndex ?? index}`}
                        className="text-[0.8125rem] text-body"
                      >
                        · {finding.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {warnings.length > 0 && (
                <>
                  <p
                    className={`flex items-center gap-1.5 text-[0.8125rem] font-semibold text-body ${blockers.length > 0 ? "mt-4" : ""}`}
                  >
                    Worth knowing
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {warnings.map((finding, index) => (
                      <li
                        key={`${finding.code}-${finding.slotIndex ?? index}`}
                        className="text-[0.8125rem] text-muted"
                      >
                        · {finding.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </AdminPanel>
          )}
        </div>
      </div>
    </AdminContainer>
  );
}
