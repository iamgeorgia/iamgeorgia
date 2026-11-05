import { z } from 'zod';

// Shared field primitives for request bodies. Normalization lives inside the
// schema rather than in each route, so an address can never reach the database
// in a casing the next lookup will miss.

/** Lowercased and trimmed, because an email is the login identifier. */
export const emailField = z.string().trim().toLowerCase().pipe(z.email());

export const nameField = z.string().trim().min(1).max(120);

export const textField = (max = 500) => z.string().trim().min(1).max(max);

/**
 * E.164-ish: digits, optionally led by a plus. Everything a human types to
 * make a number readable — spaces, dashes, brackets, dots — is stripped, so
 * "+995 (32) 2-123-456" and "+995322123456" are stored identically.
 */
/** An honorific, printed on documents only when given. */
export const titleField = z.enum(['MR', 'MRS', 'MS', 'MISS', 'MSTR']);

export const phoneField = z
    .string()
    .trim()
    .transform((value) => {
        const digits = value.replace(/\D/g, '');

        return value.trimStart().startsWith('+') ? `+${digits}` : digits;
    })
    .refine((value) => /^\+?\d{7,15}$/.test(value), {
        message: 'Enter a valid phone number, 7 to 15 digits'
    });

/** ISO 3166-1 alpha-2. Two letters is the whole contract; no table to ship. */
export const countryField = z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => /^[A-Z]{2}$/.test(value), {
        message: 'Use a two-letter ISO country code, for example GE'
    });

/**
 * Accepts a bare domain and stores an absolute URL, so the admin panel can
 * always render it as a working link rather than a relative path.
 */
export const websiteField = z
    .string()
    .trim()
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .pipe(z.url())
    .refine((value) => value.length <= 300, { message: 'URL is too long' });

/**
 * A URL segment. Lowercased and trimmed, and deliberately strict: a slug is
 * part of a public URL and of the destination path used for prefix search, so
 * a stray slash or space in one would silently break `path LIKE` matching for
 * everything beneath it.
 */
export const slugField = z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), {
        message: 'Use lowercase letters, numbers and single hyphens, for example bakuriani'
    })
    .refine((value) => value.length >= 2 && value.length <= 120, {
        message: 'Slug must be between 2 and 120 characters'
    });

/**
 * An IANA time zone, checked against the runtime's own tz database rather than
 * a shipped list, which would rot.
 *
 * This is not cosmetic. Cancellation deadlines and "is this date still
 * bookable" are resolved in the property's zone, so a value Intl cannot parse
 * would throw at the worst possible moment — mid-booking — instead of here.
 */
export const timezoneField = z
    .string()
    .trim()
    .refine(
        (value) => {
            try {
                new Intl.DateTimeFormat('en-US', { timeZone: value });
                return true;
            } catch {
                return false;
            }
        },
        { message: 'Use an IANA time zone, for example Asia/Tbilisi' }
    );

/**
 * An amenity code, as a filter value.
 *
 * Deliberately **not** `slugField`, which lowercases. Amenity codes are stable
 * camelCase machine keys — `skiStorage`, `shabbatElevator`, `airConditioning` —
 * and lowercasing one produces a string that matches no row at all. Filtering
 * by any of the twenty-six capitalised codes in the seed therefore returned an
 * empty result rather than an error, which is the worst way for a filter to
 * fail: silently, and looking like "no properties match".
 *
 * Case is preserved and the shape is checked instead. Hyphens and digits are
 * allowed because the test factories and any future generated code use them.
 */
export const amenityCodeField = z
    .string()
    .trim()
    .refine((value) => /^[A-Za-z][A-Za-z0-9-]*$/.test(value), {
        message: 'Use an amenity code, for example shabbatElevator'
    })
    .refine((value) => value.length <= 60, { message: 'Amenity code is too long' });

/** Latitude and longitude, as a pair or not at all — see the check constraint. */
export const latitudeField = z.number().min(-90).max(90);
export const longitudeField = z.number().min(-180).max(180);

/** ISO 4217. Three letters, uppercased; the currency table is the market's. */
export const currencyField = z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => /^[A-Z]{3}$/.test(value), {
        message: 'Use a three-letter ISO currency code, for example GEL'
    });

/** Wall-clock time at a property, `HH:MM` on a 24-hour clock. */
export const clockTimeField = z
    .string()
    .trim()
    .refine((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value), {
        message: 'Use a 24-hour time, for example 14:00'
    });

/**
 * IBAN with the mod-97 check from ISO 7064.
 *
 * A length-and-shape regex alone accepts a mistyped digit, and a wrong IBAN is
 * only discovered when a payment bounces weeks later — the checksum catches
 * almost every single-character slip at the point of entry.
 */
export const ibanField = z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine((value) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(value), {
        message: 'Enter a valid IBAN'
    })
    .refine(
        (value) => {
            const rearranged = value.slice(4) + value.slice(0, 4);
            const numeric = rearranged.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));

            // The number is far wider than a float can hold exactly, so the
            // remainder is taken in chunks rather than in one division.
            let remainder = 0;

            for (const digit of numeric) {
                remainder = (remainder * 10 + Number(digit)) % 97;
            }

            return remainder === 1;
        },
        { message: 'IBAN checksum is not valid' }
    );

/** SWIFT/BIC: 4 bank, 2 country, 2 location, optional 3 branch. */
export const swiftField = z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/\s/g, ''))
    .refine((value) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value), {
        message: 'Enter a valid SWIFT/BIC code'
    });

/** Uppercased so a duplicate cannot slip past the unique index on casing. */
export const registrationNumberField = z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/\s/g, ''))
    .refine((value) => /^[A-Z0-9-]{4,32}$/.test(value), {
        message: 'Enter a valid company registration number'
    });

// Long enough that the length itself carries the strength, rather than
// composition rules that mostly teach people to append "1!".
const MIN_PASSWORD_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
    'password',
    'password1',
    'password123',
    'passw0rd',
    '123456789012',
    '1234567890123',
    'qwertyuiop',
    'iloveyou123',
    'administrator',
    'letmein12345',
    'welcome12345',
    'changeme1234',
    'partner12345'
]);

export const passwordField = z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(200)
    .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
        message: 'That password is too common'
    });

export const PERSONAL_PASSWORD_MESSAGE = 'Password must not contain your name or email address';

/**
 * True when a password merely repeats something already known about the
 * account. Kept as a plain predicate rather than a zod refinement because the
 * values to compare against are not always in the same payload: at
 * registration they are, at activation they come from the token's user.
 */
export const containsPersonal = (password, candidates = []) => {
    const secret = String(password ?? '').toLowerCase();

    if (!secret) {
        return false;
    }

    return candidates
        .filter((candidate) => typeof candidate === 'string')
        // The local part of an email counts, so "nino@partner.ge" does not let
        // "nino-partner-ge" through on a technicality.
        .flatMap((candidate) => [candidate, candidate.split('@')[0]])
        .map((candidate) => candidate.toLowerCase().trim())
        .filter((candidate) => candidate.length >= 4)
        .some((candidate) => secret.includes(candidate));
};
