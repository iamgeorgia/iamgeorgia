import { cn } from "@/lib/utils";

/** Scripts written right to left; the rest of `\p{L}` runs left to right. */
const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

/** The direction `dir="auto"` would pick: that of the first letter. */
function directionOf(text: string): "ltr" | "rtl" {
  const letter = text.match(/\p{L}/u)?.[0];
  return letter && RTL_LETTER.test(letter) ? "rtl" : "ltr";
}

/**
 * "Tbilisi → Gudauri", safe on a right-to-left page.
 *
 * Place names arrive as data, today in Latin script. The route is isolated
 * and given its own direction, read from its first letter, and the arrow
 * turns only when that direction is right-to-left — so a Latin route on a
 * Hebrew page still points from origin to destination, and a Hebrew one
 * points the other way. Decided here rather than with `:dir()`, which the
 * CSS build rewrites into a page-language test. Screen readers hear "to",
 * not "rightwards arrow".
 */
export function RouteName({
  from,
  to,
  arrowClassName,
}: {
  from: string;
  to: string;
  arrowClassName?: string;
}) {
  const dir = directionOf(from || to);

  return (
    <bdi dir={dir}>
      {from}{" "}
      <span className={cn("inline-block", dir === "rtl" && "-scale-x-100", arrowClassName)} aria-hidden>
        →
      </span>
      <span className="sr-only"> to </span> {to}
    </bdi>
  );
}
