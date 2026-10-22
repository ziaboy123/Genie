// Checks for the account security fixes, against a real Genie server on the dev database: `npm run check:auth` (needs
// the genie_dev tunnel, with PGHOST/PGUSER/PGDATABASE set). Like check.ts it starts its own server on a spare port,
// makes throwaway example.com accounts on genie_dev and deletes them again at the end. Different visitors are played
// by setting CF-Connecting-IP, which the server believes on a connection from this machine (as nginx's would be).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const PORT = 3989;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/genie`;
if (process.env.PGDATABASE !== 'genie_dev') { console.error('Set PGHOST/PGUSER/PGDATABASE for genie_dev first (the preview script does).'); process.exit(1); }

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: { ...process.env, GENIE_DEV: '1', GENIE_PORT: String(PORT), GENIE_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

// a fresh made-up visitor address each time (TEST-NET-2, never a real visitor)
let nextIp = 1;
const newIp = () => `198.51.${100 + (nextIp >> 8)}.${nextIp++ & 255}`;

/** A browser: keeps its own cookies, and comes from its own address. */
class Browser {
  jar = new Map<string, string>();
  constructor(public ip = newIp()) {}
  async call(path: string, body?: unknown) {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.ip };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) { headers['content-type'] = 'application/json'; headers.origin = ORIGIN; }
    const res = await fetch(`${BASE}/api/${path}`, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (attrs.some(a => /max-age=0/i.test(a.trim()))) this.jar.delete(name); else this.jar.set(name, value);
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  }
  async ok(path: string, body?: unknown) {
    const r = await this.call(path, body);
    assert.equal(r.status, 200, `${path} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }
}
/** The last email the dev server "sent" to an address, newer than `after` (some are sent in the background). */
async function devMail(to: string, after = 0) {
  for (let i = 0; i < 40; i++) {
    const mail = (await new Browser().call(`dev/mail?to=${encodeURIComponent(to)}`)).json;
    if (mail && mail.at > after) return mail;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}
const codeFrom = (mail: any) => String(mail?.text ?? '').match(/\b(\d{6})\b/)?.[1];
const section = (name: string) => console.log(`${name} OK`);
const emails: string[] = [];
const newEmail = () => { const e = `check-${randomBytes(5).toString('hex')}@example.com`; emails.push(e); return e; };
const db = () => import('./src/db/index.ts');
/** A wrong code that's certainly not the right one. */
const wrong = (code: string, i: number) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0');
const BAD_CODE = "That code isn't right or has expired. Ask for a new one.";

async function newAccount() {
  const b = new Browser();
  const email = newEmail(), password = `genie-check-${randomBytes(6).toString('hex')}`;
  await b.ok('auth/signup', { name: 'Check', email, password });
  const code = codeFrom(await devMail(email));
  assert.ok(code, 'sign-up email has a code');
  await b.ok('auth/signup/verify', { email, code });   // signing up trusts this browser
  assert.ok(b.jar.has('genie_device'), 'sign-up trusts the browser');
  return Object.assign(b, { email, password });
}

async function main() {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && /database: ready/.test(serverLog)) break; } catch {}
    if (i > 80) throw new Error(`server didn't get ready:\n${serverLog}`);
    await new Promise(r => setTimeout(r, 250));
  }
  const { one } = await db();

  // ----- auth-1: five tries per code, even when the guesses all arrive at once -----
  for (const flow of ['reset', 'login'] as const) {
    const owner = await newAccount();
    const before = Date.now();
    if (flow === 'reset') await new Browser().ok('auth/forgot', { email: owner.email });
    else assert.equal((await new Browser().ok('auth/login', { email: owner.email, password: owner.password })).needCode, true);
    const code = codeFrom(await devMail(owner.email, before));
    assert.ok(code, `${flow} email has a code`);
    const verify = flow === 'reset' ? 'auth/forgot/verify' : 'auth/login/verify';
    const extra = flow === 'reset' ? { password: `new-check-${randomBytes(6).toString('hex')}` } : {};
    // eight wrong guesses at the same moment, each from a different visitor (so the per-visitor limits don't step in);
    // with the sign-up code and the right one below, that's the ten guesses an email gets in 15 minutes
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => new Browser().call(verify, { email: owner.email, code: wrong(code, i), ...extra })));
    for (const r of results) assert.deepEqual([r.status, r.json?.error], [400, BAD_CODE]);
    // every guess has to win a try before it's compared, and there are only five: the count stops at 5 (it used to be
    // compared first and counted after, so all eight were checked against the code)
    const row = await one('select attempts from genie.codes where email = $1 and purpose = $2', [owner.email, flow]);
    assert.equal(row?.attempts, 5, `${flow}: exactly five guesses were let through to be compared`);
    // so the right code no longer works either
    const right = await new Browser().call(verify, { email: owner.email, code, ...extra });
    assert.deepEqual([right.status, right.json?.error], [400, BAD_CODE], `${flow}: the code is used up after five guesses`);
    // one visitor gets ten guesses per email in 15 minutes; a stranger using theirs up doesn't block anyone else (so they
    // can't lock the owner out of their own code), and a high shared limit still caps a crowd of visitors
    const spammer = new Browser('203.0.113.77');
    const tries = [];
    for (let i = 0; i < 11; i++) tries.push((await spammer.call(verify, { email: owner.email, code: wrong(code, i), ...extra })).status);
    assert.deepEqual(tries, [...Array(10).fill(400), 429], `${flow}: one visitor gets ten guesses per email`);
    assert.equal((await new Browser().call(verify, { email: owner.email, code, ...extra })).status, 400, `${flow}: someone else isn't blocked by them`);
  }
  // the right code still works, once (two at once: only one gets in)
  {
    const owner = await newAccount();
    const before = Date.now();
    await new Browser().ok('auth/login', { email: owner.email, password: owner.password });
    const code = codeFrom(await devMail(owner.email, before))!;
    const both = await Promise.all([new Browser(), new Browser()].map(b => b.call('auth/login/verify', { email: owner.email, code })));
    assert.deepEqual(both.map(r => r.status).sort(), [200, 400], 'one of two right codes at once logs in');
  }
  section('auth-1 code guesses');

  // ----- auth-2: no finding out who has an account from the verify step -----
  {
    const member = await newAccount();
    const stranger = newEmail();   // never signed up
    // forgot: only the member gets a code; wait for it to be stored so the comparison is fair
    let before = Date.now();
    for (const email of [member.email, stranger]) await new Browser().ok('auth/forgot', { email });
    assert.ok(await devMail(member.email, before), 'the member got a reset code');
    const password = `new-check-${randomBytes(6).toString('hex')}`;
    const forgot = await Promise.all([member.email, stranger].map(email => new Browser().call('auth/forgot/verify', { email, code: '000000', password })));
    assert.deepEqual(forgot.map(r => [r.status, r.json?.error]), [[400, BAD_CODE], [400, BAD_CODE]], 'forgot/verify answers the same for both');
    // sign-up: only the stranger gets a code (the member gets a "someone tried to sign up" email instead)
    before = Date.now();
    for (const email of [member.email, stranger]) await new Browser().ok('auth/signup', { name: 'Check', email, password });
    assert.ok(await devMail(stranger, before), 'the stranger got a sign-up code');
    assert.ok(await devMail(member.email, before), 'the member got the warning email');
    const signup = await Promise.all([member.email, stranger].map(email => new Browser().call('auth/signup/verify', { email, code: '000000' })));
    assert.deepEqual(signup.map(r => [r.status, r.json?.error]), [[400, BAD_CODE], [400, BAD_CODE]], 'signup/verify answers the same for both');
    // an expired code gets the same answer too
    const code = codeFrom(await devMail(stranger, before))!;
    await one("update genie.codes set expires_at = now() - interval '1 second' where email = $1 and purpose = 'signup'", [stranger]);
    const expired = await new Browser().call('auth/signup/verify', { email: stranger, code });
    assert.deepEqual([expired.status, expired.json?.error], [400, BAD_CODE], 'an expired code answers the same');
  }
  section('auth-2 same answers');

  // ----- auth-3: strangers' failed tries don't lock the owner out -----
  {
    const owner = await newAccount();
    // ten strangers each get the password wrong once (eight in total used to lock the email for 15 minutes)
    for (let i = 0; i < 10; i++) assert.equal((await new Browser().call('auth/login', { email: owner.email, password: 'wrong-password-123' })).status, 401);
    // the owner on a new device still gets in (with a code)...
    assert.equal((await new Browser().ok('auth/login', { email: owner.email, password: owner.password })).needCode, true, 'owner on a new device');
    // ...and on their trusted one, straight in
    await owner.ok('auth/logout', {});
    assert.equal((await owner.ok('auth/login', { email: owner.email, password: owner.password })).me.email, owner.email, 'owner on their trusted device');
    // one stranger trying over and over is still stopped after eight
    const pest = new Browser();
    const statuses = [];
    for (let i = 0; i < 9; i++) statuses.push((await pest.call('auth/login', { email: owner.email, password: 'wrong-password-123' })).status);
    assert.deepEqual(statuses, [...Array(8).fill(401), 429], 'one visitor gets eight tries per email');

    // forgot: four strangers ask for reset codes, and the owner can still ask for one
    for (let i = 0; i < 4; i++) await new Browser().ok('auth/forgot', { email: owner.email });
    await new Browser().ok('auth/forgot', { email: owner.email });
    const resetPest = new Browser();
    const resets = [];
    for (let i = 0; i < 4; i++) resets.push((await resetPest.call('auth/forgot', { email: owner.email })).status);
    assert.deepEqual(resets, [200, 200, 200, 429], 'one visitor gets three reset emails per 10 minutes');
  }
  {
    // the shared backstop: a crowd of strangers (13 visitors × 8 tries) uses up the 100 per 15 minutes for one email...
    const owner = await newAccount();
    const crowd = Array.from({ length: 13 }, () => new Browser());
    const results = await Promise.all(crowd.map(async b => {
      const out = [];
      for (let i = 0; i < 8; i++) out.push((await b.call('auth/login', { email: owner.email, password: 'wrong-password-123' })).status);
      return out;
    }));
    assert.equal(results.flat().filter(s => s === 401).length, 100, 'the shared limit lets 100 wrong tries through');
    assert.equal((await new Browser().call('auth/login', { email: owner.email, password: owner.password })).status, 429, 'a new device waits once 100 are used up');
    // ...but the owner's trusted browser is let past it
    await owner.ok('auth/logout', {});
    assert.equal((await owner.ok('auth/login', { email: owner.email, password: owner.password })).me.email, owner.email, 'trusted device skips the per-email limit');
  }
  section('auth-3 no lockout');

  console.log('All auth checks passed.');
}

main()
  .catch(e => { console.error(e); console.error(`\n--- server log ---\n${serverLog.slice(-4000)}`); process.exitCode = 1; })
  .finally(async () => {
    const { q, pool } = await db();
    // the throwaway accounts (and any codes left for them) go
    await q('delete from genie.users where email = any($1)', [emails]).catch(e => console.error(`clean-up: ${e.message}`));
    await q('delete from genie.codes where email = any($1)', [emails]).catch(() => {});
    stop();
    await pool.end().catch(() => {});
  });
