// The small cryptographic pieces accounts are built on.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { DEV } from '../config.ts';

// Keys email codes. Production must set GENIE_SECRET (64 random hex characters); the development server makes a
// throwaway one, so its codes stop working when it restarts.
const SECRET = process.env.GENIE_SECRET ?? (DEV ? randomBytes(32).toString('hex') : '');
/** Without a proper secret, codes could be worked out from the database alone, so accounts stay switched off. */
export const AUTH_READY = SECRET.length >= 32;

/** An unguessable token for cookies (session, trusted device). */
export const newToken = () => randomBytes(32).toString('base64url');
/** What's stored for a token: its SHA-256, so a database leak doesn't hand out logins. */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** A six-digit email code. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
/** What's stored for an email code: keyed with the server secret, so the database alone can't be used to guess it. */
export const codeHash = (purpose: string, email: string, code: string) => createHmac('sha256', SECRET).update(`${purpose}:${email}:${code}`).digest('hex');
/** Compare two hex hashes without leaking how much of them matched through timing. */
export function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
