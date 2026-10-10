"use client";

import Link from "next/link";

import { useI18n, useLocalePath } from "@/lib/i18n/provider";

/**
 * The sentence for a booking failure.
 *
 * Plain text for every key but one: when a company's platform terms are out of
 * date the way forward is a page, not a retry, so that message carries a link
 * to it. The link only makes sense inside the partner portal, which is the only
 * place the server answers TERMS_OUTDATED.
 */
export function BookingErrorText({
  errorKey,
}: {
  errorKey: keyof ReturnType<typeof useI18n>["t"]["booking"]["errors"];
}) {
  const { t } = useI18n();
  const path = useLocalePath();

  if (errorKey !== "termsOutdated") return <>{t.booking.errors[errorKey]}</>;

  return (
    <span>
      {t.booking.errors.termsOutdated}{" "}
      <Link href={path("/portal/terms")} className="font-medium underline underline-offset-4">
        {t.booking.errors.termsOutdatedLink}
      </Link>
    </span>
  );
}
