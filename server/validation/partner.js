import { z } from 'zod';

import { socialLinkSchema, partnerDocumentSchema } from './domain.js';
import {
    emailField,
    nameField,
    textField,
    phoneField,
    countryField,
    websiteField,
    ibanField,
    swiftField,
    registrationNumberField,
    passwordField,
    containsPersonal,
    PERSONAL_PASSWORD_MESSAGE
} from './normalize.js';

export const PARTNER_KINDS = ['HOTEL', 'TOUR_OPERATOR', 'TRANSPORT', 'EXPERIENCE'];

export const PARTNER_STATUSES = [
    'INVITED',
    'REGISTRATION_IN_PROGRESS',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'SUSPENDED',
    'BLOCKED',
    'TERMINATED'
];

export const PRODUCT_TYPES = ['HOTEL', 'TRANSFER', 'TOUR', 'SERVICE', 'PACKAGE'];

const idField = z.string().min(1).max(64);
const dateOnlyField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const versionField = z.string().trim().min(1).max(40);

/** The platform terms, accepted as a whole, by version. */
export const termsAcceptanceSchema = z
    .object({
        accepted: z.literal(true),
        version: versionField
    })
    .strict();

// No `.default([])` here. A default survives `.partial()` — the key would be
// filled in when it was absent — so a PATCH that did not mention socialLinks
// would silently replace them with an empty list. The create schemas opt into
// the default explicitly instead.
const socialLinksField = z.array(socialLinkSchema).max(10);
const documentsField = z.array(partnerDocumentSchema).max(20);

// 10000 basis points is 100%. Anything above it would mean paying the studio
// more than the booking was worth.
const commissionField = z.int().min(0).max(10_000);

/** Everything a company must supply before an application can be reviewed. */
export const companyFullSchema = z.object({
    name: nameField,
    legalName: nameField,
    kind: z.enum(PARTNER_KINDS),
    registrationNumber: registrationNumberField,
    legalAddress: textField(300),
    city: nameField,
    country: countryField,
    phone: phoneField,
    email: emailField,
    website: websiteField.optional(),
    socialLinks: socialLinksField.default([])
});

/**
 * What an admin knows while drafting an invitation. Only the trading name and
 * the kind are required; the invitee fills the rest in, and `companyFullSchema`
 * is what gates the transition to PENDING_APPROVAL.
 */
export const companyDraftSchema = companyFullSchema.partial().extend({
    name: nameField,
    kind: z.enum(PARTNER_KINDS)
});

export const contactSchema = z.object({
    firstName: nameField,
    lastName: nameField,
    position: nameField.optional(),
    phone: phoneField.optional(),
    email: emailField
});

export const financialSchema = z.object({
    iban: ibanField,
    swift: swiftField,
    bankName: nameField.optional(),
    accountHolder: nameField.optional()
});

/**
 * The payload an invitee submits. The account email is not taken from here —
 * it is the address the invitation was issued to — but `contact.email` must
 * match it, which the service checks against the invitation row rather than
 * trusting the body.
 */
export const registrationSchema = z
    .object({
        company: companyFullSchema,
        contact: contactSchema,
        financial: financialSchema,
        password: passwordField,
        terms: termsAcceptanceSchema
    })
    .refine(
        (value) =>
            !containsPersonal(value.password, [
                value.contact.email,
                value.contact.firstName,
                value.contact.lastName,
                value.company.name
            ]),
        { message: PERSONAL_PASSWORD_MESSAGE, path: ['password'] }
    );

/**
 * How an admin creates a partner from the panel.
 *
 *   invite   — draft the company, email a registration link, wait for the rest
 *   activate — create the account now, email a password-creation link
 *   approve  — create the account, email a password link, and approve at once
 *
 * `approve` requires the full company details, because approving a record that
 * is still missing its registration number would put a half-empty partner into
 * the live platform.
 */
export const adminCreatePartnerSchema = z
    .object({
        mode: z.enum(['invite', 'activate', 'approve']),
        company: companyDraftSchema,
        contact: contactSchema,
        financial: financialSchema.optional(),
        commissionRateBps: commissionField.optional(),
        notes: textField(2000).optional(),
        documents: documentsField.default([]),
        /**
         * The signed contract, already uploaded as a CONTRACT file. Required
         * to approve on creation unless the admin says the company trades
         * without one (`contractRequired: false`, which is audited).
         */
        contract: z
            .object({ assetId: idField, signedAt: dateOnlyField, version: versionField.optional() })
            .strict()
            .optional(),
        contractRequired: z.boolean().default(true)
    })
    .refine((value) => value.mode === 'invite' || companyFullSchema.safeParse(value.company).success, {
        message: 'Complete company details are required to create an active partner',
        path: ['company']
    })
    .refine((value) => value.mode !== 'approve' || !value.contractRequired || Boolean(value.contract), {
        message: 'A signed contract is required to approve a partner on creation',
        path: ['contract']
    });

