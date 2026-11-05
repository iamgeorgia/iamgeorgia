import { z } from 'zod';
import { bookingFilterFields } from '../lib/listing/bookingFilters.js';

import { countryField, emailField, nameField, phoneField, textField } from './normalize.js';
import { titleField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';
import { placedLocationSchema } from './domain.js';

const ORDER_STATUSES = ['PENDING_APPROVAL', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PARTIALLY_CANCELLED', 'CANCELLED', 'COMPLETED'];
const TRAVELLER_TYPES = ['ADULT', 'CHILD', 'INFANT'];

export const orderReferenceParamSchema = z.object({ reference: z.string().min(1).max(64) });
export const orderItemParamSchema = z.object({
    reference: z.string().min(1).max(64),
    slotIndex: z.coerce.number().int().min(0).max(99)
});
export const orderGuestLookupSchema = z.object({ email: emailField.optional() });

const tokenField = z.string().min(20).max(20_000);
const holdTokensField = z.record(z.string().regex(/^\d{1,2}$/), z.string().min(10).max(200)).optional();

export const orderHoldSchema = z.object({ packageToken: tokenField }).strict();
export const orderReleaseSchema = z.object({ holdTokens: z.record(z.string(), z.string().min(10).max(200)) }).strict();

/**
 * Confirming an order. The package token names every slot and its offer; the
 * people travel alongside. As everywhere: no amount.
 */
export const confirmOrderSchema = z
    .object({
        packageToken: tokenField,
        holdTokens: holdTokensField,
        leadGuest: z
            .object({ title: titleField.optional(), firstName: nameField, lastName: nameField, email: emailField, phone: phoneField.optional() })
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
        /** Structured hotel requirements, merged with the kosher profile's. */
        requests: z.array(z.object({ code: z.string().trim().min(1).max(60), note: textField(500).nullish() }).strict()).max(20).optional(),
        flightNumber: textField(20).optional(),
        pickupAddress: textField(300).optional(),
        pickupPlace: placedLocationSchema.optional(),
        preferredDriverId: z.string().min(1).optional(),
        preferredFleetVehicleId: z.string().min(1).optional(),
        source: z.enum(['web', 'partner', 'admin']).default('web'),
        idempotencyKey: z.string().min(8).max(200).optional()
    })
    .strict();

export const cancelOrderSchema = z
    .object({ reason: textField(500).optional(), email: emailField.optional() })
    .strict()
    .optional()
    .default({});

export const declineOrderItemSchema = z.object({ reason: textField(500) }).strict();

export const amendOrderSchema = z
    .object({
        leadGuest: z
            .object({
                firstName: nameField.optional(),
                lastName: nameField.optional(),
                email: emailField.optional(),
                phone: phoneField.nullish()
            })
            .strict()
            .optional(),
        specialRequests: textField(1000).nullish(),
        email: emailField.optional()
    })
    .strict();

export const orderQuerySchema = z.object({
    ...bookingFilterFields,
    status: z.union([z.enum(ORDER_STATUSES), z.array(z.enum(ORDER_STATUSES))]).optional(),
    packageId: z.string().min(1).optional(),
    partnerId: z.string().min(1).optional(),
    from: dateOnlyField.optional(),
    to: dateOnlyField.optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

// --- the cart ----------------------------------------------------------------

/**
 * One item in the cart. Each kind carries what its own product's
 * confirmation carries — an offer or hold for a hotel or a tour, a quote for
 * a transfer, the service and its date, or a whole package — never an
 * amount. A label is the buyer's own name for the line, optional.
 */
const cartTravellersField = z
    .array(
        z
            .object({
                type: z.enum(TRAVELLER_TYPES).default('ADULT'),
                firstName: nameField,
                lastName: nameField,
                title: titleField.optional(),
                age: z.number().int().min(0).max(120).optional()
            })
            .strict()
    )
    .max(60)
    .optional();

const cartRequestsField = z.array(z.object({ code: z.string().trim().min(1).max(60), note: textField(500).nullish() }).strict()).max(20).optional();
const flightField = z.string().trim().min(2).max(16);

const cartItemBase = { label: textField(120).optional() };

export const cartItemSchema = z.discriminatedUnion('type', [
    z.object({ ...cartItemBase, type: z.literal('HOTEL_STAY'), offerToken: tokenField, holdToken: z.string().min(10).max(200).optional(), travellers: cartTravellersField, requests: cartRequestsField, specialRequests: textField(1000).optional() }).strict(),
    z.object({ ...cartItemBase, type: z.literal('TOUR'), offerToken: tokenField, holdToken: z.string().min(10).max(200).optional(), travellers: cartTravellersField, specialRequests: textField(1000).optional() }).strict(),
    z
        .object({
            ...cartItemBase,
            type: z.literal('TRANSFER'),
            quoteToken: tokenField,
            flightNumber: flightField.optional(),
            flights: z.object({ outbound: flightField.nullish(), return: flightField.nullish() }).strict().optional(),
            pickupAddress: textField(300).optional(),
            dropoffAddress: textField(300).optional(),
            pickupPlace: placedLocationSchema.optional(),
            dropoffPlace: placedLocationSchema.optional(),
            preferredDriverId: z.string().min(1).max(64).optional(),
            preferredFleetVehicleId: z.string().min(1).max(64).optional()
        })
        .strict(),
    z
        .object({
            ...cartItemBase,
            type: z.literal('SERVICE'),
            serviceId: z.string().min(1),
            date: dateOnlyField,
            time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
            days: z.number().int().min(1).max(60).default(1),
            quantity: z.number().int().min(1).max(500).default(1),
            pax: z.number().int().min(1).max(500).default(1),
            quotedSellCents: z.number().int().min(0).optional()
        })
        .strict(),
    z
        .object({
            ...cartItemBase,
            type: z.literal('PACKAGE'),
            packageToken: tokenField,
            holdTokens: holdTokensField,
            travellers: cartTravellersField,
            requests: cartRequestsField,
            flightNumber: flightField.optional(),
            pickupAddress: textField(300).optional(),
            pickupPlace: placedLocationSchema.optional(),
            preferredDriverId: z.string().min(1).max(64).optional(),
            preferredFleetVehicleId: z.string().min(1).max(64).optional()
        })
        .strict()
]);

const cartItemsField = z.array(cartItemSchema).min(1).max(20);

/** The cart page's preflight: is everything still there, and at what price. */
export const quoteCustomOrderSchema = z
    .object({ items: cartItemsField, leadGuest: z.object({ firstName: nameField.optional(), lastName: nameField.optional(), email: emailField.optional() }).strict().optional() })
    .strict();

/** Holds for every hotel room and tour seat in the cart (packages hold their own slots). */
export const customHoldSchema = z.object({ items: cartItemsField }).strict();

/** Booking the cart: the items, the people, the buyer's notes. As everywhere: no amount. */
export const confirmCustomOrderSchema = z
    .object({
        items: cartItemsField,
        name: textField(120).optional(),
        leadGuest: z
            .object({ title: titleField.optional(), firstName: nameField, lastName: nameField, email: emailField, phone: phoneField.optional() })
            .strict(),
        travellers: cartTravellersField,
        requests: cartRequestsField,
        specialRequests: textField(1000).optional(),
        idempotencyKey: z.string().min(8).max(200).optional()
    })
    .strict();
