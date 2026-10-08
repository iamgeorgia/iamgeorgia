import { toDateOnly } from '../lib/time.js';
import { isStaff, ownsHotel } from '../middleware/auth.js';
import {
    certificationState,
    daysUntilExpiry,
    deriveKosher,
    isExpiringSoon,
    kosherFeaturesOf,
    kosherToday
} from '../services/hotel/kosher.service.js';

/**
 * Kosher responses.
 *
 * Built by listing what goes out, never by deleting what must not — the same
 * allow-list discipline as every other serializer here.
 *
 * The one rule that matters more than the rest: **`certified` is never taken
 * from a stored field**, because there is no stored field to take it from. It
 * comes out of `deriveKosher`, which needs a live, unexpired, property-scoped
 * certificate to say true. An admin ticking every kosher amenity on the list
 * produces a hotel with a long feature set and `certified: false`, which is the
 * honest answer.
 *
 * Three things are staff-only and *absent* rather than null for anyone else, so
 * a client cannot tell "no value" from "not permitted":
 *   * `source` / `sourceRef` — where this came from is commercial information.
 *   * `lockedAt` / `lockedBy` — an internal review marker.
 *   * `pendingSupplierData` — a supplier's disagreement with us.
 */

/** Certificate facts. The scan itself is never a URL here — see below. */
const toCertification = (certification, today, viewer) => {
    const state = certificationState(certification, today);
    const expiresIn = daysUntilExpiry(certification, today);

    const value = {
        id: certification.id,
        authorityName: certification.authorityName,
        authorityWebsite: certification.authorityWebsite ?? null,
        name: certification.name ?? null,
        reference: certification.reference ?? null,
        scope: certification.scope,
        issuedOn: certification.issuedOn ? toDateOnly(certification.issuedOn) : null,
        expiresOn: certification.expiresOn ? toDateOnly(certification.expiresOn) : null,
        /// UNVERIFIED · PENDING_VERIFICATION · VERIFIED · EXPIRED · REJECTED.
        /// EXPIRED is computed here and now, so it is right at 00:01 whether or
        /// not any job has run.
        state,
        expiresInDays: expiresIn,
        archivedAt: certification.archivedAt ?? null,
        /// Whether there is a scan at all. Deliberately a boolean and not a
        /// URL: reaching the bytes is a separate, authorized, audited request
        /// for a signed link, and putting an address here would defeat that.
        documentAvailable: Boolean(certification.documentId),
        documentId: certification.documentId ?? null
    };

    if (isStaff(viewer)) {
        value.verification = certification.verification;
        value.verifiedAt = certification.verifiedAt ?? null;
        value.verifiedBy = certification.verifiedBy
            ? {
                  id: certification.verifiedBy.id,
                  name: `${certification.verifiedBy.firstName} ${certification.verifiedBy.lastName}`.trim(),
                  email: certification.verifiedBy.email
              }
            : null;
        value.verificationNotes = certification.verificationNotes ?? null;
        value.source = certification.source;
        value.createdAt = certification.createdAt;
        value.updatedAt = certification.updatedAt;
    }

    return value;
};

/**
 * The kosher block on a hotel.
 *
 * Returns null when the property has no profile — and the caller omits the key
 * entirely in that case, so "this hotel does not do kosher" and "this response
 * does not carry kosher information" are the same absence, which is the truth.
 *
 * `features` is a *projection* of the hotel's own amenities filtered to the
 * three kosher categories. It is not a second store: ticking a box in the
 * kosher panel writes a `hotel_amenities` row through the endpoint that has
 * always written them, so the two can never drift apart.
 */
