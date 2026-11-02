import type { Metadata } from "next";

import { BookingSteps } from "@/components/booking/BookingSteps";
import { PaymentResultView } from "@/components/booking/PaymentResultView";
import { Container } from "@/components/ui/Container";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return {
    title: t.payment.metaTitle,
    // A private receipt, reachable only with its token. Never indexed.
    robots: { index: false, follow: false },
  };
}

/**
 * Where the bank sends the guest back to.
 *
 * The page only reads: the server decides what a payment is, and this view
 * polls it until it settles. Refreshing, closing the tab or pressing back
 * changes nothing. The token in the query is the credential; without it the
 * view says the link is incomplete rather than guessing.
 */
export default async function PaymentResultPage(props: PageProps<"/[locale]/booking/payment/[paymentId]">) {
  const { paymentId } = await props.params;
  const searchParams = await props.searchParams;
  const requested = searchParams.t;
  const token = (Array.isArray(requested) ? requested[0] : requested) ?? null;

  return (
    <Container className="pt-10 pb-24 lg:pb-32">
      <BookingSteps current="pay" />

      <div className="mt-10 max-w-xl">
        <PaymentResultView paymentId={paymentId} token={token} />
      </div>
    </Container>
  );
}
