import { z } from 'zod';

import { emailField, textField } from './normalize.js';

/**
 * Request shapes for card payments. The money is never in a request: the
 * amount comes from the receivable on the server, and a callback is read by
 * lib/integrations/flitt/parse.js rather than a schema, because its bytes
 * must stay exactly as signed.
 */

const idField = z.string().min(1).max(64);
const referenceField = z.string().trim().min(3).max(40);
const localeField = z.enum(['en', 'ka', 'ru', 'he']);
const booleanQuery = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

export const PSP_PAYMENT_STATUSES = ['CREATED', 'REDIRECT_READY', 'PROCESSING', 'APPROVED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'MISMATCH', 'FAILED'];
export const PSP_MODES = ['TEST', 'LIVE'];

/** A guest asks to pay a booking or order by card. */
export const createPaymentSchema = z
    .object({
        reference: referenceField,
        email: emailField,
        idempotencyKey: z.string().trim().min(8).max(200).optional(),
        locale: localeField.optional()
    })
    .strict();

export const paymentIdParamSchema = z.object({ id: idField }).strict();

const listParam = z.union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).max(20)]).transform((value) => (Array.isArray(value) ? value : [value]));

/** What a checkout holds, to learn the rule it will book under. Repeated parameters for a cart. */
export const checkoutRulesQuerySchema = z
    .object({
        hotelHold: listParam.optional(),
        tourHold: listParam.optional(),
        vehicleId: listParam.optional(),
        packageSlug: listParam.optional()
    })
    .strict();

/** The return URL's path: the payment and the token handed out with its checkout URL. */
export const returnParamSchema = z.object({ id: idField, token: z.string().min(16).max(64) }).strict();

export const returnQuerySchema = z.object({ cancel: booleanQuery.optional() }).passthrough();

/** Reading one payment: a guest proves the token, staff prove a capability. */
export const paymentReadQuerySchema = z.object({ t: z.string().min(16).max(64).optional() }).strict();

export const retryPaymentSchema = z
    .object({
        idempotencyKey: z.string().trim().min(8).max(200).optional(),
        locale: localeField.optional()
    })
    .strict();

/** The finance list. Filters travel in the URL. */
export const adminPaymentsListSchema = z
    .object({
        status: z.enum(PSP_PAYMENT_STATUSES).optional(),
        mode: z.enum(PSP_MODES).optional(),
        q: z.string().trim().min(1).max(120).optional(),
        from: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
        to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
        attention: booleanQuery.optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();

/** A refund request against a card payment: amount and why. Opens an approval. */
export const refundPaymentSchema = z
    .object({
        amountCents: z.number().int().positive().max(1_000_000_000),
        reason: textField(500),
        note: textField(1000).optional()
    })
    .strict();

// --- payment policy templates (tours, transfers, packages) ----------------------

const TEMPLATE_KINDS = ['TOUR', 'TRANSFER', 'PACKAGE'];
const TIMINGS = ['PAY_NOW', 'PAY_LATER', 'DEPOSIT', 'PAY_AT_HOTEL', 'CREDIT_ACCOUNT'];

const templateFields = {
    name: textField(120),
    timing: z.enum(TIMINGS),
    depositBps: z.number().int().min(0).max(10_000).nullish(),
    balanceDueDaysBeforeCheckIn: z.number().int().min(0).max(365).nullish(),
    unpaidCancelHours: z.number().int().min(1).max(720).nullish(),
    cardOptional: z.boolean().optional(),
    description: textField(1000).nullish(),
    isActive: z.boolean().optional()
};

const depositNeedsBps = (policy) => policy.timing === undefined || policy.timing !== 'DEPOSIT' || (policy.depositBps ?? 0) > 0;

export const paymentPolicyTemplateSchema = z
    .object({ ...templateFields, productKind: z.enum(TEMPLATE_KINDS) })
    .strict()
    .refine(depositNeedsBps, { message: 'A deposit policy needs a deposit percentage', path: ['depositBps'] });

export const paymentPolicyTemplateUpdateSchema = z
    .object(Object.fromEntries(Object.entries(templateFields).map(([key, schema]) => [key, schema.optional()])))
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' })
    .refine(depositNeedsBps, { message: 'A deposit policy needs a deposit percentage', path: ['depositBps'] });

export const paymentPolicyTemplatesQuerySchema = z
    .object({
        productKind: z.enum(TEMPLATE_KINDS).optional(),
        includeInactive: booleanQuery.optional()
    })
    .strict();

/** Attaching a template to a transfer provider; null returns it to the platform default. */
export const assignPaymentPolicySchema = z.object({ paymentPolicyId: idField.nullable() }).strict();
export const providerIdParamSchema = z.object({ providerId: idField }).strict();

/** Finance resolving a MISMATCH by hand. */
export const resolveMismatchSchema = z
    .object({
        action: z.enum(['ACCEPT_ACTUAL', 'CLOSE']),
        note: textField(1000)
    })
    .strict();
