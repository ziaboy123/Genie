// The account API (under <base>/api): sign up, log in, codes, account settings. JSON in, JSON out.
//
// Changes must be POSTed JSON from this site (see http.ts), and rate limits slow down password guessing, code
// guessing and code spamming (which also protects the Resend quota).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEV } from '../config.ts';
import { cookie, cookies, clientIp, deviceLabel, Problem, readJson, sameOrigin, send, sendError, tooMany } from '../http.ts';
import { limited } from '../ratelimit.ts';
import * as A from './accounts.ts';
import { devOutbox, MAIL_READY } from './mailer.ts';
import { AUTH_READY, sha256 } from './security.ts';

const SESSION = A.SESSION_COOKIE, DEVICE = A.DEVICE_COOKIE, MONTH = 30 * 86400;

// Per-email limits count each visitor separately, with a much higher shared limit behind them: one shared count let
// anyone who knew an email use it up and keep the owner from logging in or resetting their password.
/** Too many code guesses for this email? Every code also has its own five tries; this stops a crowd of visitors (or one
 * with a lot of IPv6 addresses) adding up to many guesses across new codes. */
// counted per email AND visitor (with a high shared backstop), so a stranger burning guesses can't block the owner's own code
const codeGuesses = (ip: string, email: string) =>
  limited(`code:${ip}`, 30, 900_000) || limited(`codeverify:${email}:${ip}`, 10, 900_000) || limited(`codeverify:${email}`, 100, 900_000);

