import { CookieNotice } from "@/components/layout/CookieNotice";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { SITE_NAMESPACES, pickClientDictionary } from "@/lib/i18n/client";
import { DictionaryProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";
import { JsonLd, organizationSchema, webSiteSchema } from "@/lib/seo/jsonLd";

/**
 * Public site chrome.
 *
 * Everything a traveller sees lives under this group. It is a route group, so
 * `(site)` never appears in a URL — `/tours` is still `/tours`. The admin panel
 * sits outside it and supplies its own shell instead of this header and footer.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { t, locale } = await getI18n();

  return (
    <DictionaryProvider dictionary={pickClientDictionary(t, SITE_NAMESPACES)}>
      <MotionProvider>
        {/*
          Who publishes this site, once, on every public page. The admin panel and
          the driver app sit outside this group and get none of it, which is
          correct — neither is a page a search engine should ever hold.
        */}
        <JsonLd data={[organizationSchema(), webSiteSchema(locale)]} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:start-4 focus:z-200 focus:rounded-sm focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:text-on-dark"
        >
          {t.a11y.skipToContent}
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        <CookieNotice />
      </MotionProvider>
    </DictionaryProvider>
  );
}