export const toKosher = (hotel, viewer) => {
    const profile = hotel?.kosher;

    if (!profile) {
        return null;
    }

    const today = kosherToday(hotel.timezone);
    const resolved = deriveKosher(profile, today);
    const staff = isStaff(viewer) || ownsHotel(viewer, hotel);

    // Archived certificates are history: readable by staff, invisible to an
    // agency, and never part of a badge.
    const visible = (profile.certifications ?? []).filter(
        (certification) => staff || !certification.archivedAt
    );

    const value = {
        serviceLevel: resolved.serviceLevel,
        offersKosher: resolved.offersKosher,
        certified: resolved.certified,
        certifiedScopes: resolved.certifiedScopes,
        certificationState: resolved.state,
        expiringSoon: isExpiringSoon(resolved),
        /// The one certificate worth putting on a card. Live beats pending
        /// beats lapsed, and the client never has to rank them itself.
        certification: resolved.headline ? toCertification(resolved.headline, today, viewer) : null,
        certifications: visible.map((certification) => toCertification(certification, today, viewer)),
        features: kosherFeaturesOf(hotel),
        notes: profile.notes ?? null,
        contact: {
            name: profile.contactName ?? null,
            email: profile.contactEmail ?? null,
            phone: profile.contactPhone ?? null
        },
        updatedAt: profile.updatedAt
    };

    if (staff) {
        value.source = profile.source;
        value.sourceRef = profile.sourceRef ?? null;
        value.sourceUpdatedAt = profile.sourceUpdatedAt ?? null;
        value.lockedAt = profile.lockedAt ?? null;
        value.lockedBy = profile.lockedBy
            ? {
                  id: profile.lockedBy.id,
                  name: `${profile.lockedBy.firstName} ${profile.lockedBy.lastName}`.trim(),
                  email: profile.lockedBy.email
              }
            : null;
        // A supplier's kosher payload that was refused because the record is
        // locked. Surfaced so an admin can accept or reject it, rather than
        // sitting in a column nobody looks at.
        value.pendingSupplierData = profile.pendingSupplierData ?? null;
    }

    return value;
};

/**
 * The short form for a search card or a list row.
 *
 * Exactly enough to render one honest line — "Kosher certified · Chief
 * Rabbinate of Georgia", or "Kosher services · not certified", or "certification
 * expired 12 Jan" — and nothing more, because a card must not cost a detail
 * page's worth of data per row.
 */
export const toKosherSummary = (hotel) => {
    const profile = hotel?.kosher;

    if (!profile) {
        return null;
    }

    const today = kosherToday(hotel.timezone);
    const resolved = deriveKosher(profile, today);

    return {
        serviceLevel: resolved.serviceLevel,
        offersKosher: resolved.offersKosher,
        certified: resolved.certified,
        certificationState: resolved.state,
        expiringSoon: isExpiringSoon(resolved),
        authorityName: resolved.headline?.authorityName ?? null,
        expiresOn: resolved.headline?.expiresOn ? toDateOnly(resolved.headline.expiresOn) : null
    };
};

/** A private document, as the panel lists it. Carries no URL, by design. */
export const toHotelDocument = (document) => ({
    id: document.id,
    docType: document.docType,
    label: document.label ?? null,
    validUntil: document.validUntil ? toDateOnly(document.validUntil) : null,
    fileAssetId: document.fileAssetId,
    file: document.fileAsset
        ? {
              id: document.fileAsset.id,
              originalFilename: document.fileAsset.originalFilename,
              mimeType: document.fileAsset.mimeType,
              sizeBytes: document.fileAsset.sizeBytes,
              category: document.fileAsset.category
          }
        : null,
    uploadedBy: document.uploadedByUser
        ? {
              id: document.uploadedByUser.id,
              name: `${document.uploadedByUser.firstName} ${document.uploadedByUser.lastName}`.trim(),
              email: document.uploadedByUser.email
          }
        : null,
    createdAt: document.createdAt
});

/**
 * One structured requirement on a booking.
 *
 * `code` travels rather than a label. The display string is the client's
 * business — `hotel.kosher.features.shabbatElevator` in its dictionary — so a
 * booking made in English reads in Hebrew when a Hebrew-speaking colleague
 * opens it, which storing "Shabbat elevator" in the row would have prevented
 * for ever.
 */
export const toBookingRequest = (request) => ({
    id: request.id,
    code: request.code,
    note: request.note ?? null,
    status: request.status,
    respondedAt: request.respondedAt ?? null,
    responseNote: request.responseNote ?? null
});
