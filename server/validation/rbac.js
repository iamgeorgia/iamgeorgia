import { z } from 'zod';

import { ALL_CAPABILITIES } from '../lib/permissions.js';
import { nameField, textField } from './normalize.js';

const capabilityField = z.string().refine((value) => ALL_CAPABILITIES.has(value), { message: 'Unknown capability' });

const capabilityList = z.array(capabilityField).max(200).transform((list) => [...new Set(list)].sort());

const roleKeyField = z.string().trim().min(3).max(41);

export const roleKeyParamSchema = z.object({ key: roleKeyField });

export const roleQuerySchema = z.object({ side: z.enum(['PLATFORM', 'PARTNER']).optional() }).strict();

export const createRoleSchema = z
    .object({
        key: z.string().trim().min(3).max(41),
        name: nameField,
        description: textField(500).nullish(),
        side: z.enum(['PLATFORM', 'PARTNER']),
        capabilities: capabilityList.default([])
    })
    .strict();

export const updateRoleSchema = z
    .object({
        name: nameField.optional(),
        description: textField(500).nullish(),
        capabilities: capabilityList.optional()
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

/** The complete set the account should hold afterwards, never a delta: what you see is what they get. */
export const setRolesSchema = z.object({ roles: z.array(roleKeyField).min(1).max(8).transform((list) => [...new Set(list)]) }).strict();

export const overrideSchema = z
    .object({
        capability: capabilityField,
        effect: z.enum(['GRANT', 'DENY']),
        reason: textField(500),
        expiresAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).nullish()
    })
    .strict()
    .refine((value) => !value.expiresAt || value.expiresAt > new Date(), { message: 'The last day must be in the future', path: ['expiresAt'] });

export const overrideParamSchema = z.object({ id: z.string().min(1).max(64), capability: capabilityField });
