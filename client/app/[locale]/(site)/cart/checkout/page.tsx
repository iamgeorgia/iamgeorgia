import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookingSteps } from "@/components/booking/BookingSteps";
import { CartCheckoutForm } from "@/components/booking/CartCheckoutForm";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { cartEnabled } from "@/lib/booking/cartFlag";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return {
    title: t.orders.cart.checkoutMetaTitle,
    // One person's transient state, scoped to holds that have expired by the
    // time a crawler arrives.
    robots: { index: false, follow: false },
  };
}

/**
 * Cart checkout.
 *
 * Its own route rather than a mode of the package checkout: this one holds
 * and commits up to twenty products from the browser's own list, and has to
 * render a refusal that names cart items rather than package slots. Nothing
 * is in the URL — the list is in `localStorage`, the holds in the tab's draft.
 */
export default async function CartCheckoutPage() {
  if (!cartEnabled) notFound();

  const { t, path } = await getI18n();

  return (
    <>
      <Container className="pt-8 pb-2">
        <Breadcrumbs
          items={[
            { label: t.common.home, href: path("/") },
            { label: t.orders.cart.crumb, href: path("/cart") },
            { label: t.orders.cart.checkoutCrumb },
          ]}
        />
        <h1 className="type-h1 mt-6">{t.orders.cart.checkoutTitle}</h1>
        <div className="mt-8">
          <BookingSteps current="details" labels={t.orders.cart.steps} />
        </div>
      </Container>

      <CartCheckoutForm />
    </>
  );
}
