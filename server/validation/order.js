import { z } from 'zod';

import { countryField, emailField, nameField, phoneField, textField } from './normalize.js';
import { dateOnlyField } from './ratePlan.js';
import { placedLocationSchema } from './domain.js';

const ORDER_STATUSES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PARTIALLY_CANCELLED', 'CANCELLED', 'COMPLETED'];
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
            .object({ firstName: nameField, lastName: nameField, email: emailField, phone: phoneField.optional() })
            .strict(),
        travellers: z
            .array(
                z
                    .object({
                        type: z.enum(TRAVELLER_TYPES).default('ADULT'),
                        firstName: nameField,
                        lastName: nameField,
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
    status: z.union([z.enum(ORDER_STATUSES), z.array(z.enum(ORDER_STATUSES))]).optional(),
    packageId: z.string().min(1).optional(),
    partnerId: z.string().min(1).optional(),
    from: dateOnlyField.optional(),
    to: dateOnlyField.optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
