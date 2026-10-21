// The small HTTP pieces every API route shares: JSON in and out, cookies, who's asking, and same-site checks.
//
// Every request that changes something must be JSON (which a plain HTML form on another site can't send) and come
// from this site (its Origin header is checked), and the login cookie is SameSite=Strict, so other sites can't act
// for a logged-in person.
import { isIPv4, isIPv6 } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BASE, DEV } from './config.ts';

/** An error the person should see (its message is shown as-is), with its HTTP status. */
export class Problem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const tooMany = () => new Problem('Too many attempts. Wait a few minutes and try again.', 429);
export const notFound = () => new Problem('Not found.', 404);

export function send(res: ServerResponse, status: number, body: unknown, setCookies: string[] = []) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(setCookies.length ? { 'set-cookie': setCookies } : {}) });
  res.end(JSON.stringify(body));
}

/** The JSON body of a POST: an object, at most 16 KB. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Problem('Expected JSON.', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Problem('Too much data.', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch { throw new Problem('Bad JSON.'); }
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const value = part.slice(i + 1).trim();
    try { out[part.slice(0, i).trim()] = decodeURIComponent(value); } catch { out[part.slice(0, i).trim()] = value; }   // a malformed cookie is just a wrong one
  }
  return out;
}
/** A Set-Cookie value scoped to the site's path. maxAge 0 deletes it. */
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=${BASE}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${DEV ? '' : '; Secure'}`;
}

/** Is this request from a page on this site? (Browsers always send Origin on these requests.) */
export function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/**
 * Who a request is from, for rate limits. In production everything reaches Node through nginx on 127.0.0.1, and
 * Cloudflare puts the real visitor in CF-Connecting-IP (nginx makes sure that header can't be faked from the LAN).
 * The header only counts when the connection itself came from this machine: anyone reaching the port directly
 * could write anything in it. A whole IPv6 /64 counts as one visitor (one home gets a whole block).
 */
export function clientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? '';
  if (isLoopback(peer)) {
    const header = req.headers['cf-connecting-ip'];
    const fromHeader = typeof header === 'string' ? visitorKey(header.split(',')[0]) : null;
    if (fromHeader) return fromHeader;
  }
  return visitorKey(peer) ?? 'unknown';
}
function parseAddress(value: string): { v4: string } | { v6: number[] } | null {
  const addr = value.trim().split('%')[0];
  if (isIPv4(addr)) return { v4: addr };
  if (!isIPv6(addr)) return null;
  const [head, tail] = addr.split('::');
  const part = (p?: string) => (p ? p.split(':') : []).flatMap(g => {
    if (!g.includes('.')) return [parseInt(g, 16)];
    const [a, b, c, d] = g.split('.').map(Number);
    return [(a << 8) | b, (c << 8) | d];
  });
  const left = part(head), right = part(tail);
  const groups = [...left, ...(tail === undefined ? [] : Array(8 - left.length - right.length).fill(0)), ...right];
  // "::ffff:1.2.3.4" is just an IPv4 address dressed up as IPv6
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff)
    return { v4: [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.') };
  return { v6: groups };
}
function isLoopback(value: string) {
  const a = parseAddress(value);
  if (!a) return false;
  return 'v4' in a ? a.v4.startsWith('127.') : a.v6.every((g, i) => g === (i === 7 ? 1 : 0));
}
function visitorKey(value: string): string | null {
  const a = parseAddress(value);
  if (!a) return null;
  return 'v4' in a ? a.v4 : a.v6.slice(0, 4).map(g => g.toString(16)).join(':') + '::/64';
}

/** "Chrome on Mac", for the list of trusted devices. */
export function deviceLabel(req: IncomingMessage) {
  const ua = String(req.headers['user-agent'] ?? '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

/** Turn a thrown error into a JSON answer: a Problem's own message, anything else a logged 500. */
export function sendError(res: ServerResponse, where: string, e: any) {
  if (e instanceof Problem) return send(res, e.status, { error: e.message });
  console.error(`${where}: ${e?.stack ?? e}`);
  send(res, 500, { error: 'Something went wrong. Try again in a moment.' });
}
