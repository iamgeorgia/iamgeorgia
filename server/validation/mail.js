import { z } from 'zod';

/**
 * The return from Google's consent screen. Google adds parameters of its own
 * (`scope`, `authuser`, `prompt`, `hd`), so unknown keys are dropped rather
 * than refused; only these three are ever read, and each is bounded.
 */
export const googleCallbackQuerySchema = z.object({
    code: z.string().min(1).max(2048).optional(),
    state: z.string().min(1).max(200).optional(),
    error: z.string().min(1).max(100).optional()
});
