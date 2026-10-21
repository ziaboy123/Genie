// Lists and wishes: every rule about them, and all their SQL. routes.ts only works out who's asking.
//
// Rules followed here:
//   - ownership is part of every owner query ("user_id = $n"), and a list or wish that isn't yours answers exactly
//     like one that doesn't exist (404), so ids can't be probed
//   - grants are anonymous: only the SHA-256 of the granter's undo token is kept, never who they are
//   - the owner sees nothing about grants until the day after the list's date (London time), not even a count
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS, SHARE_CODE, type ListSummary, type OwnerItem, type OwnerList, type PublicItem, type PublicList } from '@genie/shared';
import { one, q, tx } from '../db/index.ts';
import { Problem } from '../http.ts';
import { cleanUrl, unfurl } from '../unfurl/index.ts';

const listGone = () => new Problem("That list doesn't exist any more.", 404);
const wishGone = () => new Problem("That wish isn't on the list any more.", 404);
const shareGone = () => new Problem("This list doesn't exist any more.", 404);
const nothingToUndo = () => new Problem('There is nothing to undo here.', 404);
const already = () => new Problem("That's already on your list.", 409);
const full = () => new Problem(`A list can hold up to ${LIMITS.itemsPerList} wishes. Remove some to make room.`);

// ---------- dates: the day changes at midnight in London, wherever the server is ----------
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Today in London, as YYYY-MM-DD. */
function today(): string {
  const p = Object.fromEntries(LONDON.formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** A YYYY-MM-DD day moved by some days and years (worked out in UTC, so clock changes don't get in the way). */
function shift(day: string, days: number, years = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d + days)).toISOString().slice(0, 10);
}
/** Grants stop being secret from the day after the list's date. */
const isRevealed = (eventDate: string, now = today()) => eventDate < now;

/** A real YYYY-MM-DD day, from `min` up to two years from today. */
function checkDate(v: unknown, min: string): string {
  const day = String(v ?? '');
  // the round trip catches days that don't exist (31 June, 29 February in most years)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || shift(day, 0) !== day) throw new Problem('Pick a date for the list.');
  if (day < min || day > shift(today(), 0, 2)) throw new Problem('Pick a date between today and two years from now.');
  return day;
}

// ---------- checking what people send ----------
// control characters and the invisible marks that flip text direction (they can disguise a name or a shop)
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]/g;
const tidy = (v: unknown) => (typeof v === 'string' ? v : '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
/** Counted in characters, not UTF-16 units, so an emoji counts as one. */
const length = (s: string) => [...s].length;

/** A list or wish name: one line, 1 to 120 characters. */
function checkTitle(v: unknown, empty: string): string {
  const title = tidy(v);
  if (!title) throw new Problem(empty);
  if (length(title) > LIMITS.title) throw new Problem(`Keep the name to ${LIMITS.title} characters or fewer.`);
  return title;
}
/** Text from a shop's page: cut to fit rather than refused. */
const fit = (v: unknown, max: number) => [...tidy(v)].slice(0, max).join('').trim();

/** A price in pence, from nothing up to the limit. */
function checkPrice(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > LIMITS.maxPrice)
    throw new Problem(`Enter a price up to £${(LIMITS.maxPrice / 100).toLocaleString('en-GB')}.`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id from the browser. Anything that isn't one is just "not found" (and never reaches Postgres, which would choke on it). */
function checkId(v: unknown, gone: () => Problem): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw gone();
  return v.toLowerCase();
}

/** The shop a link goes to, as shown on its card: always the link's real domain, so a dodgy link can't pass as a known shop. */
const shopOf = (url: string) => new URL(url).hostname.replace(/^www\./, '').slice(0, 253);

// ---------- tokens and codes ----------
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Compare two hex hashes without leaking how much of them matched through timing. */
function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 8 random letters and digits (62^8, about 218 trillion): short enough to share, far too many to guess. */
const newShareCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

// ---------- reading lists ----------
type ListRow = { id: string; title: string; event_date: string; share_code: string; wish_count: number; granted_count: number };
const LIST_COLUMNS = `l.id, l.title, l.event_date, l.share_code,
  (select count(*)::int from genie.items i where i.list_id = l.id) as wish_count,
  (select count(*)::int from genie.items i join genie.grants g on g.item_id = i.id where i.list_id = l.id) as granted_count`;

function summary(r: ListRow, now: string): ListSummary {
  const revealed = isRevealed(r.event_date, now);
  return {
    id: r.id, title: r.title, eventDate: r.event_date, shareCode: r.share_code, wishCount: r.wish_count, revealed,
    grantedCount: revealed ? r.granted_count : null,   // not even a count before the day
  };
}

type ItemRow = { id: string; title: string; url: string | null; shop: string | null; price: number | null; currency: string; granted: boolean };
const ITEM_COLUMNS = 'i.id, i.title, i.url, i.shop, i.price, i.currency, exists (select 1 from genie.grants g where g.item_id = i.id) as granted';
const ownerItem = (r: ItemRow, revealed: boolean): OwnerItem => ({
  id: r.id, title: r.title, url: r.url, shop: r.shop, price: r.price, currency: r.currency, granted: revealed ? r.granted : null,
});

/** Your lists: upcoming ones soonest first, then the ones whose day has passed, most recent first. */
export async function myLists(userId: string): Promise<ListSummary[]> {
  const now = today();
  const rows = await q<ListRow>(`select ${LIST_COLUMNS} from genie.lists l where l.user_id = $1
    order by l.event_date < $2::date, case when l.event_date >= $2::date then l.event_date end, l.event_date desc, l.created_at`, [userId, now]);
  return rows.map(r => summary(r, now));
}

/** One of your lists with its wishes in order, or null if it isn't yours (or doesn't exist). */
async function ownedList(userId: string, id: string): Promise<OwnerList | null> {
  const row = await one<ListRow>(`select ${LIST_COLUMNS} from genie.lists l where l.id = $1 and l.user_id = $2`, [id, userId]);
  if (!row) return null;
  const list = summary(row, today());
  const items = await q<ItemRow>(`select ${ITEM_COLUMNS} from genie.items i where i.list_id = $1 order by i.position, i.created_at, i.id`, [id]);
  return { ...list, items: items.map(r => ownerItem(r, list.revealed)) };
}
async function mustList(userId: string, id: string): Promise<OwnerList> {
  const list = await ownedList(userId, id);
  if (!list) throw listGone();
  return list;
}
export const getList = async (userId: string, id: unknown) => mustList(userId, checkId(id, listGone));

/** One of your wishes, with its list's reveal state. */
async function mustItem(userId: string, id: string): Promise<OwnerItem> {
  const row = await one<ItemRow & { event_date: string }>(`select ${ITEM_COLUMNS}, l.event_date from genie.items i
    join genie.lists l on l.id = i.list_id where i.id = $1 and l.user_id = $2`, [id, userId]);
  if (!row) throw wishGone();
  return ownerItem(row, isRevealed(row.event_date));
}

// ---------- changing lists ----------
export async function createList(userId: string, body: Record<string, unknown>): Promise<OwnerList> {
  const title = checkTitle(body.title, 'Give your list a name.');
  const eventDate = checkDate(body.eventDate, shift(today(), -1));   // a day's grace: it can still be yesterday where they are
  const id = await tx(async c => {
    // one at a time per person, so two quick clicks can't squeeze past the limit
    if (!(await c.query('select 1 from genie.users where id = $1 for no key update', [userId])).rowCount) throw new Problem('Please log in again.', 401);
    const { n } = (await c.query('select count(*)::int as n from genie.lists where user_id = $1', [userId])).rows[0];
    if (n >= LIMITS.listsPerUser) throw new Problem(`You can have up to ${LIMITS.listsPerUser} lists. Delete an old one to make room.`);
    // a clash with another list's code is near impossible, but it just means rolling again
    for (let i = 0; i < 5; i++) {
      const r = await c.query(`insert into genie.lists (user_id, title, event_date, share_code) values ($1, $2, $3, $4)
        on conflict (share_code) do nothing returning id`, [userId, title, eventDate, newShareCode()]);
      if (r.rows[0]) return r.rows[0].id as string;
    }
    throw new Error('no free share code after 5 tries');
  });
  return mustList(userId, id);
}

export async function updateList(userId: string, body: Record<string, unknown>): Promise<OwnerList> {
  const id = checkId(body.id, listGone);
  const title = body.title === undefined ? null : checkTitle(body.title, 'Give your list a name.');
  await tx(async c => {
    const cur = (await c.query('select event_date from genie.lists where id = $1 and user_id = $2 for no key update', [id, userId])).rows[0];
    if (!cur) throw listGone();
    let eventDate: string | null = null;
    if (body.eventDate !== undefined && body.eventDate !== cur.event_date) {
      // a list whose day has passed starts again only through reuse (which clears its grants), and an upcoming one
      // can't be moved into the past, which would show its owner the grants early
      if (isRevealed(cur.event_date)) throw new Problem("This list's day has passed. Reuse it to pick a new date.", 409);
      eventDate = checkDate(body.eventDate, today());
    }
    await c.query(`update genie.lists set title = coalesce($2, title), event_date = coalesce($3::date, event_date), updated_at = now()
      where id = $1`, [id, title, eventDate]);
  });
  return mustList(userId, id);
}

export async function deleteList(userId: string, rawId: unknown): Promise<void> {
  const id = checkId(rawId, listGone);
  // its wishes and grants go with it
  if (!(await q('delete from genie.lists where id = $1 and user_id = $2 returning id', [id, userId])).length) throw listGone();
}

/** A fresh share code: the old link stops working (it shows the not-found page). Grants stay. */
export async function newLink(userId: string, rawId: unknown): Promise<OwnerList> {
  const id = checkId(rawId, listGone);
  for (let i = 0; ; i++) {
    try {
      if (!(await q('update genie.lists set share_code = $3, updated_at = now() where id = $1 and user_id = $2 returning id', [id, userId, newShareCode()])).length)
        throw listGone();
      break;
    } catch (e: any) {
      if (e?.code !== '23505' || i >= 4) throw e;   // unique violation: another list has that code, so roll again
    }
  }
  return mustList(userId, id);
}

/** After the day: clear every grant and set a new date, so a birthday list can be next year's list. Same link. */
export async function reuseList(userId: string, body: Record<string, unknown>): Promise<OwnerList> {
  const id = checkId(body.id, listGone);
  const eventDate = checkDate(body.eventDate, today());
  await tx(async c => {
    const cur = (await c.query('select event_date from genie.lists where id = $1 and user_id = $2 for no key update', [id, userId])).rows[0];
    if (!cur) throw listGone();
    // before the day this would wipe grants the owner isn't meant to know about
    if (!isRevealed(cur.event_date)) throw new Problem('You can reuse a list once its day has passed.', 409);
    await c.query('delete from genie.grants g using genie.items i where g.item_id = i.id and i.list_id = $1', [id]);
    await c.query('update genie.lists set event_date = $2, updated_at = now() where id = $1', [id, eventDate]);
  });
  return mustList(userId, id);
}

// ---------- changing wishes ----------
/** Paste a link: Genie reads the shop's page for the name and price, and the wish goes at the end. */
export async function addItem(userId: string, body: Record<string, unknown>): Promise<OwnerItem> {
  const listId = checkId(body.listId, listGone);
  const pasted = cleanUrl(body.url);
  // the cheap checks first, so a missing or full list (or a repeat) never costs a fetch from the shop
  const before = await one(`select (select count(*)::int from genie.items i where i.list_id = l.id) as n,
      exists (select 1 from genie.items i where i.list_id = l.id and i.url = $3) as dup
    from genie.lists l where l.id = $1 and l.user_id = $2`, [listId, userId, pasted]);
  if (!before) throw listGone();
  if (before.n >= LIMITS.itemsPerList) throw full();
  if (before.dup) throw already();

  const page = await unfurl(pasted);   // never fails for a shop that blocks us: it still has the shop and a guessed name
  // the link after any redirects (a short link becomes the real product page), if it's a sound one
  let url = pasted;
  try { url = cleanUrl(page.url); } catch { /* keep what was pasted */ }
  const shop = shopOf(url);
  const title = fit(page.title, LIMITS.title) || fit(`Something from ${shop}`, LIMITS.title);
  const price = typeof page.price === 'number' && Number.isInteger(page.price) && page.price >= 0 && page.price <= LIMITS.maxPrice ? page.price : null;
  // without a price the currency means nothing, and pounds is what the owner will type one in as
  const currency = price !== null && typeof page.currency === 'string' && /^[A-Z]{3}$/.test(page.currency) ? page.currency : 'GBP';
  const id = await tx(async c => {
      // the list is locked while the wish goes in, so two adds can't take the same place or squeeze past the limit
      if (!(await c.query('select 1 from genie.lists where id = $1 and user_id = $2 for no key update', [listId, userId])).rowCount) throw listGone();
      const room = (await c.query(`select count(*)::int as n, coalesce(max(position), 0) as last, coalesce(bool_or(url = any($2::text[])), false) as dup
        from genie.items where list_id = $1`, [listId, [pasted, url]])).rows[0];
      if (room.n >= LIMITS.itemsPerList) throw full();
      if (room.dup) throw already();
      const r = await c.query(`insert into genie.items (list_id, position, title, url, shop, price, currency)
        values ($1, $2, $3, $4, $5, $6, $7) returning id`, [listId, room.last + 1, title, url, shop, price, currency]);
      await c.query('update genie.lists set updated_at = now() where id = $1', [listId]);
      return r.rows[0].id as string;
    });
  return mustItem(userId, id);
}

/** Fix a wish's name, link or price (each only if sent; null clears the link or price). */
export async function updateItem(userId: string, body: Record<string, unknown>): Promise<OwnerItem> {
  const id = checkId(body.id, wishGone);
  const sets: string[] = [], values: unknown[] = [id];
  const set = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (body.title !== undefined) set('title', checkTitle(body.title, 'Give the wish a name.'));
  const url = body.url === undefined ? undefined : body.url === null || (typeof body.url === 'string' && !body.url.trim()) ? null : cleanUrl(body.url);
  if (url !== undefined) {
    set('url', url);
    if (url) set('shop', shopOf(url));   // the card always shows where the link really goes
  }
  if (body.price !== undefined) set('price', body.price === null ? null : checkPrice(body.price));

  await tx(async c => {
    // the list is locked like an add, so the same link can't end up on it twice
    const cur = (await c.query(`select i.list_id from genie.items i join genie.lists l on l.id = i.list_id
      where i.id = $1 and l.user_id = $2 for no key update of l`, [id, userId])).rows[0];
    if (!cur) throw wishGone();
    if (url && (await c.query('select 1 from genie.items where list_id = $1 and url = $2 and id <> $3', [cur.list_id, url, id])).rowCount) throw already();
    if (!sets.length) return;
    await c.query(`update genie.items set ${sets.join(', ')} where id = $1`, values);
    await c.query('update genie.lists set updated_at = now() where id = $1', [cur.list_id]);
  });
  return mustItem(userId, id);
}

export async function deleteItem(userId: string, rawId: unknown): Promise<void> {
  const id = checkId(rawId, wishGone);
  // its grant goes with it; the granter's browser then just holds a token for a wish that's gone
  const row = await one(`delete from genie.items i using genie.lists l where i.id = $1 and l.id = i.list_id and l.user_id = $2
    returning i.list_id`, [id, userId]);
  if (!row) throw wishGone();
  await q('update genie.lists set updated_at = now() where id = $1', [row.list_id]);
}

/** Put a list's wishes in a new order: `ids` must be exactly the list's wishes, each once. */
export async function reorderItems(userId: string, body: Record<string, unknown>): Promise<OwnerList> {
  const listId = checkId(body.listId, listGone);
  const ids = Array.isArray(body.ids) && body.ids.length <= LIMITS.itemsPerList && body.ids.every(x => typeof x === 'string' && UUID.test(x))
    ? (body.ids as string[]).map(x => x.toLowerCase()) : null;
  await tx(async c => {
    if (!(await c.query('select 1 from genie.lists where id = $1 and user_id = $2 for no key update', [listId, userId])).rowCount) throw listGone();
    const have: string[] = (await c.query('select id from genie.items where list_id = $1', [listId])).rows.map(r => r.id);
    const wanted = new Set(ids);
    // a wish added or removed in another tab since this page loaded: start from what's really there
    if (!ids || wanted.size !== ids.length || ids.length !== have.length || !have.every(x => wanted.has(x)))
      throw new Problem('Your list changed somewhere else. Refresh and try again.', 409);
    await c.query(`update genie.items i set position = t.n::int from unnest($2::uuid[]) with ordinality as t(id, n)
      where i.id = t.id and i.list_id = $1`, [listId, ids]);
    await c.query('update genie.lists set updated_at = now() where id = $1', [listId]);
  });
  return mustList(userId, listId);
}

// ---------- the share page (no login) ----------
type ShareRow = { id: string; user_id: string; title: string; event_date: string; owner_name: string };
/** The list behind a share code. A code that can't be one never reaches the database. */
async function byCode(code: unknown): Promise<ShareRow | null> {
  if (typeof code !== 'string' || !SHARE_CODE.test(code)) return null;
  return (await one<ShareRow>(`select l.id, l.user_id, l.title, l.event_date, u.name as owner_name
    from genie.lists l join genie.users u on u.id = l.user_id where l.share_code = $1`, [code])) ?? null;
}

/** For a share link's preview in WhatsApp, iMessage and so on: whose list, and how many wishes. */
export async function shareMeta(code: string): Promise<{ title: string; ownerName: string; count: number } | null> {
  if (!SHARE_CODE.test(code)) return null;
  const row = await one(`select l.title, u.name as owner_name, (select count(*)::int from genie.items i where i.list_id = l.id) as count
    from genie.lists l join genie.users u on u.id = l.user_id where l.share_code = $1`, [code]);
  return row ? { title: row.title, ownerName: row.owner_name, count: row.count } : null;
}

/** The undo tokens a browser holds for this list: at most 200 short strings (anything else is ignored). */
const cleanTokens = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 64).slice(0, 200);

