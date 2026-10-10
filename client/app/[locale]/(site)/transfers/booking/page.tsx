import type { Metadata } from "next";
import { ArrowLeft, ChevronDown } from "lucide-react";

import { TransferBookingForm } from "@/components/transfers/TransferBookingForm";
import { TransferBookingSummary } from "@/components/transfers/TransferBookingSummary";
import { TransferSteps } from "@/components/transfers/TransferSteps";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiError } from "@/lib/api/client";
import { quoteTransfers } from "@/lib/api/transfers";
import { getSession } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import {
  paramsFromSearchParams,
  parseTransferQuery,
  serializeTransferQuery,
} from "@/lib/transfers/query";
import { formatMoney } from "@/lib/money";
import type { TransferQuoteResult } from "@/types/transfer";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.transfers.booking.metaTitle,
    robots: { index: false, follow: false },
  };
}

/**
 * Checkout.
 *
 * The quote is taken again here rather than carried from the previous page,
 * which is deliberate: the traveller may have had this tab open for an hour,
 * and the figure they are about to agree to should be the current one. The
 * token that comes back with it is what the form submits, and the server
 * re-prices that a third time before it writes anything.
 */
export default async function TransferBookingPage(
  props: PageProps<"/[locale]/transfers/booking">,
) {
  const [searchParams, { t, path, locale, intlLocale }, session] = await Promise.all([
    props.searchParams,
    getI18n(),
    getSession(),
  ]);

  // Only an approved partner, or staff who book or dispatch, may ask for a
  // particular driver; the server enforces the same rule (`mayChooseDriver`),
  // this just decides whether to show the section.
  const canChooseDriver = can(session, "bookings.write", "dispatch.write") || session?.partner?.status === "APPROVED";

  const params = paramsFromSearchParams(searchParams);
  const query = parseTransferQuery(params);
  const slug = params.get("offer") ?? "";

  let result: TransferQuoteResult | null = null;

  if (slug && query.from && query.to && query.date && query.time) {
    try {
      result = await quoteTransfers({
        from: query.from,
        to: query.to,
        date: query.date,
        time: query.time,
        tripType: query.type === "return" ? "RETURN" : "ONE_WAY",
        returnDate: query.type === "return" ? query.returnDate : undefined,
        returnTime: query.type === "return" ? query.returnTime : undefined,
        adults: query.adults,
        children: query.children,
        luggage: query.luggage,
        cabinBags: query.cabinBags,
        locale,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }

  const offer = result?.offers.find((entry) => entry.vehicle.slug === slug) ?? null;

  /* Arriving here without a bookable transfer means a stale or hand-typed link. */
  if (!offer) {
    return (
      <Container className="py-24">
        <EmptyState
          title={t.transfers.booking.noTransferTitle}
          description={t.transfers.booking.noTransferBody}
          action={{
            label: t.transfers.booking.searchTransfers,
            href: path("/transfers"),
          }}
        />
      </Container>
    );
  }

  const detailHref = `${path(`/transfers/${offer.vehicle.slug}`)}?${serializeTransferQuery(query)}`;

  return (
    <Container className="pt-8 pb-24 lg:pb-32">
      <Breadcrumbs
        items={[
          { label: t.common.home, href: path("/") },
          { label: t.nav.transfers, href: path("/transfers") },
          { label: offer.vehicle.name, href: detailHref },
          { label: t.transfers.booking.breadcrumb },
        ]}
      />

      <TransferSteps current={3} className="mt-6" />

      <h1 className="type-h1 mt-6">{t.transfers.booking.title}</h1>
      <p className="type-body-lg mt-4 max-w-2xl text-body">{t.transfers.booking.intro}</p>

      {/* On a phone the summary sits above the form and collapses, so the
          traveller can confirm the total without scrolling past every field —
          and gets straight to typing once they have. Native `<details>`, so it
          works before hydration and is keyboard-operable for free. */}
      <details className="group mt-10 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 border border-line bg-surface px-4 py-3.5">
          <span className="type-h4">{t.transfers.summary.transferSummary}</span>
          <span className="flex items-center gap-3">
            <span className="type-h4 tabular-nums">
              {formatMoney(offer.quote.totals.totalCents, offer.quote.currency, intlLocale)}
            </span>
            <ChevronDown
              size={18}
              className="text-muted transition-transform duration-200 group-open:rotate-180"
              aria-hidden
            />
          </span>
        </summary>
        <TransferBookingSummary
          offer={offer}
          query={query}
          from={result?.from}
          to={result?.to}
          className="mt-2"
        />
      </details>

      <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-12 xl:gap-16">
        <div className="min-w-0 lg:col-span-7">
          <TransferBookingForm
            offer={offer}
            query={query}
            from={result?.from}
            to={result?.to}
            canChooseDriver={canChooseDriver}
          />

          <Button href={detailHref} variant="ghost" className="mt-6">
            <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden />
            {t.transfers.booking.back}
          </Button>
        </div>

        <aside className="hidden lg:col-span-5 lg:block">
          <div className="lg:sticky lg:top-36">
            <h2 className="type-h4 mb-4">{t.transfers.summary.transferSummary}</h2>
            <TransferBookingSummary
              offer={offer}
              query={query}
              from={result?.from}
              to={result?.to}
            />
          </div>
        </aside>
      </div>
    </Container>
  );
}
