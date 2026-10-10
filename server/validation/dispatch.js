import { z } from 'zod';

import { textField } from './normalize.js';
import { dateOnlyField } from './fleet.js';

/**
 * Dispatch: assigning drivers and cars to legs, and moving legs along.
 *
 * Every schema is `.strict()`. Milestone *times* are never in a request — a
 * status update names the state it wants and the server stamps the clock —
 * so a phone with the wrong time cannot backdate an arrival.
 */

export const LEG_STATUSES = [
    'UNASSIGNED',
    'ASSIGNED',
    'ACCEPTED',
    'EN_ROUTE',
    'ARRIVED',
    'ON_BOARD',
    'COMPLETED',
    'NO_SHOW_REPORTED',
    'NO_SHOW',
    'CANCELLED'
];

const ASSIGNMENT_STATUSES = ['OFFERED', 'ACCEPTED', 'DECLINED', 'REVOKED', 'COMPLETED', 'NO_SHOW'];

const BLOCK_REASONS = ['DAY_OFF', 'SICK', 'MAINTENANCE', 'OTHER'];

const idField = z.string().min(1).max(64);

const instantField = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const legStatusFilter = z.union([z.enum(LEG_STATUSES), z.array(z.enum(LEG_STATUSES))]).optional();

export const dispatchQuerySchema = z
    .object({
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional(),
        legStatus: legStatusFilter,
        driverId: idField.optional(),
        search: z.string().trim().min(1).max(80).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50)
    })
    .strict();

export const assignSchema = z
    .object({
        driverId: idField,
        fleetVehicleId: idField.nullish(),
        /** Confirmed by phone: the offer is recorded as accepted. */
        acceptOnBehalf: z.boolean().default(false),
        overrideClassMismatch: z.boolean().default(false),
        overrideVehicleLink: z.boolean().default(false),
        overrideUnverified: z.boolean().default(false),
        /** "Wait at the airport for the delayed flight": extends the occupancy. */
        windowEndOverride: instantField.optional(),
        note: textField(1000).nullish()
    })
    .strict();

export const reasonSchema = z
    .object({
        reason: textField(500)
    })
    .strict();

export const optionalReasonSchema = z
    .object({
        reason: textField(500).nullish()
    })
    .strict();

export const legStatusSchema = z
    .object({
        to: z.enum(LEG_STATUSES),
        /** The state the client believes the leg is in. A mismatch is a 409, not a leap. */
        expectedFrom: z.enum(LEG_STATUSES).optional(),
        note: textField(1000).nullish()
    })
    .strict();

export const assignmentQuerySchema = z
    .object({
        driverId: idField.optional(),
        fleetVehicleId: idField.optional(),
        status: z.union([z.enum(ASSIGNMENT_STATUSES), z.array(z.enum(ASSIGNMENT_STATUSES))]).optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50)
    })
    .strict();

export const occupancyQuerySchema = z
    .object({
        driverId: idField.optional(),
        fleetVehicleId: idField.optional(),
        providerId: idField.optional(),
        from: dateOnlyField,
        to: dateOnlyField
    })
    .strict();

export const createBlockSchema = z
    .object({
        driverId: idField.nullish(),
        fleetVehicleId: idField.nullish(),
        startsAt: instantField,
        endsAt: instantField,
        reason: z.enum(BLOCK_REASONS),
        note: textField(500).nullish()
    })
    .strict()
    .refine((body) => Boolean(body.driverId) !== Boolean(body.fleetVehicleId), {
        message: 'A block names a driver or a car, not both and not neither',
        path: ['driverId']
    })
    .refine((body) => body.endsAt > body.startsAt, {
        message: 'A block ends after it starts',
        path: ['endsAt']
    });

export const blockQuerySchema = z
    .object({
        driverId: idField.optional(),
        fleetVehicleId: idField.optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional()
    })
    .strict();

/** The driver's list: what is next, what is ahead, what is done. */
export const driverAssignmentQuerySchema = z
    .object({
        scope: z.enum(['today', 'upcoming', 'history']).default('upcoming'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25)
    })
    .strict();

export const legParamSchema = z.object({ legId: idField });
export const assignmentParamSchema = z.object({ id: idField });
export const blockParamSchema = z.object({ id: idField });

// The bell's schemas moved to validation/notification.js when the admin
// panel and the portal grew bells of their own; re-exported so the driver
// router keeps importing them from here.
export { notificationQuerySchema, notificationParamSchema } from './notification.js';
