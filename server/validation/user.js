import { z } from 'zod';

import { AuditAction } from '../generated/prisma/enums.ts';
import { emailField, nameField, phoneField, textField } from './normalize.js';

/** Platform roles an invitation may create. SUPER_ADMIN is only ever made by the CLI. */
export const STAFF_INVITE_ROLES = ['ADMIN', 'MANAGEMENT', 'TOUR_OPERATOR', 'ACCOUNTANT', 'DISPATCHER'];

/** Platform roles a staff member may be moved to. Promotion to SUPER_ADMIN is a role change, not an invitation. */
export const STAFF_ROLES = ['SUPER_ADMIN', ...STAFF_INVITE_ROLES];

/** Partner roles a team invitation may create. A second owner is a role change by the first. */
export const TEAM_INVITE_ROLES = ['PARTNER_ADMIN', 'PARTNER_AGENT', 'PARTNER_FINANCE'];

export const TEAM_ROLES = ['PARTNER_OWNER', ...TEAM_INVITE_ROLES];

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'DEACTIVATED'];

const idField = z.string().min(1).max(64);

const person = {
    email: emailField,
    firstName: nameField,
    lastName: nameField,
    position: textField(80).optional(),
    phone: phoneField.optional()
};

export const inviteStaffSchema = z.object({ ...person, role: z.enum(STAFF_INVITE_ROLES) }).strict();

export const inviteTeamMemberSchema = z.object({ ...person, role: z.enum(TEAM_INVITE_ROLES) }).strict();

export const changeStaffRoleSchema = z.object({ role: z.enum(STAFF_ROLES) }).strict();

export const changeTeamRoleSchema = z.object({ role: z.enum(TEAM_ROLES) }).strict();

export const deactivateUserSchema = z.object({ reason: textField(500).optional() }).strict();

/** Typing the address back is the confirmation; nothing else is accepted in the body. */
export const deleteUserSchema = z.object({ confirm: emailField }).strict();

export const userIdParamSchema = z.object({ id: idField });

const roleFilter = (roles) =>
    z
        .union([z.enum(roles), z.array(z.enum(roles))])
        .transform((value) => (Array.isArray(value) ? value : [value]))
        .optional();

const listQuery = (roles) =>
    z.object({
        role: roleFilter(roles),
        status: z.enum(USER_STATUSES).optional(),
        q: z.string().trim().min(1).max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20)
    });

export const staffQuerySchema = listQuery(STAFF_ROLES);

export const teamQuerySchema = listQuery(TEAM_ROLES);

const instantField = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const auditQuerySchema = z
    .object({
        entityType: z.string().trim().min(1).max(64).optional(),
        entityId: idField.optional(),
        actorUserId: idField.optional(),
        action: z.enum(Object.values(AuditAction)).optional(),
        q: z.string().trim().min(1).max(120).optional(),
        from: instantField.optional(),
        to: instantField.optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50)
    })
    .refine((query) => !query.from || !query.to || query.from <= query.to, {
        message: 'from must not be after to',
        path: ['to']
    });
