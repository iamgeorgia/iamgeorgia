import { z } from 'zod';

import { amenityCodeField, emailField, nameField, phoneField, textField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';

const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
const GUEST_TYPES = ['ADULT', 'CHILD', 'INFANT'];

/**
 * A property answering a request. REQUESTED is where one starts and is not a
 * decision; WITHDRAWN belongs to the buyer, who takes it back through an
 * amendment rather than through the property's own endpoint.
 */
const REQUEST_DECISIONS = ['CONFIRMED', 'DECLINED'];

/**
 * A structured requirement on a booking.
 *
 * `code` is a machine key from the shared amenity vocabulary — never a label.
 * The display string is the client's business, so a booking made in English by
 * one agent reads in Hebrew for the colleague who opens it, which storing
 * "Shabbat elevator" in the row would have prevented for ever.
 *
 * The code is not validated against the vocabulary here. Whether this property
 * can actually do this thing is a question about the hotel, and a schema has no
 * hotel — the service answers it with a 422 naming what is unsupported.
 */
const bookingRequestSchema = z
    .object({
        // The same field the search filter validates a code with, so there is
        // one definition of the shape and a code that can be filtered on can
        // always be requested. Notably it does *not* lowercase: these are
        // camelCase machine keys, and `shabbatElevator` is not
        // `shabbatelevator`.
        code: amenityCodeField,
        note: textField(500).nullish()
    })
    .strict();

const bookingRequestsField = z
    .array(bookingRequestSchema)
    .max(20)
    .refine(
        (value) => new Set(value.map((entry) => entry.code)).size === value.length,
        { message: 'Each requirement may only be asked for once' }
    );

export const holdSchema = z.object({ token: z.string().min(20).max(4000) }).strict();

export const holdTokenParamSchema = z.object({ token: z.string().min(10).max(200) });

export const referenceParamSchema = z.object({ reference: z.string().min(1).max(64) });

/**
 * Proof that an anonymous caller is the guest who booked.
 *
 * Ignored for a signed-in admin or partner, whose session already proves it.
 */
export const guestLookupSchema = z.object({ email: emailField.optional() });

/**
 * A confirmation request.
 *
 * Note what is absent: any amount at all. The request carries identifiers,
 * dates and people; every figure is recomputed server-side. A body that could
 * name a price would be a body that could set one.
 */
export const confirmBookingSchema = z
    .object({
        // Either a hold taken at checkout, or an offer straight from search for
        // a server-to-server booking that has no checkout page.
        holdToken: z.string().min(10).max(200).optional(),
        offerToken: z.string().min(20).max(4000).optional(),

        leadGuest: z
            .object({
                firstName: nameField,
                lastName: nameField,
                email: emailField,
                phone: phoneField.optional()
            })
            .strict(),

        guests: z
            .array(
                z
                    .object({
                        type: z.enum(GUEST_TYPES).default('ADULT'),
                        firstName: nameField,
                        lastName: nameField,
                        age: z.number().int().min(0).max(120).optional()
                    })
                    .strict()
            )
            .max(20)
            .optional(),

        specialRequests: textField(1000).optional(),

        /**
         * Structured requirements, alongside the free text rather than instead
         * of it. Both, because they do different jobs: these are validated
         * against what the property offers, counted, and answered one by one;
         * `specialRequests` carries everything a vocabulary never will.
         */
        requests: bookingRequestsField.optional(),

        source: z.enum(['web', 'partner', 'admin']).default('web'),

        // Supplied by the client when it can; derived from the request when it
        // cannot. Either way a retry returns the original booking.
        idempotencyKey: z.string().min(8).max(200).optional()
    })
    .strict()
    .refine((value) => Boolean(value.holdToken) !== Boolean(value.offerToken), {
        message: 'Provide either a holdToken or an offerToken, not both',
        path: ['holdToken']
    });

export const cancelBookingSchema = z
    .object({ reason: textField(500).optional(), email: emailField.optional() })
    .strict()
    .optional()
    .default({});

/** The dashboard's window for "booked recently": a day count, never a date. */
export const bookingSummaryQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(365).default(30)
});

export const bookingQuerySchema = z.object({
    status: z.union([z.enum(BOOKING_STATUSES), z.array(z.enum(BOOKING_STATUSES))]).optional(),
    hotelId: z.string().min(1).optional(),
    partnerId: z.string().min(1).optional(),
    from: dateOnlyField.optional(),
    to: dateOnlyField.optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

/**
 * An amendment to a booking.
 *
 * What is absent is the whole design. No dates, no room, no rate, no party, no
 * amount: changing any of those changes what was sold and what it costs, and
 * that is a cancellation and a fresh booking, not an edit — the inventory has
 * to be released and re-claimed and the price re-quoted. What is left is the
 * paperwork around the sale: who is arriving, how to reach them, and what the
 * property should be told.
 *
 * `email` is not the lead guest's new address — it is the proof an anonymous
 * guest offers that the booking is theirs, exactly as `cancelBookingSchema`
 * uses it. The address being *changed* is `leadGuest.email`.
 */
export const amendBookingSchema = z
    .object({
        leadGuest: z
            .object({
                firstName: nameField.optional(),
                lastName: nameField.optional(),
                email: emailField.optional(),
                // Null clears it; the field is optional on the booking.
                phone: phoneField.nullish()
            })
            .strict()
            .optional(),

        specialRequests: textField(1000).nullish(),

        /**
         * The requirements, sent whole.
         *
         * Replacing the set rather than patching it, so withdrawing one is
         * sending the list without it — the same shape the amenity checklist
         * uses. A requirement the property has already answered is left alone
         * by the service: an agency must not be able to un-decline something by
         * asking for it again.
         */
        requests: bookingRequestsField.optional(),

        email: emailField.optional()
    })
    .strict();

/** A property's answer to one requirement. */
export const answerBookingRequestSchema = z
    .object({
        status: z.enum(REQUEST_DECISIONS),
        responseNote: textField(500).nullish()
    })
    .strict()
    .refine((value) => value.status === 'CONFIRMED' || Boolean(value.responseNote), {
        message: 'Say why it cannot be done, so the agency can tell the guest',
        path: ['responseNote']
    });

export const bookingRequestParamSchema = z.object({
    reference: z.string().min(1).max(64),
    requestId: z.string().min(1)
});