/** The share page. `tokens` are this browser's undo tokens, so its own grants show as "mine". */
export async function viewList(code: unknown, tokens: unknown, viewerId: string | null): Promise<PublicList> {
  const list = await byCode(code);
  if (!list) throw shareGone();
  const revealed = isRevealed(list.event_date);
  const isOwner = viewerId === list.user_id;
  const hidden = isOwner && !revealed;   // the owner, logged in, before the day: no grant state at all
  const held = new Set(cleanTokens(tokens).map(sha256));
  const rows = await q(`select i.id, i.title, i.url, i.shop, i.price, i.currency, g.undo_hash from genie.items i
    left join genie.grants g on g.item_id = i.id where i.list_id = $1 order by i.position, i.created_at, i.id`, [list.id]);
  const items: PublicItem[] = rows.map(r => ({
    id: r.id, title: r.title, url: r.url, shop: r.shop, price: r.price, currency: r.currency,
    state: hidden ? 'hidden' : !r.undo_hash ? 'open' : held.has(r.undo_hash) ? 'mine' : 'granted',
  }));
  // wishes someone else granted sink to the bottom (sort is stable). Never for the owner: the order would give it away
  if (!hidden) items.sort((a, b) => Number(a.state === 'granted') - Number(b.state === 'granted'));
  return { title: list.title, ownerName: list.owner_name, eventDate: list.event_date, revealed, isOwner, items };
}

