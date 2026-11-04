"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";

import { signOut } from "@/lib/api/partners";
import { forgetViewer } from "@/lib/auth/useViewer";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Sign-out has to reach the server: the session is a row in the database and
 * the cookie is httpOnly, so only the API can end it. The way back is the
 * driver sign-in page whatever happens, so a failed call still leaves the
 * phone signed out of this screen.
 */
export function useDriverSignOut() {
  const router = useRouter();
  const path = useLocalePath();
  const [pending, setPending] = useState(false);

  const run = async () => {
    setPending(true);
    try {
      await signOut();
    } finally {
      forgetViewer();
      router.replace(path("/driver/sign-in"));
      router.refresh();
    }
  };

  return { pending, signOut: run };
}

/**
 * `icon`: the square button in the top bar on a phone.
 * `inline`: a labelled button, for the desktop top bar.
 * `block`: full width, at the foot of the Me page — where a driver handing
 * the phone back, or swapping shifts, expects to find it.
 */
export function DriverSignOutButton({ variant, className }: { variant: "icon" | "inline" | "block"; className?: string }) {
  const { pending, signOut } = useDriverSignOut();
  const icon = pending ? (
    <Loader2 size={17} className="animate-spin" aria-hidden />
  ) : (
    <LogOut size={17} className="rtl:-scale-x-100" aria-hidden />
  );

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={pending}
        aria-label="Sign out"
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-body transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-60",
          className,
        )}
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm border border-line bg-surface font-medium whitespace-nowrap text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60",
        variant === "block" ? "min-h-12 w-full px-4 text-[0.9375rem]" : "h-10 px-3.5 text-[0.8125rem]",
        className,
      )}
    >
      {icon}
      Sign out
    </button>
  );
}
