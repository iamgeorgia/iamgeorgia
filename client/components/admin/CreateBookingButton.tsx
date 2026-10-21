"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * The way into the desk: a booking made by phone, by email, through another
 * agency or face to face. Shown wherever a register of bookings is, to
 * whoever may make one (`bookings.write`); renders nothing for anyone else,
 * since a button that answers 403 is worse than no button.
 */
export function CreateBookingButton({ className, variant = "primary" }: { className?: string; variant?: "primary" | "secondary" }) {
  const can = useCan();
  const localePath = useLocalePath();

  if (!can("bookings.write")) return null;

  return (
    <Link
      href={localePath("/admin/bookings/new")}
      prefetch={false}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors",
        variant === "primary"
          ? "bg-brand text-white hover:bg-brand-hover"
          : "border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft",
        className,
      )}
    >
      <Plus size={15} aria-hidden />
      Create booking
    </Link>
  );
}
