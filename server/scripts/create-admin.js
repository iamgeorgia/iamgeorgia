import { randomBytes } from 'node:crypto';

import { prisma, disconnect } from '../db/index.js';
import { hashPassword } from '../lib/password.js';
import { primaryRoleIdFor } from '../services/rbac/access.js';
import { emailField } from '../validation/normalize.js';

/**
 * Bootstraps an administrator.
 *
 * There is no sign-up for admins and there should not be: the first account has
 * to come from someone with shell access to the server, and every one after it
 * from an admin already inside the panel. Run as:
 *
 *   node scripts/create-admin.js tamar@iamgeorgia.travel Tamar Gelashvili [password]
 *   node scripts/create-admin.js tamar@iamgeorgia.travel Tamar Gelashvili --if-missing
 *
 * With no password one is generated and printed once. It is never printed again
 * and cannot be recovered — use the password reset flow if it is lost.
 *
 * An existing account is an error, because running this twice by hand is
 * almost always a mistake — except from `seed-all.js`, which is idempotent and
 * passes `--if-missing` so a second seed of the same database leaves the
 * account, and its changed password, alone.
 */
const ifMissing = process.argv.includes('--if-missing');
const [, , rawEmail, firstName, lastName, rawPassword] = process.argv.filter((arg) => arg !== '--if-missing');

const usage = () => {
    console.error('Usage: node scripts/create-admin.js <email> <firstName> <lastName> [password]');
    process.exitCode = 1;
};

const run = async () => {
    if (!rawEmail || !firstName || !lastName) {
        return usage();
    }

    const parsed = emailField.safeParse(rawEmail);

    if (!parsed.success) {
        console.error(`Not a valid email address: ${rawEmail}`);
        process.exitCode = 1;
        return;
    }

    const email = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email }, include: { primaryRole: { select: { key: true } } } });

    if (existing) {
        if (ifMissing) {
            console.log(`An account already exists for ${email} (role ${existing.primaryRole.key}) — left as is.`);
            return;
        }

        console.error(`An account already exists for ${email} (role ${existing.primaryRole.key}).`);
        process.exitCode = 1;
        return;
    }

    // 24 random bytes, not a memorable phrase: this is a bootstrap credential
    // meant to be pasted once and then changed.
    const password = rawPassword || randomBytes(24).toString('base64url');

    const user = await prisma.user.create({
        data: {
            email,
            firstName,
            lastName,
            primaryRoleId: await primaryRoleIdFor(prisma, 'SUPER_ADMIN'),
            passwordHash: await hashPassword(password),
            // Admins carry no partnerId; the side trigger on users enforces it.
            partnerId: null
        }
    });

    console.log(`Created SUPER_ADMIN ${user.email} (${user.id})`);

    if (!rawPassword) {
        console.log(`Password: ${password}`);
        console.log('This is the only time it will be shown.');
    }
};

try {
    await run();
} finally {
    await disconnect();
}
