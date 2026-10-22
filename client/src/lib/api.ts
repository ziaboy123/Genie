// Talking to Genie's API. Same-origin only; the login cookie is HttpOnly, so scripts never see it.
import type { Me } from '@genie/shared';

/** A failed call. `fromServer`: the message is Genie's own (not one made up here because none came back). */
export class ApiError extends Error { constructor(message: string, readonly status: number, readonly fromServer = false) { super(message); } }

const API = `${import.meta.env.BASE_URL}api/`;   // "/genie/api/"

/** POST JSON to <base>/api/<path>; throws ApiError with the server's message on failure. */
export async function api<T = { ok: true; me?: Me | null }>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new ApiError("Can't reach Genie. Check your connection.", 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // a 401 can mean the login ran out, or just a wrong password: the session checks which
    if (res.status === 401) dispatchEvent(new Event('genie:recheck'));
    const fallback = res.status >= 500 ? "Genie isn't answering right now. Try again in a moment." : 'Something went wrong. Try again in a moment.';
    const own = typeof data.error === 'string';
    throw new ApiError(own ? data.error : fallback, res.status, own);
  }
  return data as T;
}

/** Who's logged in. `accounts` is false on a server without a database (nothing works there yet). */
export async function fetchMe(): Promise<{ accounts: boolean; me: Me | null }> {
  const res = await fetch(API + 'me', { credentials: 'same-origin' });
  if (res.status === 404) return { accounts: false, me: null };
  // the server (or its database) is struggling: that says nothing about whether you're logged in
  if (!res.ok) throw new ApiError("Can't reach Genie right now.", res.status);
  return { accounts: true, me: (await res.json()).me ?? null };
}

/** The message to show for a failed call. */
export const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.');

/** The same, for signing up and logging in. A 503 from Genie says why itself (busy, no more emails today, switched off);
 *  one with no message (Genie itself not answering) gets a general one. */
export const authMessage = (e: unknown) =>
  e instanceof ApiError && e.status === 503 && !e.fromServer ? 'Signing up and logging in are switched off for a moment.' : message(e);

