"use client";

import Link from "next/link";
import { LayoutDashboard, ShieldCheck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { useViewer } from "@/lib/auth/useViewer";
import { cn } from "@/lib/utils";
import { isStaff, type Session } from "@/types/auth";

/**
 * The way from the public site into whichever back office the viewer belongs to.
 *
 * Three destinations behind one control, because from the traveller-facing site
 * they are the same intention — "take me to my side of this" — and a header
 * carrying separate "Admin" and "Partner" links would offer every visitor two
 * doors, at least one of which is not theirs.
 *
 * A signed-out visitor gets the partner sign-in rather than nothing: the site
 * sells to companies as well as travellers, and a B2B surface with no way in
 * from the marketing site is a surface nobody finds.
 *
 * `/portal` is the fallback destination while the session is still unknown, and
 * it is a safe one — it redirects an admin to `/admin`, an approved partner to
 * their dashboard, and everybody else to sign-in. So this control works before
 * hydration and simply sharpens afterwards.
 */

interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function destinationFor(
  session: Session | null,
  t: ReturnType<typeof useI18n>["t"],
): Destination {
  if (isStaff(session)) {
    return { href: "/admin", label: t.nav.account.admin, icon: ShieldCheck };
  }

  if (session?.partner) {
    return { href: "/portal", label: t.nav.account.portal, icon: LayoutDashboard };
  }

  return { href: "/portal", label: t.nav.account.signIn, icon: UserRound };
}

export function AccountNav({
  tone = "dark",
  className,
}: {
  /** "light" over photography, "dark" on the solid header. */
  tone?: "light" | "dark";
  className?: string;
}) {
  const { t } = useI18n();
  const path = useLocalePath();
  const { session } = useViewer();

  const { href, label, icon: Icon } = destinationFor(session, t);

  // Icon-only between `sm` and `md`: with the wordmark, the language menu,
  // the trip button and the burger on one 640px row, a Georgian label
  // ("პარტნიორის შესვლა") pushed the burger off the edge. The accessible
  // name stays on the link while the text is hidden.
  return (
    <Link
      href={path(href)}
      aria-label={label}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-sm px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors",
        tone === "light"
          ? "text-on-dark/85 hover:bg-on-dark/15 hover:text-on-dark"
          : "text-ink hover:bg-surface-soft hover:text-brand-text",
        className,
      )}
    >
      <Icon size={15} className="shrink-0" aria-hidden />
      <span className="hidden md:inline">{label}</span>
    </Link>
  );
}

/**
 * The same destination as a full-width row, for the mobile menu, where the
 * header version is behind the burger and there is room for the explanation.
 */
export function AccountNavRow({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const path = useLocalePath();
  const { session } = useViewer();

  const { href, label, icon: Icon } = destinationFor(session, t);

  return (
    <Link
      href={path(href)}
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-sm border border-on-dark/20 px-4 py-3.5 text-on-dark transition-colors hover:bg-on-dark/10"
    >
      <Icon size={20} className="shrink-0 text-on-dark/60" aria-hidden />
      <span className="min-w-0">
        <span className="type-body-sm block font-medium">{label}</span>
        <span className="type-caption block text-on-dark/55">{t.nav.account.description}</span>
      </span>
    </Link>
  );
}