/** Grant a wish: returns the undo token, which only this browser ever holds (the database keeps its hash). */
export async function grantWish(code: unknown, rawItemId: unknown, viewerId: string | null): Promise<string> {
  const list = await byCode(code);
  if (!list) throw shareGone();
  if (viewerId === list.user_id) throw new Problem('This is your list.', 403);
  // once the day has passed the owner can see grants, so a new one would be no secret
  if (isRevealed(list.event_date)) throw new Problem("This list's day has been and gone.", 403);
  const itemId = checkId(rawItemId, wishGone);
  const token = randomBytes(32).toString('base64url');
  // one grant per wish: if two people press at once, the first insert wins and the other one inserts nothing
  const won = await q(`insert into genie.grants (item_id, undo_hash) select id, $3::text from genie.items where id = $1 and list_id = $2
    on conflict do nothing returning item_id`, [itemId, list.id, sha256(token)])
    .catch(e => { if (e?.code === '23503') throw wishGone(); throw e; });   // the wish was deleted mid-grant
  if (won.length) return token;
  if (await one('select 1 from genie.items where id = $1 and list_id = $2', [itemId, list.id])) throw new Problem('Someone just granted this one.', 409);
  throw wishGone();
}

/** Undo a grant: only with the token the grant handed out. */
export async function ungrantWish(code: unknown, rawItemId: unknown, token: unknown): Promise<void> {
  const list = await byCode(code);
  if (!list) throw shareGone();
  // after the day the owner has seen what was granted, so it stays as it was
  if (isRevealed(list.event_date)) throw new Problem("This list's day has been and gone.", 403);
  const itemId = checkId(rawItemId, nothingToUndo);
  if (typeof token !== 'string' || !token || token.length > 64) throw nothingToUndo();
  const hash = sha256(token);
  const row = await one('select g.undo_hash from genie.grants g join genie.items i on i.id = g.item_id where g.item_id = $1 and i.list_id = $2', [itemId, list.id]);
  if (!row || !sameHash(row.undo_hash, hash)) throw nothingToUndo();
  // the hash again, in case the grant was undone and someone else granted it in between
  await q('delete from genie.grants where item_id = $1 and undo_hash = $2', [itemId, hash]);
}