/** Handles <base>/api/me, /api/auth/*, /api/account/* (and /api/dev/mail on the development server). Returns false if not one of these. */
export async function accountRoutes(req: IncomingMessage, res: ServerResponse, rel: string): Promise<boolean> {
  if (!(rel === '/api/me' || rel.startsWith('/api/auth/') || rel.startsWith('/api/account/') || (DEV && rel === '/api/dev/mail'))) return false;
  const jar = cookies(req), ip = clientIp(req), ua = String(req.headers['user-agent'] ?? '');
  try {
    // development only: read the email a test account was sent (no real mailbox needed)
    if (rel === '/api/dev/mail') {
      if (req.method !== 'GET') throw new Problem('Not found.', 404);
      const to = A.normEmail(new URL(req.url ?? '', 'http://x').searchParams.get('to'));
      send(res, 200, devOutbox.get(to) ?? null);
      return true;
    }
    if (rel === '/api/me' && req.method === 'GET') { send(res, 200, { me: await A.sessionUser(jar[SESSION]) }); return true; }

    if (req.method !== 'POST') throw new Problem('Not found.', 404);
    if (!sameOrigin(req)) throw new Problem('Requests must come from this site.', 403);
    // without the code key or email, signing up and logging in stay off rather than half working
    if (!(AUTH_READY && MAIL_READY)) {
      if (rel.startsWith('/api/auth/') && rel !== '/api/auth/logout') throw new Problem('Signing up and logging in are switched off for a moment. Try again later.', 503);
      if (rel.startsWith('/api/account/email')) throw new Problem('Changing your email is switched off for a moment. Try again later.', 503);
    }
    const body = await readJson(req);
    const email = A.normEmail(body.email);
    /** Start a login session in this browser (and trust it for 30 days if asked). */
    const login = async (userId: string, trust: boolean) => {
      const token = await A.createSession(userId, ua);
      const set = [cookie(SESSION, token, MONTH)];
      if (trust) set.push(cookie(DEVICE, await A.trustDevice(userId, deviceLabel(req)), MONTH));
      send(res, 200, { ok: true, me: await A.sessionUser(token) }, set);
      return true;
    };

    switch (rel) {
      // ----- signed out -----
      case '/api/auth/signup': {
        const form = A.checkSignup(body.name, email, body.password);   // typing mistakes are cheap to refuse and don't count
        if (limited(`signup:${ip}`, 10, 3600_000) || limited(`signup:${email}`, 3, 600_000)) throw tooMany();
        await A.signupStart(form);
        send(res, 200, { ok: true });
        return true;
      }
      case '/api/auth/signup/verify':
        if (codeGuesses(ip, email)) throw tooMany();
        return await login(await A.signupVerify(email, body.code), true);
      case '/api/auth/login': {
        if (limited(`login:${ip}`, 30, 900_000)) throw tooMany();
        // a browser this account already trusts is almost certainly the owner's, so strangers' tries don't hold it up
        if (!(await A.trustedFor(email, jar[DEVICE])) && (limited(`login:${email}:${ip}`, 8, 900_000) || limited(`login:${email}`, 100, 900_000))) throw tooMany();
        const result = await A.loginStart(email, body.password, jar[DEVICE]);
        if ('needCode' in result) { send(res, 200, { ok: true, needCode: true }); return true; }
        return await login(result.userId, false);
      }
      case '/api/auth/login/verify':
        if (codeGuesses(ip, email)) throw tooMany();
        return await login(await A.loginVerify(email, body.code), body.trust === true);
      case '/api/auth/forgot':
        if (limited(`forgot:${ip}`, 10, 3600_000) || limited(`forgot:${email}:${ip}`, 3, 600_000) || limited(`forgot:${email}`, 30, 3600_000)) throw tooMany();
        await A.forgotStart(email);
        send(res, 200, { ok: true });
        return true;
      case '/api/auth/forgot/verify':
        if (codeGuesses(ip, email)) throw tooMany();
        return await login(await A.forgotVerify(email, body.code, body.password), false);
      case '/api/auth/logout':
        // the trusted-device cookie stays, so logging back in here doesn't need a code
        await A.endSession(jar[SESSION]);
        send(res, 200, { ok: true }, [cookie(SESSION, '', 0)]);
        return true;
    }
    if (rel.startsWith('/api/auth/')) throw new Problem('Not found.', 404);

    // ----- signed in -----
    const me = await A.sessionUser(jar[SESSION]);
    if (!me) throw new Problem('Please log in again.', 401);
    // the settings page loads the device list every visit, so it gets a looser limit than the account changes
    if (rel === '/api/account/devices' ? limited(`settings:${me.id}`, 300, 900_000) : limited(`account:${me.id}`, 30, 900_000)) throw tooMany();
    switch (rel) {
      case '/api/account/name': await A.setName(me.id, body.name); break;
      // both end every login and forget every trusted device, so this browser gets a fresh login (and stays trusted if it was)
      case '/api/account/password': {
        const trusted = await A.isTrusted(me.id, jar[DEVICE]);
        await A.changePassword(me.id, body.current, body.password, me.email);
        return await login(me.id, trusted);
      }
      case '/api/account/logout-everywhere': {
        const trusted = await A.isTrusted(me.id, jar[DEVICE]);
        await A.logoutEverywhere(me.id);
        return await login(me.id, trusted);
      }
      case '/api/account/email': await A.changeEmailStart(me.id, body.email, body.password, me.email); break;
      case '/api/account/email/verify':
        if (codeGuesses(ip, email)) throw tooMany();
        await A.changeEmailVerify(me.id, body.email, body.code, me.email); break;
      case '/api/account/devices': {
        const mine = jar[DEVICE] ? sha256(jar[DEVICE]).slice(0, 12) : '';
        send(res, 200, { devices: (await A.listDevices(me.id)).map(d => ({ ...d, current: d.id === mine })) });
        return true;
      }
      case '/api/account/devices/forget': await A.forgetDevice(me.id, body.id); break;
      case '/api/account/delete':
        await A.deleteAccount(me.id, body.password);
        send(res, 200, { ok: true, me: null }, [cookie(SESSION, '', 0), cookie(DEVICE, '', 0)]);
        return true;
      default: throw new Problem('Not found.', 404);
    }
    send(res, 200, { ok: true, me: await A.sessionUser(jar[SESSION]) });
    return true;
  } catch (e) {
    sendError(res, `account api ${rel}`, e);
    return true;
  }
}
