import { z } from 'zod';

import { textField } from './normalize.js';

const FILE_CATEGORIES = [
    'HOTEL_IMAGE',
    'ROOM_IMAGE',
    'AMENITY_ICON',
    'CONTRACT',
    'RATE_SHEET',
    'INVOICE',
    'VOUCHER',
    'IMPORT',
    'KOSHER_CERTIFICATE',
    'FLEET_IMAGE',
    'DRIVER_PHOTO',
    'DRIVER_DOCUMENT',
    'VEHICLE_DOCUMENT',
    'PAYMENT_ATTACHMENT',
    'OTHER'
];

const IMAGE_CATEGORIES = [
    'Exterior',
    'Lobby',
    'Restaurant',
    'Pool',
    'Spa',
    'Room',
    'Bathroom',
    'View',
    'Facilities'
];

export const idParamSchema = z.object({ id: z.string().min(1) });

export const hotelImageParamSchema = z.object({
    id: z.string().min(1),
    imageId: z.string().min(1)
});

/**
 * The non-file half of a multipart upload.
 *
 * Note what is absent: `visibility`. It is decided by category in
 * `upload.service.js`, so a client cannot ask for a contract to be public.
 * Note also that the declared MIME type is not here — it arrives on the file
 * part, and it is treated as a claim to be checked against the bytes rather
 * than as information.
 */
export const uploadSchema = z.object({
    category: z.enum(FILE_CATEGORIES),
    altText: textField(300).optional(),
    partnerId: z.string().min(1).optional()
});

export const mediaQuerySchema = z.object({
    category: z.union([z.enum(FILE_CATEGORIES), z.array(z.enum(FILE_CATEGORIES))]).optional(),
    partnerId: z.string().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

export const attachHotelImageSchema = z
    .object({
        fileAssetId: z.string().min(1),
        category: z.enum(IMAGE_CATEGORIES).default('Exterior'),
        caption: textField(300).nullish(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
        isCover: z.boolean().optional()
    })
    .strict();

export const updateHotelImageSchema = z
    .object({
        category: z.enum(IMAGE_CATEGORIES),
        caption: textField(300).nullable(),
        sortOrder: z.number().int().min(0).max(9999),
        isCover: z.boolean()
    })
    .strict()
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
        message: 'Provide at least one field to update'
    });

/** Reordering a gallery: the whole order, in one call, so it cannot half-apply. */
export const reorderHotelImagesSchema = z
    .object({ order: z.array(z.string().min(1)).min(1).max(500) })
    .strict();
