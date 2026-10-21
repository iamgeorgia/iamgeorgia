import { z } from 'zod';
import { bookingFilterFields } from '../lib/listing/bookingFilters.js';

import { countryField, emailField, nameField, phoneField, textField } from './normalize.js';
import { titleField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';

const TOUR_BOOKING_STATUSES = ['PENDING_APPROVAL', 'PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
const TRAVELLER_TYPES = ['ADULT', 'CHILD', 'INFANT'];

export const tourHoldSchema = z.object({ token: z.string().min(20).max(4000) }).strict();
export const tourHoldTokenParamSchema = z.object({ token: z.string().min(10).max(200) });
export const tourReferenceParamSchema = z.object({ reference: z.string().min(1).max(64) });
export const tourGuestLookupSchema = z.object({ email: emailField.optional() });

/**
 * A confirmation request. As everywhere else: identifiers, dates and people,
 * never an amount. The offer or hold token names the departure and the party;
 * the price is recomputed.
 */
export const confirmTourBookingSchema = z
    .object({
        holdToken: z.string().min(10).max(200).optional(),
        offerToken: z.string().min(20).max(4000).optional(),

        leadTraveller: z
            .object({
                title: titleField.optional(),
                firstName: nameField,
                lastName: nameField,
                email: emailField,
                phone: phoneField.optional()
            })
            .strict(),

        travellers: z
            .array(
                z
                    .object({
                        type: z.enum(TRAVELLER_TYPES).default('ADULT'),
                        firstName: nameField,
                        lastName: nameField,
                        title: titleField.optional(),
                        age: z.number().int().min(0).max(120).optional(),
                        passportNumber: textField(40).optional(),
                        nationality: countryField.optional(),
                        dietary: textField(200).optional()
                    })
                    .strict()
            )
            .max(60)
            .optional(),

        specialRequests: textField(1000).optional(),
        pickupNote: textField(300).optional(),
        source: z.enum(['web', 'partner', 'admin']).default('web'),
        idempotencyKey: z.string().min(8).max(200).optional()
    })
    .strict()
    .refine((value) => Boolean(value.holdToken) !== Boolean(value.offerToken), {
        message: 'Provide either a holdToken or an offerToken, not both',
        path: ['holdToken']
    });

export const cancelTourBookingSchema = z
    .object({ reason: textField(500).optional(), email: emailField.optional() })
    .strict()
    .optional()
    .default({});

/** An operator saying no has to say why, so the agency can tell the traveller. */
export const declineTourBookingSchema = z.object({ reason: textField(500) }).strict();

export const amendTourBookingSchema = z
    .object({
        leadTraveller: z
            .object({
                firstName: nameField.optional(),
                lastName: nameField.optional(),
                email: emailField.optional(),
                phone: phoneField.nullish()
            })
            .strict()
            .optional(),
        specialRequests: textField(1000).nullish(),
        pickupNote: textField(300).nullish(),
        email: emailField.optional()
    })
    .strict();

export const tourBookingQuerySchema = z.object({
    ...bookingFilterFields,
    status: z.union([z.enum(TOUR_BOOKING_STATUSES), z.array(z.enum(TOUR_BOOKING_STATUSES))]).optional(),
    tourId: z.string().min(1).optional(),
    partnerId: z.string().min(1).optional(),
    from: dateOnlyField.optional(),
    to: dateOnlyField.optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
