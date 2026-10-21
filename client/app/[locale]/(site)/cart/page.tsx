import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CartView } from "@/components/booking/CartView";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { cartEnabled } from "@/lib/booking/cartFlag";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();

  return {
    title: t.orders.cart.metaTitle,
    // One visitor's own list, held in their browser. Nothing to index.
    robots: { index: false, follow: false },
  };
}

/**
 * The cart.
 *
 * Behind `NEXT_PUBLIC_CART_ENABLED`: off, the route does not exist, which
 * matches a header with no bag in it and product pages with no button. The
 * list itself lives in the browser, so the page is a shell around a Client
 * Component that reads it.
 */
export default async function CartPage() {
  if (!cartEnabled) notFound();

  const { t, path } = await getI18n();

  return (
    <>
      <Container className="pt-8 pb-2">
        <Breadcrumbs
          items={[{ label: t.common.home, href: path("/") }, { label: t.orders.cart.crumb }]}
        />
        <h1 className="type-h1 mt-6">{t.orders.cart.title}</h1>
      </Container>

      <CartView />
    </>
  );
}
