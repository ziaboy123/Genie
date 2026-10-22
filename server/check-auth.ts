// Checks for the account security fixes, against a real Genie server on the dev database: `npm run check:auth` (needs
// the genie_dev tunnel, with PGHOST/PGUSER/PGDATABASE set). Like check.ts it starts its own server on a spare port,
// makes throwaway example.com accounts on genie_dev and deletes them again at the end. Different visitors are played
// by setting CF-Connecting-IP, which the server believes on a connection from this machine (as nginx's would be).
// The daily email cap is checked last, on a second server started with a tiny cap.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const PORT = 3989;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/genie`;
if (process.env.PGDATABASE !== 'genie_dev') { console.error('Set PGHOST/PGUSER/PGDATABASE for genie_dev first (the preview script does).'); process.exit(1); }

let server: ChildProcess | null = null;
let serverLog = '';
function startServer(env: Record<string, string> = {}) {
  serverLog = '';
  const s = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: { ...process.env, GENIE_DEV: '1', GENIE_PORT: String(PORT), GENIE_HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  s.stdout!.on('data', d => { serverLog += d; });
  s.stderr!.on('data', d => { serverLog += d; });
  server = s;
}
async function serverReady() {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && /database: ready/.test(serverLog)) return; } catch {}
    if (i > 80) throw new Error(`server didn't get ready:\n${serverLog}`);
    await new Promise(r => setTimeout(r, 250));
  }
}
async function stopServer() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null) return;
  s.kill();
  await once(s, 'exit');
}
const stop = () => { try { server?.kill(); } catch {} };
process.on('exit', stop);
startServer();

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
  await serverReady();
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

  // ----- auth-5: password hashing a few at a time, so a flood of logins is turned away instead of queuing for ever -----
  {
    const member = await newAccount();
    // an email with no account still takes as long as a wrong password (the stand-in check goes through the same queue)
    const time = async (email: string) => {
      const t = performance.now();
      assert.equal((await new Browser().call('auth/login', { email, password: 'wrong-password-123' })).status, 401);
      return performance.now() - t;
    };
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const known: number[] = [], unknown: number[] = [];
    for (let i = 0; i < 5; i++) { known.push(await time(member.email)); unknown.push(await time(newEmail())); }
    const ratio = median(unknown) / median(known);
    assert.ok(ratio > 0.6 && ratio < 1.6, `an unknown email takes as long as a wrong password (${ratio.toFixed(2)}x)`);

    // 40 wrong logins at once, each from a different visitor and email (so no rate limit steps in): 2 are checked at a
    // time and 20 wait, the rest hear "busy" straight away, and the rest of the site keeps answering meanwhile
    const flood = Array.from({ length: 40 }, async () => {
      const t = performance.now();
      const r = await new Browser().call('auth/login', { email: newEmail(), password: 'wrong-password-123' });
      return { status: r.status, error: r.json?.error, ms: performance.now() - t };
    });
    const health: number[] = [];
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 100));
      const t = performance.now();
      assert.equal((await fetch(`${BASE}/api/health`)).status, 200);
      health.push(performance.now() - t);
    }
    const results = await Promise.all(flood);
    const busy = results.filter(r => r.status === 503);
    assert.deepEqual([...new Set(results.map(r => r.status))].sort(), [401, 503], 'only wrong-password and busy answers');
    assert.ok(busy.length >= 10 && busy.length <= 18, `at most 22 are checked or wait (${40 - busy.length} were)`);
    for (const r of busy) assert.equal(r.error, 'Genie is busy right now. Try again in a moment.');
    // "busy" comes without waiting for a turn: well before most of the checked ones (each takes its quarter second in turn)
    const slowestBusy = Math.max(...busy.map(r => r.ms)), middleChecked = median(results.filter(r => r.status === 401).map(r => r.ms));
    assert.ok(slowestBusy < middleChecked, `"busy" comes straight away (slowest ${slowestBusy.toFixed(0)} ms; checked ones ${middleChecked.toFixed(0)} ms)`);
    assert.ok(Math.max(...health) < 500, `the rest of the site keeps answering (slowest ${Math.max(...health).toFixed(0)} ms)`);
    // every place is given back afterwards: a full 22 at once are all checked
    const after = await Promise.all(Array.from({ length: 22 }, () => new Browser().call('auth/login', { email: newEmail(), password: 'wrong-password-123' })));
    assert.deepEqual([...new Set(after.map(r => r.status))], [401], 'the queue empties again');
    await member.ok('auth/logout', {});
    assert.equal((await member.ok('auth/login', { email: member.email, password: member.password })).me.email, member.email, 'logging in works after the flood');
    section(`auth-5 password hashing queue (${40 - busy.length} of 40 checked or queued, ${busy.length} told busy within ${slowestBusy.toFixed(0)} ms; unknown email ${ratio.toFixed(2)}x a wrong password)`);
  }

  // ----- auth-6: emails are checked before they're used in a rate limit's key -----
  {
    const NOT_EMAIL = 'Enter a valid email address.';
    const huge = `${'a'.repeat(15_000)}@example.com`;   // fits in the 16 KB a request may send
    // twelve from one visitor are all "not an email": nothing was counted (the eleventh reset used to hit the
    // 10-an-hour limit, because the 15 KB key had been recorded first)
    const pest = new Browser();
    for (let i = 0; i < 12; i++) assert.deepEqual(await pest.call('auth/forgot', { email: huge }).then(r => [r.status, r.json?.error]), [400, NOT_EMAIL]);
    await pest.ok('auth/forgot', { email: newEmail() });   // the visitor's own reset allowance is untouched
    // and from twelve visitors, the shared per-email limits never see it either
    for (let i = 0; i < 12; i++) assert.deepEqual(await new Browser().call('auth/login', { email: huge, password: 'wrong-password-123' }).then(r => [r.status, r.json?.error]), [400, NOT_EMAIL]);
    for (const path of ['auth/signup', 'auth/signup/verify', 'auth/login/verify', 'auth/forgot/verify'])
      assert.equal((await new Browser().call(path, { name: 'Check', email: huge, code: '123456', password: 'genie-check-123456' })).json?.error, NOT_EMAIL, path);
    const owner = await newAccount();
    assert.equal((await owner.call('account/email/verify', { email: huge, code: '123456' })).json?.error, NOT_EMAIL, 'account/email/verify');
    assert.equal((await owner.call('account/email', { email: huge, password: owner.password })).json?.error, NOT_EMAIL, 'account/email');

    // the backstop in ratelimit.ts itself (run here, in this process): a long key is kept as its hash, and a flood of
    // keys is held to 200,000, forgetting the least recently used (a key still being hit stays). It logs "over 200000
    // keys" as it does, which is expected here
    const { limited, limitStats } = await import('./src/ratelimit.ts');
    const long = 'k'.repeat(20_000);
    assert.equal(limited(long, 1, 60_000), false);
    assert.equal(limited(long, 1, 60_000), true, 'a long key still counts');
    assert.ok(limitStats().longest <= 200, 'no key over 200 characters is kept');
    for (let i = 0; i < 210_000; i++) {
      limited(`flood:${i}`, 5, 60_000);
      if (i % 1000 === 0) limited('busy', 1000, 60_000);
    }
    assert.ok(limitStats().keys <= 200_000 && limitStats().keys > 190_000, `keys held to 200,000 (${limitStats().keys})`);
    assert.equal(limited('busy', 200, 60_000), true, 'a key still being hit is remembered');
    assert.equal(limited('flood:0', 1, 60_000), false, 'the oldest quiet key was forgotten');
  }
  section('auth-6 rate-limit keys');

  // ----- names keep to the same rule as list and wish names (shared plainLine) -----
  {
    const owner = await newAccount();
    const rename = async (name: string) => (await owner.ok('account/name', { name })).me.name;
    assert.equal(await rename('Da\u061Cni\u2060ya\u00ADl \u200F'), 'Daniyal', 'invisible and direction marks go');
    assert.equal(await rename('Mum \u{1F468}\u200D\u{1F469}\u200D\u{1F467}'), 'Mum \u{1F468}\u200D\u{1F469}\u200D\u{1F467}', 'emoji joiners stay');
    const scotland = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
    assert.equal(await rename(`Ann ${scotland}`), `Ann ${scotland}`, "a flag's tag characters stay");
    assert.equal(await rename(`Z${'\u0301'.repeat(10)}`), `Z${'\u0301'.repeat(4)}`, 'at most four accents on one letter');
    // 40 characters, counted as characters: 40 emoji are 80 UTF-16 units, and fit
    assert.equal(await rename('\u{1F381}'.repeat(40)), '\u{1F381}'.repeat(40), '40 emoji are 40 characters');
    assert.deepEqual(await owner.call('account/name', { name: '\u{1F381}'.repeat(41) }).then(r => [r.status, r.json?.error]), [400, 'Keep your name to 40 characters.']);
  }
  section('names');

  // ----- auth-7: per-email limits on codes, and a daily cap on all email -----
  {
    // login codes: someone with the password, on new devices, gets ten an hour; the owner's trusted browser needs none
    const owner = await newAccount();
    const logins = [];
    for (let i = 0; i < 11; i++) logins.push((await new Browser().call('auth/login', { email: owner.email, password: owner.password })).status);
    assert.deepEqual(logins, [...Array(10).fill(200), 429], 'ten login codes an hour per email');
    await owner.ok('auth/logout', {});
    assert.equal((await owner.ok('auth/login', { email: owner.email, password: owner.password })).me.email, owner.email, 'a trusted browser still gets in');
    // email changes: three codes an hour to one new address (from any account), five an hour per account
    const a = await newAccount(), b = await newAccount();
    const target = newEmail();
    const change = (who: typeof a, email: string) => who.call('account/email', { email, password: who.password }).then(r => r.status);
    for (let i = 0; i < 3; i++) assert.equal(await change(a, target), 200);
    assert.equal(await change(b, target), 429, 'three codes an hour to one new address');
    for (let i = 0; i < 2; i++) assert.equal(await change(a, newEmail()), 200);
    assert.equal(await change(a, newEmail()), 429, 'five email-change codes an hour per account');
  }
  {
    // the daily cap, on a second server allowed 13 emails: 8 for one visitor's own allowance, then 5
    const MAIL_FULL = "Genie can't send any more emails today. Try again tomorrow.";
    const VISITOR_FULL = 'Genie has sent as many emails as it can for your internet connection today. Try again tomorrow.';
    const member = await newAccount(), other = await newAccount();
    const newAddress = newEmail();
    await stopServer();
    startServer({ GENIE_MAIL_DAILY_CAP: '13' });
    await serverReady();
    const password = `genie-check-${randomBytes(6).toString('hex')}`;

    // one visitor (an IPv6 /64, so every address in it counts as the same one) can cause 8 emails a day, whichever
    // way they're asked for: sign-ups, resets, new-device codes and email changes
    let host = 1;
    const visitor = () => new Browser(`2001:db8:4e1e:7::${host++}`);
    const asOther = () => Object.assign(other, { ip: `2001:db8:4e1e:7::${host++}` });   // logged in, from that /64
    const ask = [
      () => visitor().call('auth/signup', { name: 'Check', email: newEmail(), password }),
      () => visitor().call('auth/signup', { name: 'Check', email: other.email, password }),
      () => visitor().call('auth/forgot', { email: newEmail() }),
      () => visitor().call('auth/forgot', { email: other.email }),
      () => visitor().call('auth/login', { email: other.email, password: other.password }),   // a new device: a code
      () => asOther().call('account/email', { email: newEmail(), password: other.password }),
    ];
    const allowed = [];
    for (const go of [...ask, ask[2], ask[2]]) allowed.push((await go()).status);
    assert.deepEqual(allowed, Array(8).fill(200), "a visitor's 8 emails, asked for every way");
    // the ninth, every way: refused with the same plain answer whether or not the email has an account
    for (const go of ask) assert.deepEqual(await go().then(r => [r.status, r.json?.error]), [429, VISITOR_FULL], 'over the visitor allowance');
    // the 6 turned away took nothing from everyone's 13: the 5 the visitor's 8 leave are all still there (below)

    // 1: the member starts changing their email
    await member.ok('account/email', { email: newAddress, password: member.password });
    const changeCode = codeFrom(await devMail(newAddress));
    assert.ok(changeCode, 'the email change sent a code');
    // 2 and 3: a reset for an email with no account takes one just as the member's does, so a full day can't tell them apart
    await new Browser().ok('auth/forgot', { email: newEmail() });
    let before = Date.now();
    await new Browser().ok('auth/forgot', { email: member.email });
    assert.ok(await devMail(member.email, before), 'the member got a reset code');
    // 4 and 5: sign-ups, new and existing
    await new Browser().ok('auth/signup', { name: 'Check', email: newEmail(), password });
    await new Browser().ok('auth/signup', { name: 'Check', email: member.email, password });
    // that's the day's five: everything that would send one is refused, the same way, with a plain message
    const refused = await Promise.all([
      new Browser().call('auth/signup', { name: 'Check', email: newEmail(), password }),
      new Browser().call('auth/signup', { name: 'Check', email: member.email, password }),
      new Browser().call('auth/forgot', { email: newEmail() }),
      new Browser().call('auth/forgot', { email: member.email }),
      new Browser().call('auth/login', { email: member.email, password: member.password }),   // a new device needs a code
      member.call('account/email', { email: newEmail(), password: member.password }),
      visitor().call('auth/forgot', { email: newEmail() }),   // a full day is said first, so it doesn't use up visitors' own
    ]);
    for (const r of refused) assert.deepEqual([r.status, r.json?.error], [503, MAIL_FULL]);
    // a trusted browser needs no email, so it still logs in
    await member.ok('auth/logout', {});
    assert.equal((await member.ok('auth/login', { email: member.email, password: member.password })).me.email, member.email, 'a trusted browser on a full day');
    // the notice that an account's email was changed still goes, even on a full day
    before = Date.now();
    await member.ok('account/email/verify', { email: newAddress, code: changeCode });
    assert.match((await devMail(member.email, before))?.subject ?? '', /email address was changed/, 'the change notice goes on a full day');
    // and the full day is logged once, however many are turned away
    assert.equal(serverLog.split("of the day's emails are used").length - 1, 1, 'logged once');
  }
  section('auth-7 email limits');

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
