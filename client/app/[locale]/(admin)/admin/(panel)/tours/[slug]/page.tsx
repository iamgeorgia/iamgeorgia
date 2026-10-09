import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, CalendarDays, ExternalLink, FileText, ImageIcon, Languages, Tags, Wallet } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { HotelStatusBadge } from "@/components/admin/HotelStatusBadge";
import { TourBookingStatusBadge } from "@/components/admin/StatusBadge";
import { TourActions } from "@/components/admin/TourActions";
import { getTour, listAdminTourBookings } from "@/lib/api/tours";
import { ApiError } from "@/lib/api/client";
import {
  categoryLabel,
  confirmationModeLabels,
  formatDeparture,
  optionKindLabels,
  pricingBasisLabels,
  tourCardImage,
} from "@/lib/admin/tours";
import { formatMoney } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { can } from "@/types/auth";
import type { TourBookingSummary } from "@/types/tour";

export const metadata: Metadata = { title: "Tour" };

/**
 * One tour: the hub its sub-screens hang off.
 *
 * The segment is `[slug]` but takes the id or the slug — the API accepts
 * either. The publish checklist travels with the record, so the page shows
 * exactly what stands between a draft and going on sale.
 */
export default async function AdminTourPage({ params }: PageProps<"/[locale]/admin/tours/[slug]">) {
  const { slug } = await params;
  const [{ path }, session] = await Promise.all([getI18n(), getSession()]);

  let tour;

  try {
    tour = await getTour(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Recent bookings are decoration on the hub; a failure there must not take
  // the tour page down.
  let recent: TourBookingSummary[] = [];

  try {
    recent = (await listAdminTourBookings({ tourId: tour.id, pageSize: 5 })).data;
  } catch (error) {
    console.error("Tour bookings failed:", error);
  }

  const cover = tourCardImage(tour);
  const options = tour.options.filter((option) => option.status !== "ARCHIVED");

  const subScreens = [
    {
      href: `/admin/tours/${tour.id}/options`,
      icon: Tags,
      title: "Options & prices",
      description: `${options.length} ${options.length === 1 ? "option" : "options"}, with their price sheets`,
    },
    {
      href: `/admin/tours/${tour.id}/departures`,
      icon: CalendarDays,
      title: "Departures",
      description: "Capacity per date, and the bulk editor",
    },
    {
      href: `/admin/tours/${tour.id}/details`,
      icon: FileText,
      title: "Details & itinerary",
      description: tour.itinerary.length > 0 ? `${tour.itinerary.length}-day itinerary` : "Itinerary still to write",
    },
    {
      href: `/admin/tours/${tour.id}/images`,
      icon: ImageIcon,
      title: "Images",
      description: `${tour.images.length} in the gallery`,
    },
    {
      href: `/admin/tours/${tour.id}/translations`,
      icon: Languages,
      title: "Translations",
      description: "Georgian, Russian and Hebrew prose",
    },
    ...(can(session, "finance.payables.read", "catalogue.write")
      ? [
          {
            href: `/admin/finance/terms/tours/${tour.id}`,
            icon: Wallet,
            title: "Payment terms",
            description: "When the operator is paid, and what it is owed after a cancellation",
          },
        ]
      : []),
  ];

  return (
    <AdminContainer>
      <AdminBreadcrumbs items={[{ label: "Tours", href: path("/admin/tours") }, { label: tour.title }]} />

      <AdminPageHeader
        title={tour.title}
        description={`${categoryLabel(tour.category)} · ${tour.durationLabel} · ${tour.location}`}
        actions={
          <div className="flex items-center gap-3">
            {tour.status === "ACTIVE" && (
              <Link
                href={path(`/tours/${tour.slug}`)}
                className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
              >
                <ExternalLink size={15} aria-hidden />
                View live page
              </Link>
            )}
            {tour.status && <HotelStatusBadge status={tour.status} />}
          </div>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-6 lg:col-span-2">
          <nav aria-label="Tour sections" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subScreens.map((screen) => (
              <Link
                key={screen.href}
                href={path(screen.href)}
                className="group rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink"
              >
                <screen.icon size={18} className="text-brand-text" aria-hidden />
                <p className="mt-3 flex items-center gap-1 font-medium text-ink">
                  {screen.title}
                  <ArrowRight size={14} aria-hidden className="opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" />
                </p>
                <p className="mt-1 text-[0.8125rem] text-muted">{screen.description}</p>
              </Link>
            ))}
          </nav>

          <AdminPanel title="Tour">
            <AdminDefinitionList
              items={[
                { label: "Slug", value: tour.slug },
                { label: "Destination", value: tour.destination ? `${tour.destination.name} (${tour.destination.path})` : "—" },
                { label: "Currency", value: tour.currency },
                { label: "Time zone", value: tour.timezone },
                { label: "Meeting", value: `${tour.meetingPoint}${tour.meetingTime ? ` at ${tour.meetingTime}` : ""}` },
                { label: "Ages", value: `infants to ${tour.ages.infantMaxAge}, children to ${tour.ages.childMaxAge}${tour.minAge !== null ? `, minimum ${tour.minAge}` : ""}` },
                { label: "Supplier", value: tour.supplier?.name ?? "Platform-operated" },
                { label: "From price", value: tour.priceFrom ? formatMoney(tour.priceFrom.amountCents, tour.priceFrom.currency) : "Not priced yet" },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Options" bodyClassName="p-0">
            <DataTable
              columns={[{ label: "Option" }, { label: "Kind" }, { label: "Priced" }, { label: "Confirmation" }, { label: "Pax", align: "end" }]}
              caption="Options on this tour"
            >
              {options.length === 0 ? (
                <EmptyRow colSpan={5} message="No options yet. A tour needs one before it can be published." />
              ) : (
                options.map((option) => (
                  <Row key={option.id}>
                    <Cell>
                      <Link href={path(`/admin/tours/${tour.id}/options`)} className="font-medium text-ink underline-offset-4 hover:underline">
                        {option.name}
                      </Link>
                      <span className="ms-2 text-[0.75rem] text-muted">{option.code}</span>
                    </Cell>
                    <Cell>{optionKindLabels[option.kind]}</Cell>
                    <Cell>{pricingBasisLabels[option.pricingBasis]}</Cell>
                    <Cell>{confirmationModeLabels[option.confirmationMode]}</Cell>
                    <Cell align="end">{option.minPax}–{option.maxPax}</Cell>
                  </Row>
                ))
              )}
            </DataTable>
          </AdminPanel>

          <AdminPanel title="Recent bookings" bodyClassName="p-0">
            <DataTable
              columns={[{ label: "Reference" }, { label: "Traveller" }, { label: "Departure", hideBelow: "md" }, { label: "Status" }, { label: "Total", align: "end" }]}
              caption="Recent bookings on this tour"
            >
              {recent.length === 0 ? (
                <EmptyRow colSpan={5} message="No bookings yet." />
              ) : (
                recent.map((booking) => (
                  <Row key={booking.reference}>
                    <Cell>
                      <Link href={path(`/admin/tours/bookings/${booking.reference}`)} className="font-medium text-ink underline-offset-4 hover:underline">
                        {booking.reference}
                      </Link>
                    </Cell>
                    <Cell>{booking.leadTravellerName}</Cell>
                    <Cell hideBelow="md">{formatDeparture(booking.date, booking.endDate)}</Cell>
                    <Cell><TourBookingStatusBadge status={booking.status} /></Cell>
                    <Cell align="end" className="tabular-nums">{formatMoney(booking.totalCents, booking.currency)}</Cell>
                  </Row>
                ))
              )}
            </DataTable>
          </AdminPanel>
        </div>

        <div className="flex flex-col gap-6">
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element -- editorial or API-served
            <img src={cover} alt={tour.title} className="aspect-4/3 w-full rounded-sm object-cover" />
          )}

          <AdminPanel
            title="Publishing"
            description={
              tour.publishChecklist.length === 0
                ? "Everything required is in place."
                : "What still stands between this tour and going on sale."
            }
          >
            {tour.publishChecklist.length > 0 && (
              <ul className="mb-4 space-y-2">
                {tour.publishChecklist.map((item) => (
                  <li key={item.code} className="flex items-start gap-2 text-[0.8125rem] text-body">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                    {item.message}
                  </li>
                ))}
              </ul>
            )}
            <TourActions tour={tour} />
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
