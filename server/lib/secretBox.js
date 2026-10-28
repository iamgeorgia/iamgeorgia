import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Seals a secret for storage at rest: AES-256-GCM, a fresh 96-bit IV per seal,
 * and associated data naming what the secret is for, so a ciphertext copied
 * from one column to another fails to open rather than being used as
 * something it is not.
 *
 * The output is `v1.<iv>.<tag>.<ciphertext>`, base64url. The version prefix
 * leaves room for a key rotation that can tell old rows from new ones.
 */
const VERSION = 'v1';

const assertKey = (key) => {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
        throw new Error('A sealing key must be exactly 32 bytes');
    }
};

export const seal = (plaintext, { key, aad }) => {
    assertKey(key);

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    cipher.setAAD(Buffer.from(aad, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
};

/** Opens what `seal` produced. Throws on a wrong key, wrong `aad` or any tampering. */
export const open = (sealed, { key, aad }) => {
    assertKey(key);

    const parts = String(sealed ?? '').split('.');

    if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error('Sealed value is not in a recognised format');
    }

    const [, iv, tag, ciphertext] = parts.map((part, index) => (index === 0 ? part : Buffer.from(part, 'base64url')));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);

    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};
