"use client";

import Link from "next/link";
import { ChevronDown, FileText, LogOut, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/types/auth";

/** "Nino Owner" -> "NO". Falls back to the email for a one-word name. */
const initialsOf = (user: SessionUser) =>
  [user.firstName, user.lastName]
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || user.email.slice(0, 2).toUpperCase();

/** The roles the account holds, by the names the server gives them. */
const rolesOf = (user: SessionUser) =>
  user.roles?.length ? user.roles.map((held) => held.name).join(", ") : user.role;

const menuItems = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

/**
 * Who is signed in, and the way out.
 *
 * A menu button in the WAI-ARIA sense: it opens on click, Enter or Space,
 * focus moves to the first item, the arrow keys, Home and End walk the items,
 * and Escape closes it and hands focus back to the button. Tab closes it too,
 * so the menu never stays open behind the focus.
 *
 * `links` is false for a partner who is not through the gate yet: settings and
 * terms would only redirect them back, so the menu offers just the sign-out.
 */
export function PortalAccountMenu({
  user,
  companyName,
  links = true,
  onSignOut,
}: {
  user: SessionUser;
  companyName?: string;
  links?: boolean;
  onSignOut: () => void;
}) {
  const path = useLocalePath();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // Focus lands on the first item once the menu is in the DOM.
    menuItems(menuRef.current)[0]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = menuItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        list[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        list.at(-1)?.focus();
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const itemClass =
    "flex min-h-10 w-full items-center gap-2.5 rounded-sm px-3 py-2 text-start text-[0.8125rem] text-body transition-colors hover:bg-surface-soft hover:text-ink focus-visible:bg-surface-soft focus-visible:text-ink focus-visible:outline-none";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${user.fullName}`}
        className="flex min-h-11 items-center gap-2 rounded-sm py-1.5 ps-1.5 pe-2 transition-colors hover:bg-surface-soft"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[0.6875rem] font-semibold text-on-dark">
          {initialsOf(user)}
        </span>
        <span className="hidden max-w-[12rem] min-w-0 text-start md:block">
          <span className="block truncate text-[0.8125rem] leading-tight font-medium text-ink">{user.fullName}</span>
          <span className="mt-0.5 block truncate text-[0.6875rem] leading-tight text-muted">{rolesOf(user)}</span>
        </span>
        {/* Rotation, not a direction — this one must not flip in Hebrew. */}
        <ChevronDown
          size={15}
          className={cn("shrink-0 text-subtle transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full end-0 z-70 mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-sm border border-line bg-surface p-1.5 shadow-lift"
        >
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="text-[0.8125rem] font-medium text-ink wrap-anywhere">{user.fullName}</p>
            <p className="truncate text-[0.75rem] text-muted" title={user.email}>
              {user.email}
            </p>
            <p className="mt-1.5 text-[0.75rem] leading-snug text-subtle">
              {rolesOf(user)}
              {companyName && <> · {companyName}</>}
            </p>
          </div>

          <div className="pt-1.5">
            {links && (
              <>
                <Link
                  role="menuitem"
                  tabIndex={-1}
                  href={path("/portal/settings")}
                  onClick={() => close(false)}
                  className={itemClass}
                >
                  <Settings size={15} className="shrink-0 text-subtle" aria-hidden />
                  Your settings
                </Link>
                <Link
                  role="menuitem"
                  tabIndex={-1}
                  href={path("/portal/terms")}
                  onClick={() => close(false)}
                  className={itemClass}
                >
                  <FileText size={15} className="shrink-0 text-subtle" aria-hidden />
                  Platform terms
                </Link>
              </>
            )}
            <button
              role="menuitem"
              tabIndex={-1}
              type="button"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className={itemClass}
            >
              <LogOut size={15} className="shrink-0 text-subtle rtl:-scale-x-100" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
