"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";

import { AccountNav } from "./AccountNav";
import { CartLink } from "./CartLink";
import { LanguageMenu } from "./LanguageMenu";
import { Logo } from "./Logo";
import { MobileNavigation } from "./MobileNavigation";
import { Button } from "@/components/ui/Button";
import { site } from "@/constants/site";
import { stripLocale } from "@/lib/i18n/config";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { isActivePath, navLabel, primaryNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Routes that open with a full-bleed dark hero, where the header starts
 * transparent and settles into a solid surface on scroll.
 *
 * Tour and hotel detail pages are excluded on purpose: both open with a
 * breadcrumb and gallery on a light background, so the header must be solid
 * from the top or the wordmark would sit warm-white on warm-white.
 *
 * Takes the canonical path — `/ka/about` has to read as `/about` here, or
 * every non-English page would render the solid header over its dark hero.
 */
function hasImmersiveHero(pathname: string): boolean {
  const path = stripLocale(pathname);
  if (path === "/" || path === "/about") return true;
  // `/packages` opens with the same `PageHero` as the other three indexes.
  return ["/tours", "/hotels", "/packages", "/transfers"].includes(path);
}

export function Header() {
  const pathname = usePathname();
  const { t } = useI18n();
  const path = useLocalePath();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const immersive = hasImmersiveHero(pathname);
  const overImagery = immersive && !scrolled;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300 ease-(--ease-out-soft)",
          overImagery
            ? "bg-transparent"
            : "border-b border-line/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75",
        )}
      >
        <div className="mx-auto flex h-18 w-full max-w-(--container-page) items-center justify-between gap-3 px-5 sm:px-8 lg:h-20 lg:gap-5 lg:px-8 xl:gap-8 xl:px-12">
          <Link
            href={path("/")}
            className="flex shrink-0 items-center gap-2.5 focus-visible:outline-offset-4"
          >
            <Logo className="size-8 lg:size-9" />
            <span
              className={cn(
                "font-display text-lg leading-none font-medium whitespace-nowrap tracking-[0.06em] transition-colors lg:text-base xl:text-lg 2xl:text-xl",
                overImagery ? "text-on-dark" : "text-ink",
              )}
            >
              {site.wordmark}
            </span>
          </Link>

          <nav aria-label={t.a11y.primaryNav} className="hidden min-w-0 lg:block">
            {/* Six items have to clear the wordmark and the trip-planning button
                on one line in every language, and Georgian runs roughly twice
                the width of English ("About" → "ჩვენ შესახებ"). Two things keep
                that honest: the labels never wrap, and the gap is fluid rather
                than stepped, so the row tightens towards 1024px and opens out on
                a wide screen instead of jumping at one breakpoint. */}
            <ul className="flex items-center gap-[clamp(0.75rem,1.35vw,2.25rem)]">
              {primaryNavigation.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <Link
                      href={path(item.href)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative inline-flex items-center gap-1.5 py-2 text-[0.8125rem] font-medium whitespace-nowrap transition-colors xl:text-sm",
                        // A single hairline in brand orange is the whole active
                        // indicator — no orange pills or filled backgrounds in the nav.
                        "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-[inline-start] after:scale-x-0 after:bg-brand after:transition-transform after:duration-300 after:ease-(--ease-out-soft) hover:after:scale-x-100",
                        // Over photography the logo orange reads cleanly (5.8:1 on
                        // charcoal); on warm white it needs the darker shade for AA.
                        overImagery
                          ? "text-on-dark/85 hover:text-brand"
                          : "text-ink hover:text-brand-text",
                        active && "after:scale-x-100",
                        active && (overImagery ? "text-brand" : "text-brand-text"),
                      )}
                    >
                      {Icon && <Icon size={15} className="shrink-0" aria-hidden />}
                      {navLabel(t, item.key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-2 lg:gap-3">
            {/* The two controls below are shown and hidden by breakpoint through
                a `display: contents` wrapper rather than a `hidden` class on the
                component. Both components set their own display utility
                (`inline-flex`), and two display utilities on one element resolve
                by stylesheet order, not author order — `hidden` lost, and both
                rendered on phones, pushing the burger off the edge. */}

            {/* From `sm` up, including the tight `lg` band where the trip button
                steps aside — the staff surfaces are reached often enough by the
                people who use them that hiding the link behind a burger on a
                desktop would be the wrong trade. Below `sm` the mobile menu
                carries the same row. */}
            <span className="hidden sm:contents">
              <AccountNav tone={overImagery ? "light" : "dark"} />
            </span>

            {/* Only while there is something in it, and only with the cart
                switched on — see `CartLink`. Sits on every width, including
                phones, because a bag behind a burger is a bag nobody finds. */}
            <CartLink tone={overImagery ? "light" : "dark"} />

            <LanguageMenu tone={overImagery ? "light" : "dark"} />

            {/* Visible from `sm` (where the nav is still behind the burger) and
                again from `xl`, but not in the `lg` band: that is the one width
                where six nav items and this button compete for the same row, and
                the nav is the thing a reader needs. The mobile menu carries the
                same action, so it is never unreachable. */}
            <span className="hidden sm:contents lg:hidden xl:contents">
              <Button
                href={path("/contact")}
                size="sm"
                variant={overImagery ? "light" : "primary"}
              >
                {t.actions.planYourTrip}
              </Button>
            </span>

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={t.a11y.openMenu}
              aria-expanded={menuOpen}
              className={cn(
                "flex size-10 items-center justify-center rounded-sm transition-colors lg:hidden",
                overImagery ? "text-on-dark hover:bg-on-dark/15" : "text-ink hover:bg-surface-soft",
              )}
            >
              <Menu size={22} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {/* Pages without a full-bleed hero start below the fixed header. */}
      {!immersive && <div className="h-18 lg:h-20" aria-hidden />}

      <MobileNavigation open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
