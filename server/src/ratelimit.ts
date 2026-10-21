// Simple in-memory rate limits (one server process): slows down password guessing, code spamming and link fetching.
const hits = new Map<string, number[]>();

/** Records a try for `key` and says whether it's over `max` tries in the last `windowMs`. */
export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  const over = recent.length >= max;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}
/** Forget a key's tries (e.g. after a successful login). */
export const clearLimit = (key: string) => hits.delete(key);

setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (!list.some(t => now - t < 3600_000)) hits.delete(k);
}, 600_000).unref();
