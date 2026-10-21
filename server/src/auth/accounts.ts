// Accounts for list owners (visitors never need one): email + password, emailed codes, login sessions and trusted
// devices. Ported from Millennium Arena's, without the usernames, profiles and settings. Genie's own tables, so its
// accounts are separate from Arena's and DeckForge's.
//
// Security rules followed here:
//   - passwords: bcrypt (cost 12); 10+ characters; common ones refused
//   - a wrong email takes as long to reject as a wrong password, and sign-up / password reset answer the same way
//     whether or not an account exists (no finding out who has an account)
//   - email codes: six digits, 10 minutes, one use, five tries, stored only as a keyed hash
//   - sessions and devices: random tokens in cookies, stored only as SHA-256; a password change or reset bumps the
//     account's session version, which ends every login at once
import bcrypt from 'bcryptjs';
import { LIMITS, type Me } from '@genie/shared';
import { one, q, tx } from '../db/index.ts';
import { Problem } from '../http.ts';
import { codeMail, FOOTER, sendMail } from './mailer.ts';
import { codeHash, newCode, newToken, sameHash, sha256 } from './security.ts';

/** The login cookie and the trusted-device cookie. */
export const SESSION_COOKIE = 'genie_session', DEVICE_COOKIE = 'genie_device';

const BCRYPT_COST = 12;
// compared against when an email has no account, so that case takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync(newToken(), BCRYPT_COST);

// ---------- checking what people type ----------
export const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
export function checkEmail(email: string) {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Problem('Enter a valid email address.');
}
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd123', '1234567890', '12345678910', 'qwertyuiop', 'qwerty1234',
  '1q2w3e4r5t', 'iloveyou12', 'letmein123', 'genie12345', 'wishlist12', 'wishlist123', 'birthday12', 'birthday123', 'christmas1',
  'christmas123', 'happybirthday', 'merrychristmas']);
