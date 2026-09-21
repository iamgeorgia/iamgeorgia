import type { Metadata } from "next";
import { Fraunces, Inter, Noto_Sans_Georgian, Noto_Sans_Hebrew } from "next/font/google";
import { notFound } from "next/navigation";
import { SpeedInsights } from "@vercel/speed-insights/next";

import "../globals.css";
import { site } from "@/constants/site";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, locales, localeMeta } from "@/lib/i18n/config";
import { LocaleProvider } from "@/lib/i18n/provider";

/**
 * Editorial display face for headlines. Only the default axes: the design
 * never moves SOFT or WONK off their defaults, and asking for them makes the
 * font file larger for nothing.
 */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Interface face for everything else.
 *
 * `subsets` decides which files are *preloaded*, not which are available:
 * every unicode-range face Google serves is still declared, so Russian pages
 * still set Cyrillic in Inter — it simply arrives on demand rather than being
 * pushed ahead of the hero image on every English, Georgian and Hebrew page.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Fraunces and Inter cover Latin and Cyrillic but have no Georgian or Hebrew
 * glyphs — without these the ka and he pages would render in a fallback face
 * chosen by the OS, which is exactly the "translated but not designed" look we
 * are trying to avoid. Both are wired into the font stack in globals.css.
 *
 * `preload: false`: this layout serves all four locales, and a preload link
 * forces the download on every visitor — a Latin-locale reader would pull
 * Georgian and Hebrew faces they never render. Without it the @font-face
 * unicode-range means only pages that actually set text in these scripts fetch
 * the files, at the cost of a brief `display: swap` fallback on ka/he pages.
 */
const notoGeorgian = Noto_Sans_Georgian({
  variable: "--font-georgian",
  subsets: ["georgian"],
  display: "swap",
  preload: false,
});

const notoHebrew = Noto_Sans_Hebrew({
  variable: "--font-hebrew",
  subsets: ["hebrew"],
  display: "swap",
  preload: false,
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata(
  props: LayoutProps<"/[locale]">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!isLocale(locale)) return {};

  const t = getDictionary(locale);
  const title = `${site.name} — ${t.meta.tagline}`;

  return {
    metadataBase: new URL(site.url),
    title: {
      default: title,
      template: `%s — ${site.name}`,
    },
    description: t.meta.description,
    /*
     * Deliberately no `alternates` here.
     *
     * Next inherits metadata down the segment tree, so a canonical set on the
     * layout is inherited by every page that does not override it — and a
     * layout can only name the home page. That would tell search engines that
     * /tours, /hotels and every property page are duplicates of the front page,
     * which is a far worse failure than emitting no canonical at all. Each page
     * builds its own self-referencing set through `pageMetadata`
     * (`lib/seo/metadata.ts`), and the home page is no exception.
     */
    openGraph: {
      type: "website",
      siteName: site.name,
      title,
      description: t.meta.description,
      locale: localeMeta[locale].intlLocale.replace("-", "_"),
      images: [
        {
          url: site.seo.image,
          alt: site.seo.imageAlt,
          width: site.seo.imageWidth,
          height: site.seo.imageHeight,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: t.meta.description,
      images: [site.seo.image],
    },
  };
}

export default async function RootLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!isLocale(locale)) notFound();

  const { dir, htmlLang } = localeMeta[locale];

  return (
    <html
      lang={htmlLang}
      dir={dir}
      className={`${fraunces.variable} ${inter.variable} ${notoGeorgian.variable} ${notoHebrew.variable} h-full antialiased`}
      data-locale={locale}
    >
      {/*
        The root layout deliberately holds no chrome. Marketing pages get the
        header and footer from `(site)/layout.tsx`; the admin panel is a
        different product surface with its own shell. Both are route groups, so
        neither appears in a URL.

        Nor does it hand out the dictionary: whatever is passed to the client
        provider is serialised into every document, and the strings each group
        needs differ. The group layouts provide their own share.
      */}
      <body className="flex min-h-full flex-col">
        <LocaleProvider locale={locale}>{props.children}</LocaleProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
