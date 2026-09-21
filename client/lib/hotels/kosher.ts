import type {
  KosherCertificationState,
  KosherProfile,
  KosherSummary,
} from "@/types/catalogue";
import type { UiDictionary } from "@/lib/i18n/ui/en";
import { fill } from "@/lib/i18n/fill";

/**
 * Turning the server's kosher facts into one honest line.
 *
 * Kept out of the components because four of them need the same decision — the
 * search card, the list row, the detail panel and the admin summary — and a
 * badge that says "certified" in one place and something else in another is
 * worse than no badge at all.
 *
 * The rule that matters: **"certified" is rendered only from `certified`**,
 * which the server derives from a verified, unexpired, property-scoped
 * certificate. Nothing here re-derives it from a date, and nothing here infers
 * it from a feature list. A property with every kosher facility ticked and no
 * certificate reads "Kosher services · not certified", which is the truth.
 */

export type KosherTone = "certified" | "expired" | "pending" | "declared";

export interface KosherBadgeContent {
  tone: KosherTone;
  label: string;
  /** The authority, when there is a live certificate to attribute it to. */
  detail: string | null;
}

/** The feature groups, in the order the panel renders them. */
export const KOSHER_FEATURE_GROUPS = ["KosherFood", "Shabbat", "Religious"] as const;

export type KosherFeatureGroup = (typeof KOSHER_FEATURE_GROUPS)[number];

/**
 * Which group a facility code belongs to.
 *
 * Duplicated from the seed rather than fetched, because the panel groups
 * twenty-one known codes and a round trip to learn their categories would be a
 * request per page for a list that changes once a year. A code that is not here
 * still renders — it falls into Religious, the most general of the three —
 * rather than disappearing, which is the safer failure for a facility somebody
 * added on the server and has not yet mapped here.
 */
const GROUP_BY_CODE: Record<string, KosherFeatureGroup> = {
  kosherRestaurant: "KosherFood",
  kosherKitchen: "KosherFood",
  kosherBreakfast: "KosherFood",
  kosherLunch: "KosherFood",
  kosherDinner: "KosherFood",
  separateMeatDairy: "KosherFood",
  kosherMealOnRequest: "KosherFood",
  passoverKosher: "KosherFood",
  kosherWine: "KosherFood",
  shabbatElevator: "Shabbat",
  shabbatMeals: "Shabbat",
  manualRoomKeys: "Shabbat",
  shabbatLighting: "Shabbat",
  shabbatHotPlate: "Shabbat",
  shabbatLateCheckout: "Shabbat",
  synagogueOnSite: "Religious",
  synagogueNearby: "Religious",
  prayerRoom: "Religious",
  minyanDaily: "Religious",
  mikvehOnSite: "Religious",
  mikvehNearby: "Religious",
  eruv: "Religious",
};

export const groupOfFeature = (code: string): KosherFeatureGroup =>
  GROUP_BY_CODE[code] ?? "Religious";

/** Facility codes bucketed for the panel, empty groups dropped. */
export function groupFeatures(
  codes: string[],
): { group: KosherFeatureGroup; codes: string[] }[] {
  return KOSHER_FEATURE_GROUPS.map((group) => ({
    group,
    codes: codes.filter((code) => groupOfFeature(code) === group),
  })).filter((entry) => entry.codes.length > 0);
}

/** The label for one facility, falling back to the raw code. */
export const featureLabel = (t: Pick<UiDictionary, "hotels">, code: string): string =>
  (t.hotels.kosher.features as Record<string, string>)[code] ?? code;

/**
 * The one line to render, and which of the four tones it is.
 *
 * `certified` is checked first and on its own. Everything else is a fallback,
 * so there is no path through this function where a property without a live
 * certificate can produce the certified tone.
 */
export function kosherBadge(
  kosher: KosherSummary | KosherProfile,
  t: Pick<UiDictionary, "hotels">,
): KosherBadgeContent | null {
  if (!kosher.offersKosher) return null;

  if (kosher.certified) {
    return {
      tone: "certified",
      label: t.hotels.kosher.badgeCertified,
      detail: kosher.authorityName ?? null,
    };
  }

  const state: KosherCertificationState = kosher.certificationState;

  if (state === "EXPIRED") {
    return { tone: "expired", label: t.hotels.kosher.badgeExpired, detail: null };
  }

  if (state === "PENDING_VERIFICATION") {
    return { tone: "pending", label: t.hotels.kosher.badgePending, detail: null };
  }

  // Everything left — no certificate, one nobody has looked at, one that was
  // rejected, or a certificate that covers only the restaurant — is the
  // property's own statement and is labelled as one.
  return { tone: "declared", label: t.hotels.kosher.badgeUncertified, detail: null };
}

/**
 * The expiry line, when there is something worth saying.
 *
 * Reads `expiresInDays` from the server rather than comparing `expiresOn`
 * against a browser clock: a device with the wrong date must not be able to
 * make an expired certificate look live, or a live one look lapsed.
 */
export function kosherExpiryNote(
  kosher: KosherProfile,
  t: Pick<UiDictionary, "hotels">,
  formatDate: (iso: string) => string,
): string | null {
  const certification = kosher.certification;

  if (!certification) return null;

  if (certification.state === "EXPIRED" && certification.expiresOn) {
    return fill(t.hotels.kosher.expiredOn, { date: formatDate(certification.expiresOn) });
  }

  if (kosher.expiringSoon && certification.expiresInDays !== null) {
    return fill(t.hotels.kosher.expiringSoon, { count: certification.expiresInDays });
  }

  return null;
}
