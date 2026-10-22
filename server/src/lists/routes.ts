// The lists API (under <base>/api): your lists and wishes (lists/*, items/*, logged in) and the share page anyone with
// the link can use (w/*, no login). JSON in, JSON out; the rules themselves are in store.ts.
//
// Every call is a POST of JSON from this site (see http.ts). Owners are rate-limited by account and the share page by
// visitor. Nothing from the body is ever logged: it holds share codes, undo tokens and the links people paste.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sessionUser } from '../auth/accounts.ts';
import { clientIp, cookies, notFound, Problem, readJson, sameOrigin, send, sendError, tooMany } from '../http.ts';
import { limited } from '../ratelimit.ts';
import * as S from './store.ts';

const SESSION = 'genie_session';
const WINDOW = 15 * 60_000;

/** The share page: anyone with the link, logged in or not (a logged-in owner just sees no grants). */
async function shareApi(req: IncomingMessage, action: string): Promise<unknown> {
  const ip = clientIp(req);
  // opening the page is cheap and happens a lot; granting is what someone could spam. Undo has its own count, so
  // undoing never uses up granting (store.ts also caps grants per visitor on each list)
  if (limited(`${action}:${ip}`, action === 'view' ? 300 : 30, WINDOW)) throw tooMany();
  const body = await readJson(req);
  const token = cookies(req)[SESSION];
  const viewerId = async () => (token ? (await sessionUser(token))?.id ?? null : null);
  switch (action) {
    case 'view': return { list: await S.viewList(body.code, body.tokens, await viewerId()) };
    case 'grant': return { token: await S.grantWish(body.code, body.itemId, await viewerId(), ip) };
    case 'ungrant': await S.ungrantWish(body.code, body.itemId, body.token); return { ok: true };
    default: throw notFound();
  }
}

/** Handles <base>/api/lists/*, /api/items/* and /api/w/*. Returns false if the path is none of these. */
export async function listRoutes(req: IncomingMessage, res: ServerResponse, rel: string): Promise<boolean> {
  const area = rel.match(/^\/api\/(lists|items|w)\//)?.[1];
  if (!area) return false;
  try {
    if (req.method !== 'POST') throw notFound();
    if (!sameOrigin(req)) throw new Problem('Requests must come from this site.', 403);

    if (area === 'w') {
      const action = rel.slice('/api/w/'.length);
      if (action !== 'view' && action !== 'grant' && action !== 'ungrant') throw notFound();   // before it counts against a limit
      send(res, 200, await shareApi(req, action));
      return true;
    }

    // ----- signed in -----
    const token = cookies(req)[SESSION];
    const me = token ? await sessionUser(token) : null;
    if (!me) throw new Problem('Please log in again.', 401);
    if (limited(`lists:${me.id}`, 600, WINDOW)) throw tooMany();
    // every add fetches a shop's page, so adds get a much tighter limit of their own
    if (rel === '/api/items/add' && limited(`add:${me.id}`, 60, WINDOW)) throw new Problem("That's a lot of wishes in one go. Wait a few minutes and try again.", 429);
    const body = await readJson(req);
    let out: unknown;
    switch (rel) {
      case '/api/lists/mine': out = { lists: await S.myLists(me.id) }; break;
      case '/api/lists/create': out = { list: await S.createList(me.id, body) }; break;
      case '/api/lists/get': out = { list: await S.getList(me.id, body.id) }; break;
      case '/api/lists/update': out = { list: await S.updateList(me.id, body) }; break;
      case '/api/lists/delete': await S.deleteList(me.id, body.id); out = { ok: true }; break;
      case '/api/lists/new-link': out = { list: await S.newLink(me.id, body.id, body.clearGrants === true) }; break;
      case '/api/lists/reuse': out = { list: await S.reuseList(me.id, body) }; break;
      case '/api/items/add': out = { item: await S.addItem(me.id, body) }; break;
      case '/api/items/update': out = { item: await S.updateItem(me.id, body) }; break;
      case '/api/items/delete': await S.deleteItem(me.id, body.id); out = { ok: true }; break;
      case '/api/items/reorder': out = { list: await S.reorderItems(me.id, body) }; break;
      default: throw notFound();
    }
    send(res, 200, out);
    return true;
  } catch (e) {
    sendError(res, `lists api ${rel.slice(0, 40)}`, e);
    return true;
  }
}