/**
 * Fields an admin may edit. An allow-list rather than a blocklist: a column
 * added to the schema tomorrow is not editable until someone decides it should
 * be, instead of being exposed the moment it exists.
 *
 * Absent on purpose: reference, status, approvedBy*, rejectedBy*, suspendedBy*.
 * Those move only through their own endpoints, which record who did it.
 */
export const adminUpdatePartnerSchema = z
    .object({
        name: nameField,
        legalName: nameField,
        kind: z.enum(PARTNER_KINDS),
        registrationNumber: registrationNumberField,
        legalAddress: textField(300),
        city: nameField,
        country: countryField,
        phone: phoneField,
        email: emailField,
        website: websiteField.nullable(),
        socialLinks: socialLinksField,
        documents: documentsField,
        commissionRateBps: commissionField,
        notes: textField(2000).nullable()
    })
    .partial();

/**
 * What a partner user may change about themselves.
 *
 * Their email is not here. It is the login identifier and the address every
 * invitation and decision was sent to, so moving it needs a verification round
 * trip rather than a text field — an admin changes it today.
 *
 * Neither is `role`, `partnerId` or `isPrimaryContact`: those describe what
 * someone is allowed to do, and nobody decides that about themselves.
 */
export const accountUpdateSchema = z
    .object({
        firstName: nameField,
        lastName: nameField,
        position: nameField.nullable(),
        phone: phoneField.nullable()
    })
    .partial();

/**
 * What a partner may change about its company.
 *
 * Narrower than the admin's list, and deliberately missing the four fields the
 * approval was granted against — legal entity, registration number, partner
 * type and country. Letting a company rewrite its own legal identity after
 * being vetted would make the review meaningless; those go through an admin,
 * who leaves an audit row when they do it.
 */
export const partnerSelfUpdateSchema = z
    .object({
        name: nameField,
        legalAddress: textField(300),
        city: nameField,
        phone: phoneField,
        email: emailField,
        website: websiteField.nullable(),
        socialLinks: socialLinksField
    })
    .partial();

export const approveSchema = z.object({
    note: textField(2000).optional()
});

export const rejectSchema = z.object({
    /** Sent to the applicant, so it has to read as an explanation. */
    reason: textField(1000),
    /** Stays in the panel. */
    internalNote: textField(2000).optional()
});

export const suspendSchema = z.object({
    reason: textField(1000)
});

export const blockSchema = suspendSchema;

/**
 * Terminating is final, so like deletion it names the Partner ID being ended
 * and the service checks it against the record.
 */
export const terminateSchema = z.object({
    reason: textField(1000),
    confirm: z.string().trim().min(1)
});

/** The non-file half of a contract upload. The file arrives as the `file` part. */
export const contractUploadSchema = z.object({
    signedAt: dateOnlyField,
    version: versionField.optional()
});

/** Whether a company must have a signed contract on file before approval. */
export const contractRequirementSchema = z.object({
    contractRequired: z.boolean(),
    reason: textField(500)
});

export const acceptTermsSchema = z.object({ version: versionField }).strict();

const productAccessEntrySchema = z
    .object({
        productType: z.enum(PRODUCT_TYPES),
        productId: idField,
        mode: z.enum(['ALLOW', 'DENY']),
        note: textField(300).optional()
    })
    .strict();

/** The whole list, replaced as one: what is absent is removed. */
export const productAccessSchema = z
    .object({ entries: z.array(productAccessEntrySchema).max(500) })
    .strict()
    .refine(
        (value) => new Set(value.entries.map((entry) => `${entry.productType}:${entry.productId}`)).size === value.entries.length,
        { message: 'A product is listed once', path: ['entries'] }
    );

/**
 * Deleting a partner. The body carries the Partner ID being deleted, which the
 * service checks against the record — an irreversible endpoint should not be
 * reachable by a URL alone.
 */
export const deletePartnerSchema = z.object({
    confirm: z.string().trim().min(1)
});

export const inviteSchema = z.object({
    email: emailField,
    company: companyDraftSchema.optional(),
    contact: contactSchema.partial().optional(),
    /** Anything else worth replaying into the registration form. */
    prefill: z.record(z.string(), z.unknown()).optional()
});

export const financialUpdateSchema = financialSchema;

/** List filters. Coerced from strings because they arrive in a query string. */
export const partnerQuerySchema = z.object({
    status: z
        .union([z.enum(PARTNER_STATUSES), z.array(z.enum(PARTNER_STATUSES))])
        .transform((value) => (Array.isArray(value) ? value : [value]))
        .optional(),
    kind: z.enum(PARTNER_KINDS).optional(),
    country: countryField.optional(),
    q: z.string().trim().min(1).max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const idParamSchema = z.object({
    id: z.string().min(1).max(64)
});
