// End-to-end checks against a real Genie server on the dev database: `npm run check` (needs the genie_dev tunnel,
// e.g. run it while the preview is up, or with PGHOST/PGUSER/PGDATABASE set). It starts its own server on a spare
// port, makes throwaway accounts on genie_dev, and deletes them again at the end.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const PORT = 3994;
const ORIGIN = `http://localhost:${PORT}`;
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

/** A browser: keeps its own cookies. */
class Browser {
  jar = new Map<string, string>();
  async call(path: string, body?: unknown, opts: { origin?: string | null; type?: string; raw?: string } = {}) {
    const headers: Record<string, string> = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const post = body !== undefined || opts.raw !== undefined;
    if (post) {
      headers['content-type'] = opts.type ?? 'application/json';
      if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    }
    const res = await fetch(`${BASE}/api/${path}`, { method: post ? 'POST' : 'GET', headers, body: post ? (opts.raw ?? JSON.stringify(body)) : undefined, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (attrs.some(a => /max-age=0/i.test(a.trim()))) this.jar.delete(name); else this.jar.set(name, value);
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, headers: res.headers };
  }
  async ok(path: string, body?: unknown) {
    const r = await this.call(path, body);
    assert.equal(r.status, 200, `${path} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }
}
/** The last email the dev server "sent" to an address, newer than `after` (some are sent in the background, so wait a little). */
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
const created: Browser[] = [];

async function newAccount(name: string) {
  const b = new Browser();
  const email = `check-${randomBytes(5).toString('hex')}@example.com`;
  const password = `genie-check-${randomBytes(6).toString('hex')}`;
  await b.ok('auth/signup', { name, email, password });
  const code = codeFrom(await devMail(email));
  assert.ok(code, 'sign-up email has a code');
  const r = await b.ok('auth/signup/verify', { email, code });
  assert.equal(r.me.email, email);
  assert.equal(r.me.name, name);
  created.push(Object.assign(b, { email, password }));
  return Object.assign(b, { email, password });
}
const isoDay = (offset: number) => {
  // London's calendar day, the same one the server uses for the reveal
  const d = new Date(Date.now() + offset * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

async function main() {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok && /database: ready/.test(serverLog)) break; } catch {}
    if (i > 80) throw new Error(`server didn't get ready:\n${serverLog}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ----- the basics -----
  let r = await fetch(`${ORIGIN}/genie`, { redirect: 'manual' });
  assert.equal(r.status, 301); assert.equal(r.headers.get('location'), '/genie/');
  r = await fetch(`${ORIGIN}/elsewhere${'x'.repeat(5000)}`, { redirect: 'manual' });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/genie/');
  r = await fetch(`${BASE}/api/health`);
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  r = await fetch(`${BASE}/api/me`, { headers: { cookie: 'genie_session=%E0%A4%A' } });   // a malformed cookie is just a wrong one
  assert.equal(r.status, 200);
  section('Basics');

  // ----- requests from other sites, non-JSON -----
  const anon = new Browser();
  assert.equal((await anon.call('auth/login', { email: 'a@b.c', password: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await anon.call('auth/login', { email: 'a@b.c', password: 'x' }, { origin: null })).status, 403);
  assert.equal((await anon.call('auth/login', undefined, { raw: 'email=a', type: 'text/plain' })).status, 415);
  assert.equal((await anon.call('lists/mine', {})).status, 401);
  section('Same-site and JSON only');

  // ----- accounts -----
  const owner = await newAccount('Daniyal');
  assert.equal((await owner.ok('me')).me.name, 'Daniyal');
  const fresh = new Browser();   // another browser: no trusted-device cookie, so it needs a code
  assert.ok((await fresh.call('auth/login', { email: owner.email, password: 'wrong-password-1' })).status >= 400);
  const beforeLogin = Date.now();
  const login = await fresh.ok('auth/login', { email: owner.email, password: owner.password });
  assert.equal(login.needCode, true);
  const loginCode = codeFrom(await devMail(owner.email, beforeLogin - 1));
  assert.ok(loginCode);
  assert.equal((await fresh.ok('auth/login/verify', { email: owner.email, code: loginCode, trust: false })).me.email, owner.email);
  assert.equal((await fresh.call('auth/login/verify', { email: owner.email, code: loginCode, trust: false })).status >= 400, true, 'a code works once');
  await fresh.ok('auth/logout', {});
  assert.equal((await fresh.ok('me')).me, null);
  section('Accounts');

  // ----- lists and wishes -----
  assert.equal((await owner.call('lists/create', { title: 'Birthday', eventDate: '2020-01-01' })).status, 400);
  assert.equal((await owner.call('lists/create', { title: '', eventDate: isoDay(10) })).status, 400);
  const list = (await owner.ok('lists/create', { title: "Daniyal's birthday", eventDate: isoDay(12) })).list;
  assert.match(list.shareCode, /^[A-Za-z0-9]{8}$/);
  assert.equal(list.revealed, false);
  assert.equal(list.grantedCount, null);
  assert.equal((await owner.ok('lists/mine', {})).lists.length, 1);
  assert.equal((await owner.ok('lists/update', { id: list.id, title: 'Birthday 2026' })).list.title, 'Birthday 2026');
  const stranger = await newAccount('Stranger');
  assert.equal((await stranger.call('lists/get', { id: list.id })).status, 404, "someone else's list is a 404");
  assert.ok((await owner.call('items/add', { listId: list.id, url: 'http://127.0.0.1:3018/genie/api/health' })).status >= 400, 'local addresses are refused');
  assert.ok((await owner.call('items/add', { listId: list.id, url: 'http://10.68.5.135/' })).status >= 400, 'the homelab is refused');
  assert.ok((await owner.call('items/add', { listId: list.id, url: 'javascript:alert(1)' })).status >= 400);
  let online = true;
  let item: any;
  try {
    item = (await owner.ok('items/add', { listId: list.id, url: 'https://example.com/?utm_source=check' })).item;
    assert.equal(item.title, 'Example Domain');
    assert.equal(item.url, 'https://example.com/');
  } catch (e: any) {
    if (!/fetch|ENOTFOUND|EAI_AGAIN|timed out/i.test(String(e?.message))) throw e;
    online = false;
  }
  if (!online) console.log('(offline: skipped the real link fetch)');
  // a wish whose page couldn't be read still gets added, named from its link
  const second = (await owner.ok('items/add', { listId: list.id, url: 'https://no-such-shop-genie-check.co.uk/products/heavyweight-hoodie-black' })).item;
  assert.match(second.title, /hoodie/i);
  assert.equal((await owner.call('items/add', { listId: list.id, url: 'https://no-such-shop-genie-check.co.uk/products/heavyweight-hoodie-black' })).status, 409);
  const priced = (await owner.ok('items/update', { id: second.id, title: 'Heavyweight hoodie (black, M)', price: 3990 })).item;
  assert.equal(priced.price, 3990);
  assert.equal((await stranger.call('items/update', { id: second.id, title: 'mine now' })).status, 404);
  const ids = (await owner.ok('lists/get', { id: list.id })).list.items.map((i: any) => i.id);
  const reordered = (await owner.ok('items/reorder', { listId: list.id, ids: [...ids].reverse() })).list.items.map((i: any) => i.id);
  assert.deepEqual(reordered, [...ids].reverse());
  section('Lists and wishes');

  // ----- the share page and grants -----
  const visitor = new Browser(), other = new Browser();
  const code = list.shareCode;
  let view = (await visitor.ok('w/view', { code, tokens: [] })).list;
  assert.equal(view.isOwner, false);
  assert.equal(view.ownerName, 'Daniyal');
  assert.ok(view.items.every((i: any) => i.state === 'open'));
  const { token } = await visitor.ok('w/grant', { code, itemId: second.id });
  assert.ok(token && token.length >= 40);
  assert.equal((await other.call('w/grant', { code, itemId: second.id })).status, 409, 'one grant per wish');
  view = (await visitor.ok('w/view', { code, tokens: [token] })).list;
  assert.equal(view.items.find((i: any) => i.id === second.id).state, 'mine');
  view = (await other.ok('w/view', { code, tokens: [] })).list;
  assert.equal(view.items.find((i: any) => i.id === second.id).state, 'granted');
  assert.equal(view.items.at(-1).id, second.id, 'granted wishes sink to the bottom');
  view = (await owner.ok('w/view', { code, tokens: [] })).list;
  assert.equal(view.isOwner, true);
  assert.ok(view.items.every((i: any) => i.state === 'hidden'), 'the owner never sees grants before the day');
  assert.equal((await owner.call('w/grant', { code, itemId: ids[0] })).status, 403);
  const ownerView = (await owner.ok('lists/get', { id: list.id })).list;
  assert.ok(ownerView.items.every((i: any) => i.granted === null));
  assert.equal(ownerView.grantedCount, null);
  assert.equal((await other.call('w/ungrant', { code, itemId: second.id, token: 'not-the-token' })).status, 404);
  await visitor.ok('w/ungrant', { code, itemId: second.id, token });
  view = (await other.ok('w/view', { code, tokens: [] })).list;
  assert.equal(view.items.find((i: any) => i.id === second.id).state, 'open');
  assert.equal((await anon.call('w/view', { code: 'nope', tokens: [] })).status, 404);
  assert.equal((await anon.call('w/view', { code: 'AAAAAAAA', tokens: [] })).status, 404);
  section('Share page and grants');

  // ----- a new link kills the old one -----
  const relinked = (await owner.ok('lists/new-link', { id: list.id })).list;
  assert.notEqual(relinked.shareCode, code);
  assert.equal((await anon.call('w/view', { code, tokens: [] })).status, 404);
  section('New link');

  // ----- the reveal (a list whose day was yesterday) -----
  const past = (await owner.ok('lists/create', { title: 'Yesterday', eventDate: isoDay(-1) })).list;
  assert.equal(past.revealed, true);
  const w = (await owner.ok('items/add', { listId: past.id, url: 'https://no-such-shop-genie-check.co.uk/products/ember-mug-2' })).item;
  assert.equal((await visitor.call('w/grant', { code: past.shareCode, itemId: w.id })).status, 403, 'no grants after the day');
  const reuse = (await owner.ok('lists/reuse', { id: past.id, eventDate: isoDay(30) })).list;
  assert.equal(reuse.revealed, false);
  section('Reveal');

  // ----- link previews: the share page says whose list it is, safely -----
  const page = await fetch(`${BASE}/w/${relinked.shareCode}`);
  if (page.status === 200 && /<html/i.test(await page.clone().text())) {
    const html = await page.text();
    assert.match(html, /og:title/);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    section('Link previews');
  } else console.log('(client not built: skipped link previews)');

  // ----- accounts unused for two years: one warning at 23 months, deletion at 24 (and a month after the warning) -----
  // run here, in this process, against genie_dev: its emails land in this process's dev outbox
  const { one: row, q: sql } = await import('./src/db/index.ts');
  const { inactiveSweep } = await import('./src/auth/inactive.ts');
  const { devOutbox } = await import('./src/auth/mailer.ts');
  const idle = await newAccount('Idle');
  const warnedAt = async () => (await row('select warned_at from genie.users where email = $1', [idle.email]))?.warned_at ?? null;
  await sql("update genie.users set last_seen_at = now() - interval '23 months 1 day' where email = $1", [idle.email]);
  devOutbox.delete(idle.email);
  await inactiveSweep();
  assert.match(devOutbox.get(idle.email)?.subject ?? '', /will be deleted/, 'a warning email at 23 months');
  assert.ok(await warnedAt(), 'the warning is recorded');
  devOutbox.delete(idle.email);
  await inactiveSweep();
  assert.equal(devOutbox.get(idle.email), undefined, 'warned only once');
  // logging in again clears the warning (the sign-up browser is trusted, so no code)
  await idle.ok('auth/login', { email: idle.email, password: idle.password });
  assert.equal(await warnedAt(), null, 'logging in clears the warning');
  // 25 months unused but warned only 10 days ago: not yet
  await sql("update genie.users set last_seen_at = now() - interval '25 months', warned_at = now() - interval '10 days' where email = $1", [idle.email]);
  await inactiveSweep();
  assert.ok(await row('select 1 from genie.users where email = $1', [idle.email]), 'a month to act on the warning');
  // 25 months unused and never warned: warned now, not deleted
  await sql("update genie.users set warned_at = null where email = $1", [idle.email]);
  await inactiveSweep();
  assert.ok(await warnedAt(), 'never deleted without a warning first');
  // warned 31 days ago, but one of its lists' days is coming up: kept (until 30 days after that day)
  const idleList = (await idle.ok('lists/create', { title: 'Old list', eventDate: isoDay(5) })).list;
  await sql("update genie.users set last_seen_at = now() - interval '25 months', warned_at = now() - interval '31 days' where email = $1", [idle.email]);
  await inactiveSweep();
  assert.ok(await row('select 1 from genie.users where email = $1', [idle.email]), "not deleted while a list's day is coming up");
  // and not warned while it's coming up either
  await sql("update genie.users set warned_at = null where email = $1", [idle.email]);
  devOutbox.delete(idle.email);
  await inactiveSweep();
  assert.equal(devOutbox.get(idle.email), undefined, "no warning while a list's day is coming up");
  assert.equal(await warnedAt(), null);
  // the list's day was 31 days ago and the warning went out 31 days ago: gone, lists and all
  await sql('update genie.lists set event_date = current_date - 31 where id = $1', [idleList.id]);
  await sql("update genie.users set warned_at = now() - interval '31 days' where email = $1", [idle.email]);
  await inactiveSweep();
  assert.equal(await row('select 1 from genie.users where email = $1', [idle.email]), undefined, 'deleted after the warning');
  assert.equal((await anon.call('w/view', { code: idleList.shareCode, tokens: [] })).status, 404);
  created.splice(created.indexOf(idle), 1);
  section('Inactive accounts');

  // ----- deleting an account takes its lists with it -----
  await owner.ok('account/delete', { password: owner.password });
  assert.equal((await anon.call('w/view', { code: relinked.shareCode, tokens: [] })).status, 404);
  created.splice(created.indexOf(owner), 1);
  section('Account deletion');

  console.log('All checks passed.');
}

main()
  .catch(e => { console.error(e); console.error(`\n--- server log ---\n${serverLog.slice(-4000)}`); process.exitCode = 1; })
  .finally(async () => {
    for (const b of created as any[]) await b.call('account/delete', { password: b.password }).catch(() => {});
    stop();
    await (await import('./src/db/index.ts')).pool.end().catch(() => {});   // only connected if the inactive-account checks ran
  });
