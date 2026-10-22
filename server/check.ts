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

/** A browser: keeps its own cookies. `ip` makes it look like a visitor at that address (the server trusts
 *  CF-Connecting-IP from loopback, as it does from Cloudflare's tunnel). */
class Browser {
  jar = new Map<string, string>();
  ip?: string;
  constructor(ip?: string) { this.ip = ip; }
  async call(path: string, body?: unknown, opts: { origin?: string | null; type?: string; raw?: string } = {}) {
    const headers: Record<string, string> = {};
    if (this.ip) headers['cf-connecting-ip'] = this.ip;
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
  assert.ok((await owner.call('items/add', { listId: list.id, url: 'http://10.20.30.40/' })).status >= 400, 'the homelab is refused');
  assert.ok((await owner.call('items/add', { listId: list.id, url: 'javascript:alert(1)' })).status >= 400);
  let online = true;
  let item: any;
  try {
    item = (await owner.ok('items/add', { listId: list.id, url: 'https://example.com/?utm_source=check' })).item;
    // the fetcher never throws for a site problem: a failed fetch comes back with the name guessed from the link
    if (item.title !== 'Example Domain' && /example\.com/i.test(item.title)) throw new Error('fetch failed (network)');
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

  // ----- names keep to one plain line: the same rule as titles read from shops' pages (check-unfurl.ts has the rest) -----
  const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', FAMILY = '👩\u200D👩\u200D👧';
  for (const [typed, kept] of [
    ['Nike\u2060\u061C\u2061 Air\u00AD \u{E0041}Max\u3164', 'Nike Air Max'],   // invisible and direction marks the old list missed
    [`${FAMILY} ${ENGLAND} mug`, `${FAMILY} ${ENGLAND} mug`],                   // emoji and flags stay whole
    [`W${'\u0333'.repeat(119)}`, `W${'\u0333'.repeat(4)}`],                       // a pile of accents is cut to 4
  ] as const) assert.equal((await owner.ok('items/update', { id: second.id, title: typed })).item.title, kept, JSON.stringify(typed));
  assert.equal((await owner.call('items/update', { id: second.id, title: '\u200B\u2060\u061C' })).status, 400, 'nothing visible is no name');
  assert.equal((await owner.ok('lists/update', { id: list.id, title: '\u202EBirthday\u202C 2026\u061C' })).list.title, 'Birthday 2026');
  await owner.ok('items/update', { id: second.id, title: 'Heavyweight hoodie (black, M)' });
  section('Plain names');

  // ----- the share page and grants -----
  const visitor = new Browser(), other = new Browser();
  const code = list.shareCode;
  let view = (await visitor.ok('w/view', { code, tokens: [] })).list;
  const listKey = view.key;
  assert.match(listKey, /^[A-Za-z0-9_-]{22}$/, 'a list key for filing undo tokens');
  assert.ok(!listKey.includes(list.id) && listKey !== code, "it isn't the list's id or its code");
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

  // ----- a new link kills the old one; grants stay unless the owner clears them too -----
  const { token: kept } = await visitor.ok('w/grant', { code, itemId: second.id });
  const relinked = (await owner.ok('lists/new-link', { id: list.id })).list;
  assert.notEqual(relinked.shareCode, code);
  assert.equal((await anon.call('w/view', { code, tokens: [] })).status, 404);
  // the list key stays, so a granter's browser still finds its token, and the token still counts as theirs
  const afterLink = (await visitor.ok('w/view', { code: relinked.shareCode, tokens: [kept] })).list;
  assert.equal(afterLink.key, listKey, 'the list key survives a new link');
  assert.equal(afterLink.items.find((i: any) => i.id === second.id).state, 'mine', 'and so does Yours / Undo');
  const stateOn = async (c: string) => (await other.ok('w/view', { code: c, tokens: [] })).list.items.find((i: any) => i.id === second.id).state;
  assert.equal(await stateOn(relinked.shareCode), 'granted', 'a plain new link keeps grants');
  assert.equal((await stranger.call('lists/new-link', { id: list.id, clearGrants: true })).status, 404, "nobody else can relink or clear a list");
  assert.equal(await stateOn(relinked.shareCode), 'granted', "a stranger's try clears nothing");
  const cleared = (await owner.ok('lists/new-link', { id: list.id, clearGrants: true })).list;
  assert.notEqual(cleared.shareCode, relinked.shareCode);
  assert.equal(cleared.grantedCount, null, 'clearing still says nothing about grants before the day');
  assert.ok((await other.ok('w/view', { code: cleared.shareCode, tokens: [] })).list.items.every((i: any) => i.state === 'open'), 'every wish is open again');
  assert.equal((await visitor.call('w/ungrant', { code: cleared.shareCode, itemId: second.id, token: kept })).status, 404, 'a cleared grant has nothing to undo');
  section('New link');

  // ----- one visitor can grant only so many wishes on one list a day (a leaked link can't mark the whole list) -----
  const capList = (await owner.ok('lists/create', { title: 'Lots of wishes', eventDate: isoDay(20) })).list;
  assert.notEqual((await anon.ok('w/view', { code: capList.shareCode, tokens: [] })).list.key, listKey, 'each list has its own key');
  const capIds: string[] = [];
  for (let i = 0; i < 12; i++)
    capIds.push((await owner.ok('items/add', { listId: capList.id, url: `https://no-such-shop-genie-check.co.uk/products/cap-wish-${i}` })).item.id);
  const greedy = new Browser('203.0.113.7'), next = new Browser('203.0.113.8'), late = new Browser('2001:db8:1:2::9');
  const greedyTokens: string[] = [];
  for (const id of capIds.slice(0, 10)) greedyTokens.push((await greedy.ok('w/grant', { code: capList.shareCode, itemId: id })).token);
  const capped = await greedy.call('w/grant', { code: capList.shareCode, itemId: capIds[10] });
  assert.equal(capped.status, 429, 'the 11th grant on one list in a day is refused');
  assert.match(capped.json.error, /Try again tomorrow/);
  // undoing has its own count, and doesn't hand a grant back
  await greedy.ok('w/ungrant', { code: capList.shareCode, itemId: capIds[0], token: greedyTokens[0] });
  assert.equal((await greedy.call('w/grant', { code: capList.shareCode, itemId: capIds[0] })).status, 429, 'undo then grant again is still capped');
  // the cap is per list: the same visitor can still grant on another list
  await greedy.ok('w/grant', { code: cleared.shareCode, itemId: second.id });
  // and per visitor: someone else can grant here
  await next.ok('w/grant', { code: capList.shareCode, itemId: capIds[10] });
  // a grant someone else got to first doesn't count
  for (let i = 0; i < 10; i++) assert.equal((await late.call('w/grant', { code: capList.shareCode, itemId: capIds[1] })).status, 409);
  await late.ok('w/grant', { code: capList.shareCode, itemId: capIds[11] });
  section('Grant cap');

  // ----- the browser's undo tokens: client/src/lib/grants.ts, run here against a stand-in for localStorage -----
  {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    };
    const grantsFile = '../client/src/lib/grants.ts';   // not a literal, so the server's typecheck leaves the browser code alone
    const G = await import(grantsFile);
    const entry = (key: string) => JSON.parse(store.get(`genie:undo:${key}`) ?? 'null');

    // a list moved to a later day keeps its Undo: the share page doesn't clear the open list's tokens by the day it
    // last saw (that used to happen before the page even asked the server), only when the server says it has passed
    const moving = (await owner.ok('lists/create', { title: 'Moved party', eventDate: isoDay(1) })).list;
    const wish = (await owner.ok('items/add', { listId: moving.id, url: 'https://no-such-shop-genie-check.co.uk/products/party-hat' })).item;
    const seen = (await visitor.ok('w/view', { code: moving.shareCode, tokens: [] })).list;
    const { token: hat } = await visitor.ok('w/grant', { code: moving.shareCode, itemId: wish.id });
    G.saveGrant(seen.key, moving.shareCode, seen.eventDate, wish.id, hat);
    assert.equal((await owner.ok('lists/update', { id: moving.id, eventDate: isoDay(14) })).list.eventDate, isoDay(14), 'moved with a grant in place');
    // two days later the browser opens it again (the steps Wishlist.tsx's load() takes)
    const later = isoDay(2);
    G.adoptOld();
    const sent = G.tokensFor(moving.shareCode);
    assert.deepEqual(sent, { [wish.id]: hat }, 'the token is still there to send, though the day it was saved with has gone');
    const after = (await visitor.ok('w/view', { code: moving.shareCode, tokens: Object.values(sent) })).list;
    assert.equal(after.revealed, false);
    assert.equal(after.items.find((i: any) => i.id === wish.id).state, 'mine', 'so it still shows as Yours, with Undo');
    const { tokens, from } = G.heldFor(after.key, moving.shareCode, after.items.map((i: any) => i.id));
    G.file(after.key, moving.shareCode, after.eventDate, tokens, from);
    G.forgetPassed({ key: after.key, code: moving.shareCode }, later);
    assert.deepEqual(entry(seen.key), { c: moving.shareCode, d: isoDay(14), t: { [wish.id]: hat } }, 'kept, with the new day');
    G.forgetPassed({ key: after.key, code: moving.shareCode }, isoDay(400));
    assert.ok(entry(seen.key), "the open list's tokens are never cleared by date alone");

    // other lists' tokens go 30 days after the day this browser last saw for them
    for (const [key, d] of [['kept-a', '2026-11-01'], ['gone-b', '2026-10-31']]) store.set(`genie:undo:${key}`, JSON.stringify({ c: `${key.slice(0, 4)}CODE`, d, t: { w: 'token' } }));
    G.forgetPassed({ code: 'ZZZZZZZZ' }, '2026-12-01');
    assert.ok(entry('kept-a') && !entry('gone-b'), '30 days after the day: kept; 31: cleared');
    G.forgetPassed({ code: 'ZZZZZZZZ' }, isoDay(30));
    assert.ok(entry(seen.key), 'the moved list, not open now, is kept until 30 days after its new day');

    // tokens kept the old way (per share code) join what's there, never replace it, even when an old tab writes again
    store.set(`genie:grants:${moving.shareCode}`, JSON.stringify({ w1: 't1' }));
    G.adoptOld();
    store.set(`genie:grants:${moving.shareCode}`, JSON.stringify({ w2: 't2' }));
    G.adoptOld();
    assert.deepEqual(entry(seen.key).t, { [wish.id]: hat, w1: 't1', w2: 't2' }, 'merged into the list they belong to');
    assert.equal(store.get(`genie:grants:${moving.shareCode}`), undefined);
    store.set('genie:grants:BBBBBBBB', JSON.stringify({ q: 'r' }));
    G.adoptOld();
    store.set('genie:grants:BBBBBBBB', JSON.stringify({ s: 't' }));
    G.adoptOld();
    assert.deepEqual(entry('old-BBBBBBBB').t, { q: 'r', s: 't' }, 'a list not opened yet: merged under a stand-in key');
    delete (globalThis as any).localStorage;
  }
  section('Undo tokens in the browser');

  // ----- the reveal (a list whose day was yesterday) -----
  const past = (await owner.ok('lists/create', { title: 'Yesterday', eventDate: isoDay(-1) })).list;
  assert.equal(past.revealed, true);
  const w = (await owner.ok('items/add', { listId: past.id, url: 'https://no-such-shop-genie-check.co.uk/products/ember-mug-2' })).item;
  assert.equal((await visitor.call('w/grant', { code: past.shareCode, itemId: w.id })).status, 403, 'no grants after the day');
  const reuse = (await owner.ok('lists/reuse', { id: past.id, eventDate: isoDay(30) })).list;
  assert.equal(reuse.revealed, false);
  section('Reveal');

  // ----- link previews: the share page says whose list it is, safely -----
  const page = await fetch(`${BASE}/w/${cleared.shareCode}`);
  if (page.status === 200 && /<html/i.test(await page.clone().text())) {
    const html = await page.text();
    assert.match(html, /og:title/);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    // $ patterns in a title are just text (a replacement string once pasted the page's own head into it)
    for (const t of ["a $' b", 'a $` b', 'a $& b $$ c']) {
      const l = (await owner.ok('lists/create', { title: t, eventDate: isoDay(5) })).list;
      assert.equal(l.title, t);
      const h = await (await fetch(`${BASE}/w/${l.shareCode}`)).text();
      const esc = t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
      assert.equal(h.match(/<title>/g)?.length, 1, `one <title> for ${t}`);
      assert.ok(h.includes(`<title>${esc} · Genie</title>`), `<title> for ${t}`);
      assert.ok(h.includes(`<meta property="og:title" content="${esc}">`), `og:title for ${t}`);
      assert.equal(h.match(/<head>/g)?.length, 1, `one <head> for ${t}`);
    }
    // whether a preview is there says whether a code is real, so looking codes up is limited per visitor like opening
    // a list (300 per 15 minutes): past that the page still loads, just without a preview
    const prober = { 'cf-connecting-ip': '203.0.113.50' };
    const guesses = Array.from({ length: 300 }, () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x'));
    for (let i = 0; i < guesses.length; i += 25)
      await Promise.all(guesses.slice(i, i + 25).map(async g => (await fetch(`${BASE}/w/${g}`, { headers: prober })).text()));
    const over = await fetch(`${BASE}/w/${cleared.shareCode}`, { headers: prober });
    assert.equal(over.status, 200, 'the page still loads');
    assert.ok(!/og:title/.test(await over.text()), 'no preview past the limit, even for a real code');
    const someoneElse = await (await fetch(`${BASE}/w/${cleared.shareCode}`, { headers: { 'cf-connecting-ip': '203.0.113.51' } })).text();
    assert.match(someoneElse, /og:title/, 'other visitors still get previews');
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
  assert.equal((await anon.call('w/view', { code: cleared.shareCode, tokens: [] })).status, 404);
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
