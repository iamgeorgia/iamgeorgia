import { z } from 'zod';

import { countryField, emailField, nameField, phoneField, textField } from './normalize.js';

/**
 * A desk customer: the company or person a manual booking is made for.
 * `name` is the person, or the company's legal name when `kind` is COMPANY.
 */
export const customerSchema = z
    .object({
        kind: z.enum(['INDIVIDUAL', 'COMPANY']).default('INDIVIDUAL'),
        name: nameField,
        contactName: nameField.nullish(),
        email: emailField,
        phone: phoneField.nullish(),
        billingAddress: textField(300).nullish(),
        city: textField(120).nullish(),
        country: countryField.nullish(),
        taxId: textField(40).nullish(),
        notes: textField(2000).nullish()
    })
    .strict();

/** An edit carries only what changes: no default may sneak in and reset `kind`. */
export const updateCustomerSchema = customerSchema
    .partial()
    .extend({ kind: z.enum(['INDIVIDUAL', 'COMPANY']).optional() })
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

export const customerParamSchema = z.object({ id: z.string().min(1).max(64) }).strict();

export const customerQuerySchema = z
    .object({
        q: z.string().trim().max(120).optional(),
        kind: z.enum(['INDIVIDUAL', 'COMPANY']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();
