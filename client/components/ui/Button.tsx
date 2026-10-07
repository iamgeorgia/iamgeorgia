import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "outlineBrand"
  | "outlineLight"
  | "ghost"
  | "light";
type Size = "sm" | "md" | "lg";

/*
 * Heights are minimums and labels are allowed to wrap. A fixed height with
 * `whitespace-nowrap` made every label as wide as its longest translation, and
 * in a two-button row on a phone — or a Russian cancel dialog at any width —
 * the text ran out of the button and was clipped by the dialog. A button that
 * has room still sits on one line at exactly its old height.
 *
 * Georgian gets a looser leading for the wrapped case: its letters fill the
 * whole line, and at `leading-tight` two lines of a label were 3px apart. The
 * minimum heights absorb it, so a one-line button does not grow.
 */
const base =
  "inline-flex max-w-full items-center justify-center gap-2 rounded-sm text-center font-sans leading-tight font-semibold [&:lang(ka)]:leading-snug [&>svg]:shrink-0 " +
  "transition-[background-color,color,border-color,transform] duration-200 ease-(--ease-out-soft) " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  // The brand signature. Every booking, reserve and plan-a-trip action.
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "bg-ink text-on-dark hover:bg-ink-soft",
  outline: "border border-ink/25 bg-transparent text-ink hover:border-ink hover:bg-surface-soft",
  // Orange outline — used sparingly, and with the darker orange so the label
  // clears AA on a light surface.
  outlineBrand:
    "border border-brand bg-transparent text-brand-text hover:bg-brand-soft hover:border-brand-hover",
  ghost: "bg-transparent text-ink hover:bg-surface-soft",
  // The two variants below are for dark surfaces and photography. They exist as
  // real variants rather than className overrides, because two competing colour
  // utilities on one element resolve by stylesheet order, not by author order.
  outlineLight:
    "border border-on-dark/40 bg-transparent text-on-dark hover:border-on-dark hover:bg-on-dark/10",
  light: "bg-background/95 text-ink backdrop-blur-sm hover:bg-background",
};

const sizes: Record<Size, string> = {
  sm: "min-h-9 px-4 py-1.5 text-[0.8125rem]",
  md: "min-h-11 px-6 py-2 text-[0.9375rem]",
  // Narrower sides on a phone: 32px of padding either side left a long
  // Georgian label less than 220px on a 320px screen.
  lg: "min-h-13 px-5 py-2.5 text-base sm:px-8",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Button attributes are listed explicitly rather than spread. It keeps the API
 * small and readable, and it means presentational props can never leak onto the
 * DOM element.
 */
type ButtonProps = CommonProps & {
  href?: undefined;
  /** Defaults to "button" — pass "submit" inside a form. */
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  onClick?: () => void;
  disabled?: boolean;
  "aria-label"?: string;
};

type LinkProps = CommonProps & {
  href: string;
  /** Set for links leaving the site. */
  external?: boolean;
  /** Useful for links that also need to dismiss a menu or dialog. */
  onClick?: () => void;
};

/**
 * Renders a `<Link>` when given `href`, otherwise a `<button>`.
 * Every call-to-action in the product goes through this component so heights,
 * radii and motion stay identical everywhere.
 */
export function Button(props: ButtonProps | LinkProps) {
  const { variant = "primary", size = "md", fullWidth, className, children } = props;
  const classes = cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);

  if ("href" in props && props.href !== undefined) {
    const { href, external, onClick } = props;
    if (external) {
      return (
        <a
          href={href}
          className={classes}
          onClick={onClick}
          target="_blank"
          rel="noreferrer noopener"
        >
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} onClick={onClick}>
        {children}
      </Link>
    );
  }

  const { type = "button", onClick, disabled } = props;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={props["aria-label"]}
      className={classes}
    >
      {children}
    </button>
  );
}
