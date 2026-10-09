"use client";

import Link from "next/link";
import {
  BedDouble,
  BookOpen,
  Boxes,
  CalendarCheck,
  Car,
  CircleHelp,
  Compass,
  ConciergeBell,
  Globe2,
  Handshake,
  Image as ImageIcon,
  Map,
  Radio,
  Route,
  Send,
  ShieldAlert,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { useLocalePath } from "@/lib/i18n/provider";
import type { HelpCategory, HelpIconName } from "@/lib/admin/help/types";
import { cn } from "@/lib/utils";

/**
 * Icons by name. The registry names its icons as strings so it can be read
 * by a Server Component and by plain Node alike; this is the one place the
 * names become components — the same arrangement `EmptyState` uses.
 */
const NAMED_ICONS: Record<HelpIconName, LucideIcon> = {
  compass: Compass,
  calendarCheck: CalendarCheck,
  radio: Radio,
  globe: Globe2,
  bedDouble: BedDouble,
  map: Map,
  boxes: Boxes,
  conciergeBell: ConciergeBell,
  route: Route,
  car: Car,
  handshake: Handshake,
  image: ImageIcon,
  send: Send,
  bookOpen: BookOpen,
  circleHelp: CircleHelp,
  shieldAlert: ShieldAlert,
  users: UsersRound,
};

export function HelpCategoryIcon({
  name,
  size = 16,
  className,
}: {
  name: HelpIconName;
  size?: number;
  className?: string;
}) {
  const Icon = NAMED_ICONS[name] ?? CircleHelp;
  return <Icon size={size} className={className} aria-hidden />;
}

/**
 * The areas of the manual as a grid of cards, each with how many articles it
 * holds for this reader. `compact` is the version inside the contextual
 * dialog: one column, no summaries, when a screen has no article of its own
 * and the reader is offered the area instead.
 */
export function HelpCategoryList({
  categories,
  counts,
  compact,
  className,
}: {
  categories: HelpCategory[];
  counts: Record<string, number>;
  compact?: boolean;
  className?: string;
}) {
  const path = useLocalePath();

  return (
    <ul
      className={cn(
        "grid gap-3",
        compact ? "grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {categories.map((category) => {
        const count = counts[category.id] ?? 0;
        return (
          <li key={category.id}>
            <Link
              href={path(`/admin/help/${category.id}`)}
              className={cn(
                "flex h-full gap-3 rounded-sm border border-line bg-surface transition-colors hover:border-ink/40 hover:bg-surface-soft/50",
                compact ? "items-center px-4 py-3" : "items-start p-5",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-brand-text">
                <HelpCategoryIcon name={category.iconName} />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-semibold text-ink">{category.title}</span>
                {!compact && (
                  <span className="mt-1 block text-[0.8125rem] leading-relaxed text-muted">
                    {category.summary}
                  </span>
                )}
                <span className="mt-1.5 block text-[0.75rem] text-subtle tabular-nums">
                  {count} {count === 1 ? "article" : "articles"}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
