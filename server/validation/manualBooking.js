import { z } from 'zod';

import { MANUAL_CHANNELS } from '../lib/booking/source.js';
import { textField } from './normalize.js';
import { customerSchema } from './customer.js';
import { confirmBookingSchema } from './booking.js';
import { confirmTransferSchema } from './transfer.js';
import { confirmTourBookingSchema } from './tourBooking.js';
import { confirmServiceBookingSchema } from './service.js';
import { confirmCustomOrderSchema, confirmOrderSchema } from './order.js';

/**
 * A booking made at the desk: who it is for, where it came from, and the
 * product's ordinary confirmation body underneath. The product body is
 * nested rather than merged so each product's own schema — holds, tokens,
 * travellers — is reused untouched, refinements and all.
 *
 * `priceAdjustment` needs `bookings.price.override`; `confirmNow` needs
 * `bookings.approve` (checked in the service, where the actor is known).
 */
const idField = z.string().min(1).max(64);

const buyerSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('PARTNER'), partnerId: idField }).strict(),
    z
        .object({ kind: z.literal('CUSTOMER'), customerId: idField.optional(), customer: customerSchema.optional() })
        .strict()
        .refine((buyer) => Boolean(buyer.customerId) !== Boolean(buyer.customer), {
            message: 'Name an existing customer or describe a new one, not both',
            path: ['customerId']
        })
]);

const envelope = {
    buyer: buyerSchema,
    channel: z.enum(MANUAL_CHANNELS),
    confirmNow: z.boolean().default(false),
    priceAdjustment: z
        .object({ cents: z.number().int().min(-10_000_000).max(10_000_000), reason: textField(300) })
        .strict()
        .refine((value) => value.cents !== 0, { message: 'An adjustment of nothing is not one', path: ['cents'] })
        .optional(),
    assignedManagerUserId: idField.nullish(),
    internalNotes: textField(2000).nullish()
};

export const manualHotelBookingSchema = z.object({ ...envelope, booking: confirmBookingSchema }).strict();
export const manualTransferBookingSchema = z.object({ ...envelope, booking: confirmTransferSchema }).strict();
export const manualTourBookingSchema = z.object({ ...envelope, booking: confirmTourBookingSchema }).strict();
export const manualServiceBookingSchema = z.object({ ...envelope, booking: confirmServiceBookingSchema }).strict();
export const manualOrderSchema = z.object({ ...envelope, booking: confirmOrderSchema }).strict();
export const manualCartSchema = z.object({ ...envelope, booking: confirmCustomOrderSchema }).strict();

/** The desk's fields that may change after the booking exists. */
export const deskUpdateSchema = z
    .object({
        assignedManagerUserId: idField.nullable().optional(),
        internalNotes: textField(2000).nullable().optional()
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
