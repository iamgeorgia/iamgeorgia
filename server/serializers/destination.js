import { localise } from './localise.js';

/**
 * Destination responses.
 *
 * Built by listing what goes out, not by deleting what must not — the same
 * allow-list discipline as `serializers/partner.js`. `path` and `parentId` are
 * included deliberately: the admin tree and the client's breadcrumb both need
 * them, and neither is sensitive.
 *
 * `geo` never appears. It is a PostGIS binary that Prisma cannot read and that
 * no client has a use for; latitude and longitude are the public form.
 */

const TRANSLATABLE = ['name', 'tagline', 'summary', 'description'];

const localiseDestination = (destination, locale) =>
    localise(destination, destination.translations, locale, TRANSLATABLE);

export const toDestinationSummary = (destination, locale) => {
    const value = localiseDestination(destination, locale);

    return {
        id: value.id,
        slug: value.slug,
        name: value.name,
        type: value.type,
        parentId: value.parentId ?? null,
        path: value.path,
        countryCode: value.countryCode,
        timezone: value.timezone,
        latitude: value.latitude ?? null,
        longitude: value.longitude ?? null,
        place: value.place ?? null,
        coverImage: value.coverImage ?? null,
        featured: value.featured,
        ...(value._count ? { hotelCount: value._count.hotels ?? 0, childCount: value._count.children ?? 0 } : {})
    };
};

export const toDestinationDetail = (destination, locale) => {
    const value = localiseDestination(destination, locale);

    return {
        ...toDestinationSummary(destination, locale),
        tagline: value.tagline ?? null,
        summary: value.summary ?? null,
        description: value.description ?? [],
        heroImage: value.heroImage ?? null,
        gallery: value.gallery ?? [],
        idealFor: value.idealFor ?? [],
        attractions: value.attractions ?? [],
        travelInfo: value.travelInfo ?? null,
        parent: destination.parent ? toDestinationSummary(destination.parent, locale) : null,
        children: (destination.children ?? []).map((child) => toDestinationSummary(child, locale)),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
    };
};

/** A tree node, as assembled by `getDestinationTree`. Recursive by nature. */
export const toDestinationNode = (destination, locale) => ({
    ...toDestinationSummary(destination, locale),
    children: (destination.children ?? []).map((child) => toDestinationNode(child, locale))
});

/** What a translation row looks like coming back out of the admin editor. */
export const toDestinationTranslation = (translation) => ({
    locale: translation.locale,
    name: translation.name ?? null,
    tagline: translation.tagline ?? null,
    summary: translation.summary ?? null,
    description: translation.description ?? [],
    updatedAt: translation.updatedAt
});
