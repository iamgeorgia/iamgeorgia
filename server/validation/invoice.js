import { z } from 'zod';

import { INVOICEOCEAN_LANGS } from '../config.js';
import { emailField, textField } from './normalize.js';

const idField = z.string().min(1).max(64);
const dateOnlyField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const INVOICE_KINDS = ['PROFORMA', 'VAT', 'ADVANCE', 'FINAL', 'CORRECTION'];
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'SENT', 'PAID', 'PARTIAL', 'CANCELLED', 'ERROR'];

const statusFilter = z
    .union([z.enum(INVOICE_STATUSES), z.array(z.enum(INVOICE_STATUSES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional();

const paging = {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
};

export const invoiceQuerySchema = z
    .object({
        kind: z.enum(INVOICE_KINDS).optional(),
        status: statusFilter,
        receivableId: idField.optional(),
        // A partner id, or GUEST for documents addressed to guests.
        debtorPartnerId: idField.optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional(),
        q: z.string().trim().min(1).max(120).optional(),
        ...paging
    })
    .strict();

/** A line Finance writes by hand on a document, in place of the one built from the booking (D4: the rate may differ). */
const lineSchema = z
    .object({
        description: textField(300),
        quantity: z.number().int().min(1).max(1000).default(1),
        taxRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
        totalGrossCents: z.number().int().min(-1_000_000_000).max(1_000_000_000)
    })
    .strict();

/** "Issue a document for this receivable": the kind, and optionally its language, its due date and its lines. */
export const requestInvoiceSchema = z
    .object({
        kind: z.enum(['PROFORMA', 'VAT', 'ADVANCE', 'FINAL']),
        lang: z.enum(INVOICEOCEAN_LANGS).optional(),
        dueDate: dateOnlyField.nullable().optional(),
        taxRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
        lines: z.array(lineSchema).min(1).max(50).optional()
    })
    .strict()
    .refine((body) => !body.lines || body.lines.reduce((sum, line) => sum + line.totalGrossCents, 0) > 0, {
        message: 'The lines must add up to a positive amount',
        path: ['lines']
    });

export const sendInvoiceSchema = z.object({ to: emailField.optional() }).strict();

export const cancelInvoiceSchema = z.object({ reason: textField(500).optional() }).strict();

/** Deliberately loose: InvoiceOcean's payload is its own, and only the id is relied on. */
export const webhookSchema = z.object({}).passthrough();

export const invoiceIdParamSchema = z.object({ id: idField });
export const syncEventQuerySchema = z.object(paging).strict();
