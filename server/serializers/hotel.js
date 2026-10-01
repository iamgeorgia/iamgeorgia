import { localise } from './localise.js';
import { toDestinationSummary } from './destination.js';
import { toHotelAmenity } from './amenity.js';
import { toHotelImage, toImageAsset } from './media.js';
import { toChildPolicy, toRoomTypeDetail } from './roomType.js';
import { toKosher, toKosherSummary } from './kosher.js';
import { canViewNetRates } from '../middleware/auth.js';

/**
 * Hotel responses.
 *
 * Built by listing what goes out, never by deleting what must not — the same
 * allow-list discipline as `serializers/partner.js`, and for the same reason:
 * a field added to the model must not appear in a public response merely
 * because nobody remembered to strip it.
 *
 * `kosher` is present only when the property has a kosher profile at all. Its
 * own provenance and lock fields follow the same staff-only rule as everything
 * below, and its `certified` flag is computed rather than stored — see
 * `serializers/kosher.js`.
 *
 * Three things are visible only to platform staff and to the supplier that owns
 * the property, and are *absent* rather than null for anyone else, so a client
 * cannot tell the difference between "no supplier" and "you may not see the
 * supplier":
 *   * `supplier` — who supplies the property is commercial information.
 *   * `sourceType` / `externalRef` — which channel manager feeds it, and under
 *     what identifiers.
 *   * `status` — a public caller only ever sees ACTIVE hotels, so telling them
 *     the status says nothing; an admin needs it on every row.
 */

const TRANSLATABLE = ['name', 'shortDescription', 'summary', 'description', 'policies'];

const localiseHotel = (hotel, locale) => localise(hotel, hotel.translations, locale, TRANSLATABLE);

/**
 * The cover image, whichever way it was set.
 *
 * `featuredImage` is the explicit choice; the image flagged `isCover` is what
 * the gallery editor sets. Preferring the explicit one keeps both working.
 */
const coverOf = (hotel) => {
    if (hotel.featuredImage) {
        return toImageAsset(hotel.featuredImage);
    }

    const cover = (hotel.images ?? []).find((image) => image.isCover) ?? (hotel.images ?? [])[0];

    return cover ? toImageAsset(cover.fileAsset) : null;
};

export const toHotelSummary = (hotel, locale, viewer) => {
    const value = localiseHotel(hotel, locale);

    const summary = {
        id: value.id,
        slug: value.slug,
        name: value.name,
        propertyType: value.propertyType,
        starRating: value.starRating,
        guestScore: value.guestScore,
        reviewCount: value.reviewCount,
        shortDescription: value.shortDescription ?? null,
        countryCode: value.countryCode,
        latitude: value.latitude ?? null,
        longitude: value.longitude ?? null,
        currency: value.currency,
        featured: value.featured,
        coverImage: coverOf(hotel),
        destination: hotel.destination ? toDestinationSummary(hotel.destination, locale) : null,
        // Codes, not the full amenity rows: enough for a card to render its
        // icons without a second request, and present only when the query
        // loaded them.
        ...(hotel.amenities
            ? { amenityCodes: hotel.amenities.map((entry) => entry.amenity?.code).filter(Boolean) }
            : {}),
        // Present only for a property that offers kosher services at all, so
        // "this hotel does not do kosher" and "this response carries no kosher
        // information" are the same absence — which is the truth. Enough for
        // one honest line on a card and no more.
        ...(hotel.kosher ? { kosher: toKosherSummary(hotel) } : {}),
        // When the record last changed. Public because the client's sitemap
        // needs a real `lastModified` per URL — a hand-set date goes stale in a
        // week and teaches crawlers to ignore the field.
        updatedAt: value.updatedAt,
        // A "from" price with no dates is not an offer and is never used to
        // quote or to book — it exists so an un-dated browse page can sort.
        priceFrom:
            value.priceFromCents === null || value.priceFromCents === undefined
                ? null
                : { amountCents: value.priceFromCents, currency: value.priceFromCurrency ?? value.currency }
    };

    if (canViewNetRates(viewer, hotel)) {
        summary.status = value.status;
        summary.b2cEnabled = value.b2cEnabled;
        summary.sourceType = value.sourceType;
        summary.supplier = hotel.supplier ?? null;
        summary.counts = hotel._count
            ? { amenities: hotel._count.amenities ?? 0, images: hotel._count.images ?? 0 }
            : undefined;
    }

    return summary;
};

export const toHotelDetail = (hotel, locale, viewer) => {
    const value = localiseHotel(hotel, locale);

    const detail = {
        ...toHotelSummary(hotel, locale, viewer),
        summary: value.summary ?? null,
        description: value.description ?? [],
        address: value.address ?? null,
        postalCode: value.postalCode ?? null,
        place: value.place ?? null,
        timezone: value.timezone,
        checkIn: { from: value.checkInFrom ?? null, until: value.checkInUntil ?? null },
        checkOut: { from: value.checkOutFrom ?? null, until: value.checkOutUntil ?? null },
        phone: value.phone ?? null,
        email: value.email ?? null,
        website: value.website ?? null,
        languages: value.languages ?? [],
        policies: value.policies ?? {},
        nearby: value.nearby ?? [],
        categoryScores: value.categoryScores ?? [],
        amenities: (hotel.amenities ?? []).map((entry) => toHotelAmenity(entry, locale)),
        images: (hotel.images ?? []).map(toHotelImage),
        // The most recent guest reviews. Editorial content seeded with the
        // catalogue today; post-stay verified reviews are a later re-model.
        reviews: (hotel.reviews ?? []).map((review) => ({
            id: review.id,
            author: review.author,
            country: review.country,
            date: review.date,
            score: review.score,
            title: review.title,
            body: review.body,
            tripType: review.tripType
        })),
        roomTypes: (hotel.roomTypes ?? []).map((roomType) => toRoomTypeDetail(roomType, locale)),
        // Null when the hotel has never chosen one; the platform default
        // applies and the client reads that from its own config rather than
        // this pretending the hotel picked it.
        childPolicy: toChildPolicy(hotel.childPolicy),
        // The full kosher block, overwriting the card-sized summary the shared
        // summary put there. `certified` inside it is derived from a live,
        // unexpired, property-scoped certificate — never from anything an admin
        // can type, and never from an amenity somebody ticked.
        ...(hotel.kosher ? { kosher: toKosher(hotel, viewer) } : {}),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
    };

    if (canViewNetRates(viewer, hotel)) {
        detail.externalRef = value.externalRef ?? null;
        detail.supplierId = value.supplierId ?? null;
    }

    return detail;
};

export const toHotelTranslation = (translation) => ({
    locale: translation.locale,
    name: translation.name ?? null,
    shortDescription: translation.shortDescription ?? null,
    summary: translation.summary ?? null,
    description: translation.description ?? [],
    policies: translation.policies ?? null,
    updatedAt: translation.updatedAt
});