export function checkPassword(pw: unknown, email = ''): string {
  const p = String(pw ?? '');
  if (p.length < 10) throw new Problem('Use at least 10 characters.');
  if (Buffer.byteLength(p) > 72) throw new Problem('That password is too long (72 bytes at most).');   // bcrypt ignores anything past 72 bytes
  const low = p.toLowerCase();
  if (COMMON.has(low) || low === email || low === email.split('@')[0] || /^(.)\1+$/.test(p) || new Set(p).size < 4) throw new Problem('That password is too easy to guess.');
  return p;
}
// invisible characters that could hide or flip how a name reads on someone's share page (zero-width and bidi controls);
// the joiners some scripts and emoji need (U+200C, U+200D) stay
const INVISIBLE = /[​‎‏؜‪-‮⁠-⁤⁦-⁩﻿]/g;
/** A display name ("Daniyal's wishlist"): any letters, spaces collapsed, 1 to 40 characters. */
export function checkName(n: unknown): string {
  const name = String(n ?? '').replace(/\p{Cc}/gu, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Problem('Enter your name.');
  if (name.length > LIMITS.name) throw new Problem(`Keep your name to ${LIMITS.name} characters.`);
  return name;
}

// ---------- email codes ----------
type Purpose = 'signup' | 'login' | 'reset' | 'email';

/** Make a code and email it (replacing any earlier one for the same email and purpose). */
async function sendCode(email: string, purpose: Purpose, what: string, payload: Record<string, unknown>) {
  const code = newCode();
  await tx(async c => {
    await c.query('delete from genie.codes where email = $1 and purpose = $2', [email, purpose]);
    await c.query(`insert into genie.codes (email, purpose, code_hash, payload, expires_at) values ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [email, purpose, codeHash(purpose, email, code), payload]);
  });
  const mail = codeMail(code, what);
  await sendMail(email, mail.subject, mail.text);
}

/** Use up a code, returning what was saved with it. Wrong guesses count; the fifth one burns the code. */
async function useCode(email: string, purpose: Purpose, code: unknown): Promise<Record<string, any>> {
  const row = await one('select id, code_hash, attempts from genie.codes where email = $1 and purpose = $2 and expires_at > now() order by id desc limit 1', [email, purpose]);
  if (!row) throw new Problem('That code has expired. Ask for a new one.');
  const typed = String(code ?? '').replace(/\D/g, '');
  if (typed.length !== 6 || !sameHash(row.code_hash, codeHash(purpose, email, typed))) {
    const tries = (await one('update genie.codes set attempts = attempts + 1 where id = $1 returning attempts', [row.id]))?.attempts ?? 5;
    if (tries >= 5) { await q('delete from genie.codes where id = $1', [row.id]); throw new Problem('Too many wrong codes. Ask for a new one.'); }
    throw new Problem("That code isn't right.");
  }
  // deleting it is what claims it: if two requests race with the right code, only one gets the row back
  const claimed = await one('delete from genie.codes where id = $1 returning payload', [row.id]);
  if (!claimed) throw new Problem('That code has already been used.');
  return claimed.payload;
}

// emails are sent in the background where waiting for them would reveal whether an account exists
const background = (p: Promise<unknown>) => p.catch(e => console.error(`email: ${e.message}`));

// ---------- sign up ----------
export interface SignupForm { name: string; email: string; password: string }
/** The sign-up form, checked (before any rate limit counts it, so a few too-easy passwords don't lock anyone out). */
export function checkSignup(nameIn: unknown, emailIn: unknown, passwordIn: unknown): SignupForm {
  const name = checkName(nameIn);
  const email = normEmail(emailIn);
  checkEmail(email);
  return { name, email, password: checkPassword(passwordIn, email) };
}

/** Emails a code; the account is only made once the code comes back (with the name and password hash kept until then). */
export async function signupStart({ name, email, password }: SignupForm) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);   // done either way, so both cases take the same time
  if (await one('select 1 from genie.users where email = $1', [email])) {
    background(sendMail(email, 'Someone tried to sign up with your email',
      `Someone (hopefully you) tried to make a Genie account with this email address, but it already has one.\n\nLog in instead, or use "Forgot password" if you need a new password.${FOOTER}`));
    return;
  }
  background(sendCode(email, 'signup', 'finish making your account', { hash, name }));
}

/** Creates the account; returns its id. */
export async function signupVerify(emailIn: unknown, code: unknown): Promise<string> {
  const email = normEmail(emailIn);
  const { hash, name } = await useCode(email, 'signup', code);
  try {
    return await tx(async c => {
      if ((await c.query('select 1 from genie.users where email = $1', [email])).rowCount) throw new Problem('That email already has an account. Log in instead.');
      const row = (await c.query('insert into genie.users (email, name, password) values ($1, $2, $3) returning id', [email, checkName(name), String(hash)])).rows[0];
      return row.id as string;
    });
  } catch (e: any) {
    if (e.code === '23505') throw new Problem('That email already has an account. Log in instead.');   // two sign-ups raced
    throw e;
  }
}

// ---------- log in ----------
/** Checks the password. A trusted device logs straight in; otherwise a code goes to the email. */
export async function loginStart(emailIn: unknown, passwordIn: unknown, deviceToken?: string): Promise<{ userId: string } | { needCode: true }> {
  const email = normEmail(emailIn);
  const user = await one('select id, password from genie.users where email = $1', [email]);
  const ok = await bcrypt.compare(String(passwordIn ?? '').slice(0, 200), user?.password ?? DUMMY_HASH);
  if (!user?.password || !ok) throw new Problem('Email or password is incorrect.', 401);
  if (await isTrusted(user.id, deviceToken)) return { userId: user.id };
  await sendCode(email, 'login', 'log in on a new device', { userId: user.id });
  return { needCode: true };
}

export async function loginVerify(emailIn: unknown, code: unknown): Promise<string> {
  const { userId } = await useCode(normEmail(emailIn), 'login', code);
  return String(userId);
}

// ---------- forgotten password ----------
export async function forgotStart(emailIn: unknown) {
  const email = normEmail(emailIn);
  checkEmail(email);
  const user = await one('select id from genie.users where email = $1', [email]);
  if (user) background(sendCode(email, 'reset', 'choose a new password', { userId: user.id }));
}

/** Sets the new password and signs the account out everywhere; returns the account id. */
export async function forgotVerify(emailIn: unknown, code: unknown, passwordIn: unknown): Promise<string> {
  const email = normEmail(emailIn);
  const password = checkPassword(passwordIn, email);   // checked first, so a weak password doesn't use up the code
  const { userId } = await useCode(email, 'reset', code);
  await newPassword(String(userId), password);
  return String(userId);
}

async function newPassword(userId: string, password: string) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await tx(async c => {
    await c.query('update genie.users set password = $2, session_version = session_version + 1 where id = $1', [userId, hash]);
    await c.query('delete from genie.sessions where user_id = $1', [userId]);
    await c.query('delete from genie.devices where user_id = $1', [userId]);
  });
}

// ---------- sessions and devices ----------
/** Starts a login. It also counts as the account being used, for the two-year clean-up, and clears any warning about it. */
export async function createSession(userId: string, userAgent = ''): Promise<string> {
  const token = newToken();
  const user = await one('update genie.users set last_seen_at = now(), warned_at = null where id = $1 returning session_version as v', [userId]);
  if (!user) throw new Problem('That account no longer exists.', 401);
  await q(`insert into genie.sessions (token_hash, user_id, session_version, expires_at, user_agent) values ($1, $2, $3, now() + interval '30 days', $4)`,
    [sha256(token), userId, user.v, userAgent.slice(0, 200)]);
  return token;
}

/** The account behind a session cookie, or null (expired, unknown, or ended by a password change). */
export async function sessionUser(token: string | undefined): Promise<Me | null> {
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  const row = await one(`select s.user_id, s.session_version, s.last_seen, u.session_version as current_version, u.email, u.name
    from genie.sessions s join genie.users u on u.id = s.user_id
    where s.token_hash = $1 and s.expires_at > now()`, [hash]);
  if (!row) return null;
  if (row.session_version !== row.current_version) { await q('delete from genie.sessions where token_hash = $1', [hash]); return null; }
  // keep active logins alive, and the account marked as in use (at most one write an hour; clears any deletion warning)
  if (Date.now() - new Date(row.last_seen).getTime() > 3600_000)
    await q(`with s as (update genie.sessions set last_seen = now(), expires_at = now() + interval '30 days' where token_hash = $1 returning user_id)
      update genie.users set last_seen_at = now(), warned_at = null where id = (select user_id from s)`, [hash]);
  return { id: row.user_id, email: row.email, name: row.name };
}

export const endSession = (token: string | undefined) => (token ? q('delete from genie.sessions where token_hash = $1', [sha256(token)]) : Promise.resolve([]));

export async function trustDevice(userId: string, label: string): Promise<string> {
  const token = newToken();
  await q(`insert into genie.devices (token_hash, user_id, label, expires_at) values ($1, $2, $3, now() + interval '30 days')`, [sha256(token), userId, label.slice(0, 80)]);
  return token;
}

export const isTrusted = async (userId: string, deviceToken: string | undefined) =>
  !!deviceToken && deviceToken.length <= 100 && !!(await one('select 1 from genie.devices where token_hash = $1 and user_id = $2 and expires_at > now()', [sha256(deviceToken), userId]));

/** A browser that skips the emailed code (the same shape as Arena's). Times are ISO strings; `current` = the one asking. */
export interface TrustedDevice { id: string; label: string; created_at: string; expires_at: string; current: boolean }

/** Trusted devices, identified by a short, harmless part of their hash. */
export async function listDevices(userId: string): Promise<Omit<TrustedDevice, 'current'>[]> {
  const rows = await q<{ id: string; label: string; created_at: Date; expires_at: Date }>(`select left(token_hash, 12) as id, label, created_at, expires_at
    from genie.devices where user_id = $1 and expires_at > now() order by created_at desc`, [userId]);
  return rows.map(r => ({ id: r.id, label: r.label, created_at: r.created_at.toISOString(), expires_at: r.expires_at.toISOString() }));
}
export const forgetDevice = (userId: string, id: unknown) =>
  q('delete from genie.devices where user_id = $1 and left(token_hash, 12) = $2', [userId, String(id ?? '').slice(0, 12)]);

// ---------- account settings ----------
export async function setName(userId: string, nameIn: unknown) {
  await q('update genie.users set name = $2 where id = $1', [userId, checkName(nameIn)]);
}

async function checkCurrentPassword(userId: string, password: unknown) {
  const user = await one('select password from genie.users where id = $1', [userId]);
  if (!user?.password || !(await bcrypt.compare(String(password ?? '').slice(0, 200), user.password))) throw new Problem('Your current password is incorrect.', 401);
}

/** Changes the password; every other login ends. The caller gets a fresh session. */
export async function changePassword(userId: string, current: unknown, next: unknown, email: string) {
  await checkCurrentPassword(userId, current);
  await newPassword(userId, checkPassword(next, email));
}

/** Signs out every login and forgets every trusted device. The caller gets a fresh session. */
export async function logoutEverywhere(userId: string) {
  await tx(async c => {
    await c.query('update genie.users set session_version = session_version + 1 where id = $1', [userId]);
    await c.query('delete from genie.sessions where user_id = $1', [userId]);
    await c.query('delete from genie.devices where user_id = $1', [userId]);
  });
}

/** Emails a code to the new address; nothing changes until it comes back. */
export async function changeEmailStart(userId: string, newEmailIn: unknown, password: unknown, oldEmail: string) {
  await checkCurrentPassword(userId, password);
  const email = normEmail(newEmailIn);
  checkEmail(email);
  if (email === oldEmail) throw new Problem("That's already your email.");
  if (await one('select 1 from genie.users where email = $1', [email])) throw new Problem('That email already has an account.');
  await sendCode(email, 'email', 'confirm your new email address', { userId });
}

export async function changeEmailVerify(userId: string, newEmailIn: unknown, code: unknown, oldEmail: string) {
  const email = normEmail(newEmailIn);
  const payload = await useCode(email, 'email', code);
  if (payload.userId !== userId) throw new Problem('That code is for a different account.', 403);
  try {
    await q('update genie.users set email = $2 where id = $1', [userId, email]);
  } catch (e: any) {
    if (e.code === '23505') throw new Problem('That email already has an account.');   // unique violation
    throw e;
  }
  background(sendMail(oldEmail, 'Your email address was changed',
    `The email address on your Genie account was changed to ${email}.\n\nIf this wasn't you, email mail@daniyalzia.co.uk straight away to get your account back.${FOOTER}`));
}

/** Deletes the account and everything in it (the database removes its lists, wishes and grants with it). */
export async function deleteAccount(userId: string, password: unknown) {
  await checkCurrentPassword(userId, password);
  await q('delete from genie.users where id = $1', [userId]);
}
