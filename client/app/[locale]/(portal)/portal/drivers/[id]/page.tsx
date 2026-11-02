import type { Metadata } from "next";
import { MediaImg } from "@/components/ui/MediaImg";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Languages, ShieldCheck, Star, UserRound } from "lucide-react";

import { Container } from "@/components/ui/Container";
import { ApiError } from "@/lib/api/client";
import { getPartnerDriverProfile } from "@/lib/api/ratings";
import { getSession } from "@/lib/auth/session";
import { languageLabels } from "@/lib/admin/fleet";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";
import type { DriverLanguage, DriverProfileForPartner } from "@/types/driver";

export const metadata: Metadata = { title: "Driver", robots: { index: false, follow: false } };

/**
 * A driver's profile, for a partner who has met them through one of its own
 * transfers. The server answers 404 for anyone else, and so does this page.
 */
export default async function PortalDriverPage(props: PageProps<"/[locale]/portal/drivers/[id]">) {
  const session = await getSession();
  const locale = await getLocale();
  const { path } = await getI18n();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));
  if (!session.partner) redirect(localePath(locale, homePathFor(session)));
  if (session.partner.status !== "APPROVED") redirect(localePath(locale, "/portal"));

  const { id } = await props.params;

  let driver: DriverProfileForPartner;

  try {
    driver = await getPartnerDriverProfile(id);
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }

  const photo = driver.photo?.variants.find((variant) => variant.variant === "gallery")?.url ?? driver.photo?.url;

  return (
    <Container className="py-12 sm:py-16">
      <Link href={path("/portal/bookings")} className="inline-flex items-center gap-2 text-[0.8125rem] text-muted transition-colors hover:text-ink">
        <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
        All bookings
      </Link>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-4">
          <MediaImg
            src={photo}
            alt=""
            className="aspect-square w-full rounded-sm object-cover"
            fallback={
              <span className="flex aspect-square w-full items-center justify-center rounded-sm bg-surface-soft text-subtle">
                <UserRound size={64} aria-hidden />
              </span>
            }
          />
        </div>

        <div className="min-w-0 lg:col-span-8">
          <h1 className="flex items-center gap-3 font-display text-[2rem] leading-tight text-ink">
            {driver.firstName} {driver.lastName}
            {driver.verified && (
              <span className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-success">
                <ShieldCheck size={16} aria-hidden />
                Verified
              </span>
            )}
          </h1>

          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem] text-muted">
            {driver.ratingCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Star size={15} className="text-accent-gold" aria-hidden fill="currentColor" />
                {driver.ratingAvg.toFixed(1)} · {driver.ratingCount} ratings
              </span>
            ) : (
              <span>No ratings yet</span>
            )}
            <span>{driver.completedCount} transfers driven</span>
            {driver.yearsExperience > 0 && <span>{driver.yearsExperience} years driving</span>}
          </p>

          {driver.languages.length > 0 && (
            <p className="mt-2 inline-flex items-center gap-2 text-[0.9375rem] text-muted">
              <Languages size={15} aria-hidden />
              {driver.languages.map((code) => languageLabels[code as DriverLanguage] ?? code).join(", ")}
            </p>
          )}

          {driver.bio && <p className="mt-5 text-[1rem] leading-relaxed text-body">{driver.bio}</p>}

          {driver.vehicles.length > 0 && (
            <section className="mt-8">
              <h2 className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">Cars</h2>
              <ul className="mt-3 grid gap-4 sm:grid-cols-2">
                {driver.vehicles.map((car) => {
                  const image = car.mainImage?.variants.find((variant) => variant.variant === "card")?.url ?? car.mainImage?.url;
                  return (
                    <li key={car.id} className="overflow-hidden rounded-sm border border-line bg-surface">
                      <MediaImg
                        src={image}
                        alt=""
                        className="aspect-4/3 w-full object-cover"
                        fallback={<span className="block aspect-4/3 w-full bg-surface-soft" aria-hidden />}
                      />
                      <div className="p-3">
                        <p className="text-[0.9375rem] font-medium text-ink">
                          {car.make} {car.model}
                          {car.colour ? `, ${car.colour.toLowerCase()}` : ""}
                        </p>
                        <p className="text-[0.8125rem] text-muted">
                          {car.passengerCapacity} seats · {car.luggageCapacity} bags
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">Reviews</h2>
            {driver.reviews.length === 0 ? (
              <p className="mt-3 text-[0.9375rem] text-muted">No published reviews yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {driver.reviews.map((review) => (
                  <li key={review.id} className="py-4 first:pt-0">
                    <p className="inline-flex items-center gap-0.5" aria-label={`${review.score} out of 5`}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Star key={value} size={14} className={value <= review.score ? "text-accent-gold" : "text-line"} fill={value <= review.score ? "currentColor" : "none"} aria-hidden />
                      ))}
                      <span className="ms-2 text-[0.75rem] text-subtle">{new Date(review.createdAt).toLocaleDateString("en-GB")}</span>
                    </p>
                    {review.comment && <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-body">{review.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Container>
  );
}
