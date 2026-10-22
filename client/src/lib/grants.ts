// The undo tokens for wishes this browser granted. Visitors have no account, so this is the only thing that says
// "you granted this": whoever holds the token can undo the grant, nobody else.
//
// Kept per list, under the key its share page gives, which stays the same when the owner gets a new link (unlike the
// share code): genie:undo:<key> = { c: the share code it was last opened with, d: the list's day, t: { [itemId]: token } }.
// Once a list's day has passed its grants can't be undone, so its tokens are cleared: by its own share page, once the
// server says the day has passed (the owner may have moved it later, which only the server knows), and for a list that
// isn't opened again, by any share page 30 days after the day this browser last saw for it, even if that list has
// since been deleted (the privacy page says so).
// Storage can be blocked or full (private windows); then grants still work, they just can't be undone later.
import { londonDay } from './format.ts';

export type Tokens = Record<string, string>;
interface Held { c: string; d: string; t: Tokens }

const PREFIX = 'genie:undo:';
// before list keys (October 2026), tokens were kept per share code, with no date
const OLD = /^genie:grants:([A-Za-z0-9]{8})$/;

/** At most 200 { itemId: token } pairs of sensible size; anything else is ignored. */
function cleanTokens(raw: unknown): Tokens {
  const out: Tokens = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    for (const [id, token] of Object.entries(raw).slice(0, 200)) if (typeof token === 'string' && token.length <= 64 && id.length <= 64) out[id] = token;
  return out;
}
function read(storageKey: string): Held | null {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!raw || typeof raw !== 'object' || typeof raw.c !== 'string' || typeof raw.d !== 'string') return null;
    return { c: raw.c, d: raw.d, t: cleanTokens(raw.t) };
  } catch { return null; }
}
/** Every storage key this site has (none when storage is blocked). */
function storageKeys(): string[] {
  try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k); }
  catch { return []; }
}
const remove = (storageKey: string) => { try { localStorage.removeItem(storageKey); } catch {} };
/** Saves (or, with no tokens, removes) an entry; false if storage refused. */
function write(storageKey: string, held: Held): boolean {
  try {
    if (Object.keys(held.t).length) localStorage.setItem(storageKey, JSON.stringify(held));
    else localStorage.removeItem(storageKey);
    return true;
  } catch { return false; }
}
const allHeld = () => storageKeys().filter(k => k.startsWith(PREFIX)).map(k => [k, read(k)] as const);

/** The day `days` before `iso` (both YYYY-MM-DD). */
function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Run before a share page loads. Files tokens kept the old way (per share code) the new way. They join whatever this
 * browser already holds for that code (a tab left open from before can write the old way again after a move, and
 * must not wipe what was moved), or go under a stand-in key until their list is opened, dated two years ahead (the
 * furthest a list's day can be), so they're cleared in the end even if it never is.
 */
export function adoptOld() {
  for (const k of storageKeys()) {
    const code = OLD.exec(k)?.[1];
    if (!code) continue;
    let t: Tokens = {};
    try { t = cleanTokens(JSON.parse(localStorage.getItem(k) ?? '{}')); } catch {}
    const [into, held] = allHeld().find(([, h]) => h?.c === code) ?? [`${PREFIX}old-${code}`, null];
    // the old-way copy was written last, so its token wins for a wish that's in both
    if (write(into, { c: code, d: held?.d ?? londonDay(2), t: { ...held?.t, ...t } })) remove(k);   // storage full: try again next time
  }
}

// how long another list's tokens are kept after the day this browser last saw for it: long enough that a list moved to
// a later day keeps its Undo until it's opened again (which brings the new day), and still long after any use
const GRACE_DAYS = 30;

/**
 * Run once a share page has loaded (or failed to). Clears the tokens of every other list whose day, as this browser
 * last saw it, was more than 30 days ago (the day passes at midnight in London, as it does for the server). The list
 * that's open (its key once it loaded, and the code it was opened with) is left alone: its page clears its tokens when
 * the server says its day has passed. `today` is only ever set by the checks.
 */
export function forgetPassed(open: { key?: string; code: string }, today = londonDay()) {
  const before = daysBefore(today, GRACE_DAYS);
  for (const [k, held] of allHeld()) {
    if (!held) remove(k);   // unreadable: no use to anyone
    else if (k !== `${PREFIX}${open.key ?? ''}` && held.c !== open.code && held.d < before) remove(k);
  }
}

/** The tokens filed for the list this share code was last opened as (sent with the first look at it). */
export function tokensFor(code: string): Tokens {
  return Object.assign({}, ...allHeld().filter(([, h]) => h?.c === code).map(([, h]) => h!.t));
}

/**
 * Every token this browser holds for a list, now that its key and wishes are known: the ones filed under its key, or
 * under this code, and any filed elsewhere for one of its wishes (from before it got a new link, or from before list
 * keys). `from` is where they were found, so file() can tidy them into one place.
 */
export function heldFor(key: string, code: string, itemIds: string[]): { tokens: Tokens; from: string[] } {
  const ids = new Set(itemIds);
  const found = allHeld().filter(([k, h]) => h && (k === PREFIX + key || h.c === code || Object.keys(h.t).some(id => ids.has(id))));
  return { tokens: Object.assign({}, ...found.map(([, h]) => h!.t)), from: found.map(([k]) => k) };
}

/** Keeps exactly these tokens for the list (none: forgets it), with the code and day it was last seen with. */
export function file(key: string, code: string, day: string, tokens: Tokens, from: string[] = []) {
  for (const k of from) if (k !== PREFIX + key) remove(k);
  write(PREFIX + key, { c: code, d: day, t: tokens });
}

export const readGrants = (key: string): Tokens => read(PREFIX + key)?.t ?? {};

export function saveGrant(key: string, code: string, day: string, itemId: string, token: string) {
  file(key, code, day, { ...readGrants(key), [itemId]: token });
}

export function dropGrant(key: string, itemId: string) {
  const held = read(PREFIX + key);
  if (!held) return;
  delete held.t[itemId];
  write(PREFIX + key, held);
}
