// Simple in-memory rate limits (one server process): slows down password guessing, code spamming and link fetching.
import { createHash } from 'node:crypto';

// Each key keeps its own window, and is forgotten once it's been quiet for that long: an hour at most, except the
// emails each visitor has asked for today (mailer.ts), a day. The privacy page says so.
const hits = new Map<string, { times: number[]; windowMs: number }>();

// A backstop on memory, whatever the callers put in a key (emails are checked before they get here, but nothing relies
// on that): a long key is kept as its hash, and past MAX_KEYS the least recently used are forgotten. That's set high
// (200,000 keys is a few tens of MB), so flooding the server with new keys to wipe out counts (a visitor's own email
// allowance, or an email's login limits) takes a very large number of addresses and requests.
const MAX_KEY = 200, MAX_KEYS = 200_000;
const keyOf = (key: string) => (key.length > MAX_KEY ? `#${createHash('sha256').update(key).digest('hex')}` : key);
let warnedFull = 0;

/** Records a try for `key` and says whether it's over `max` tries in the last `windowMs`. */
export function limited(keyIn: string, max: number, windowMs: number): boolean {
  const key = keyOf(keyIn), now = Date.now();
  const entry = hits.get(key);
  const recent = (entry?.times ?? []).filter(t => now - t < windowMs);
  const over = recent.length >= max;
  if (!over) recent.push(now);
  // put back at the end, so the map stays in least-recently-used order (a key someone is hammering is never the one forgotten)
  hits.delete(key);
  hits.set(key, { times: recent, windowMs: Math.max(windowMs, entry?.windowMs ?? 0) });
  if (hits.size > MAX_KEYS) {
    for (const k of hits.keys()) { if (hits.size <= MAX_KEYS) break; hits.delete(k); }
    if (now - warnedFull > 3600_000) { warnedFull = now; console.error(`rate limits: over ${MAX_KEYS} keys (a flood of requests?), forgetting the least recently used`); }
  }
  return over;
}
/** Forget a key's tries (e.g. after a successful login). */
export const clearLimit = (key: string) => hits.delete(keyOf(key));

/** For the checks: how many keys are held, and the longest. */
export const limitStats = () => ({ keys: hits.size, longest: [...hits.keys()].reduce((n, k) => Math.max(n, k.length), 0) });

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of hits) if (!e.times.some(t => now - t < e.windowMs)) hits.delete(k);
}, 600_000).unref();
