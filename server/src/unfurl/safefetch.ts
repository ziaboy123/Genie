// Fetching shop pages without ever letting a pasted link reach inside the network.
//
// Anyone with an account can make the server fetch any link, and the server sits on a private home network, so
// every request is checked before it leaves: http(s) on the normal ports, no LAN-only names, and every address the
// name resolves to must be public. The connection then goes to exactly the addresses that were checked, so a name
// that answers differently a moment later (DNS rebinding) gets nowhere, and every redirect is checked from scratch.
import { Resolver } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { rootCertificates } from 'node:tls';
import zlib from 'node:zlib';

const HEADERS_MS = 5_000, TOTAL_MS = 8_000, MAX_REDIRECTS = 3;
/** How long a caller waits for one of the 4 fetch slots before giving up (the shop just counts as unreachable). */
const QUEUE_MS = 10_000;
// honest about who's asking, with a link to what GenieBot does and how a site can opt out (the Terms' "For shops" part)
const USER_AGENT = 'Mozilla/5.0 (compatible; GenieBot/1.0; +https://daniyalzia.co.uk/genie/terms#geniebot)';

/** The link points somewhere Genie never goes (a LAN address, an odd port…). Nothing was sent to it. */
export class Blocked extends Error {
  constructor(readonly reason: 'scheme' | 'login' | 'port' | 'name' | 'address') { super(`blocked: ${reason}`); }
}
/** The site didn't give a usable answer (timeout, error status, too big…). `url` is the last link tried, if any. */
export class FetchFailed extends Error {
  url?: string;
}

// ---------- which addresses are off limits ----------
// Two lists, because a BlockList checks IPv4 addresses against its IPv6 rules too (as ::ffff:a.b.c.d), so the
// ::ffff:0:0/96 rule below would block every IPv4 address.
// Everything that isn't the public internet: "this network", private ranges, carrier NAT, loopback, link-local (cloud
// metadata lives at 169.254.169.254), documentation and benchmark ranges, multicast and reserved.
const BLOCKED_V4 = new BlockList(), BLOCKED_V6 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
] as const) BLOCKED_V4.addSubnet(net, bits, 'ipv4');
// The IPv6 equivalents. The ranges that wrap an IPv4 address (mapped ::ffff:, NAT64 64:ff9b::, 6to4 2002::) are
// refused whole, whatever address they carry: no shop needs one, and they could smuggle a LAN address through.
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['3fff::', 20], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) BLOCKED_V6.addSubnet(net, bits, 'ipv6');
// Every public IPv6 address is in 2000::/3, so anything outside it is refused too (the old ::a.b.c.d form, site-local fec0::…).
const PUBLIC_V6 = new BlockList();
PUBLIC_V6.addSubnet('2000::', 3, 'ipv6');
// GENIE_FETCH_BLOCK adds more, comma-separated (e.g. the home's own public address, which from inside can loop back to the router)
for (const entry of (process.env.GENIE_FETCH_BLOCK ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
  const [address, bits, extra] = entry.split('/');
  const v = isIP(address);
  if (!v || extra !== undefined || (bits !== undefined && !/^\d{1,3}$/.test(bits))) throw new Error(`GENIE_FETCH_BLOCK: "${entry}" isn't an address or a range`);
  (v === 4 ? BLOCKED_V4 : BLOCKED_V6).addSubnet(address, bits === undefined ? (v === 4 ? 32 : 128) : Number(bits), v === 4 ? 'ipv4' : 'ipv6');
}

/** Is this address anywhere but the public internet? (Anything that isn't an address at all counts as blocked.) */
export function isBlockedAddress(address: string): boolean {
  const addr = address.split('%')[0];   // a zone id ("fe80::1%eth0") would make the lists miss the address
  const v = isIP(addr);
  if (v === 4) return BLOCKED_V4.check(addr, 'ipv4');
  if (v === 6) return !PUBLIC_V6.check(addr, 'ipv6') || BLOCKED_V6.check(addr, 'ipv6') || BLOCKED_V4.check(addr, 'ipv6');   // the last: a mapped v4 address
  return true;
}

// Names that only mean something inside a network (home.arpa and reverse-DNS names are under arpa), or never resolve publicly.
const LAN_NAMES = ['localhost', 'local', 'internal', 'lan', 'arpa', 'localdomain', 'home', 'corp', 'intranet', 'private', 'test', 'invalid', 'example', 'onion'];

/** The checks that need no lookup: http(s), no login, the normal ports, a public-looking name. Returns the bare host name. */
function checkShape(url: URL): string {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Blocked('scheme');
  if (url.username || url.password) throw new Blocked('login');
  if (url.port !== '' && url.port !== '80' && url.port !== '443') throw new Blocked('port');
  // the URL parser has already turned 2130706433, 0x7f.1 and 0177.0.0.1 into 127.0.0.1, and [::ffff:127.0.0.1] into [::ffff:7f00:1]
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.+$/, '').toLowerCase();
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Blocked('address');
    return host;
  }
  // a name without a dot ("pve", "router") can only be a machine on the local network
  if (!host.includes('.') || LAN_NAMES.some(s => host === s || host.endsWith(`.${s}`))) throw new Blocked('name');
  return host;
}

// ---------- taking turns ----------
/** At most `size` at once; the rest wait in order. */
export class Gate {
  private busy = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly size: number) {}
  /** Waits for a turn (FetchFailed after `waitMs`) and returns the function that ends it. */
  async enter(waitMs: number): Promise<() => void> {
    if (this.busy < this.size) this.busy++;
    else await new Promise<void>((resolve, reject) => {
      const go = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const i = this.queue.indexOf(go);
        if (i >= 0) this.queue.splice(i, 1);
        reject(new FetchFailed('too busy'));
      }, waitMs);
      this.queue.push(go);
    });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.queue.shift();
      if (next) next(); else this.busy--;   // a waiting caller takes the turn over directly
    };
  }
}
const fetches = new Gate(4);

/** Rejects with FetchFailed('timeout') if `promise` hasn't settled by `by` (a Date.now() time). */
function before<T>(promise: Promise<T>, by: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new FetchFailed('timeout')), Math.max(0, by - Date.now())); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// ---------- checking a link ----------
export interface Address { address: string; family: number }
/** A link that passed every check, with the only addresses it may connect to. */
export interface Target { url: URL; host: string; addresses: Address[] }
/** Checks one link (each hop of a redirect chain goes through it): throws Blocked or FetchFailed, or returns the Target. */
export type Vet = (url: URL, by: number) => Promise<Target>;

/**
 * A name's IPv4 and IPv6 addresses, asked of the DNS servers directly. Not dns.lookup(): that's the system's
 * getaddrinfo, which runs on libuv's 4-thread pool (shared with file reads and zlib) and can't be cancelled, and a
 * name whose DNS servers never answer holds a thread for up to 30 s, so a few such links would stall every fetch and
 * every file read. These queries are plain sockets with their own timeout, cancelled when we stop waiting.
 * (The connection only ever goes to these addresses, so which resolver found them doesn't change what's allowed.)
 */
async function resolve(host: string, by: number): Promise<Address[]> {
  const resolver = new Resolver({ timeout: 2_000, tries: 2 });
  // one family failing (no AAAA records, a server that drops AAAA queries) still leaves the other
  const ask = (query: Promise<string[]>, family: number) => query.then(list => list.map(address => ({ address, family })), () => null);
  try {
    const [v4, v6] = await before(Promise.all([ask(resolver.resolve4(host), 4), ask(resolver.resolve6(host), 6)]), by);
    return [...v4 ?? [], ...v6 ?? []];   // IPv4 first: the server may well have no IPv6 route
  } finally {
    resolver.cancel();
  }
}

export const vetUrl: Vet = async (url, by) => {
  const host = checkShape(url);
  if (isIP(host)) return { url, host, addresses: [{ address: host, family: isIP(host) }] };
  const found = await resolve(host, by);
  if (!found.length) throw new FetchFailed('no such site');
  // every address must pass: the connection could end up at any of them
  if (found.some(a => isBlockedAddress(a.address))) throw new Blocked('address');
  return { url, host, addresses: found };
};

// ---------- fetching ----------
export interface FetchOptions {
  accept: string;
  maxBytes: number;
  /** Pages: keep what arrived when the body is too big, too slow or cut off (the <head> comes first). False: it must arrive whole. */
  partial: boolean;
  /** The content types worth reading; anything else fails before its body is downloaded. Every type when left out. */
  types?: string[];
}
export interface Fetched {
  /** The link that finally answered, after any redirects (no #fragment). */
  url: string;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

/**
 * GET a link from the public internet: at most 3 redirects (each checked again), 5 s for an answer, 8 s in all, and
 * never more than `maxBytes` (after decompression). No cookies are sent or kept. `vet` is only ever swapped by
 * check-unfurl.ts, to aim at its local test server.
 */
export async function safeFetch(link: string, opts: FetchOptions, vet: Vet = vetUrl): Promise<Fetched> {
  let url: URL;
  try { url = new URL(link); } catch { throw new Blocked('scheme'); }
  const leave = await fetches.enter(QUEUE_MS);
  let at: string | undefined;
  try {
    const by = Date.now() + TOTAL_MS;
    for (let hop = 0; ; hop++) {
      url.hash = '';
      at = url.href;
      const hopBy = Math.min(Date.now() + HEADERS_MS, by);
      const res = await open(await vet(url, hopBy), opts.accept, hopBy);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        res.destroy();
        if (hop >= MAX_REDIRECTS) throw new FetchFailed('too many redirects');
        try { url = new URL(location, url); } catch { throw new FetchFailed('bad redirect'); }
        continue;
      }
      if (status < 200 || status > 299) { res.destroy(); throw new FetchFailed(`status ${status}`); }
      const contentType = String(res.headers['content-type'] ?? '');
      if (opts.types && !opts.types.includes(contentType.split(';')[0].trim().toLowerCase())) { res.destroy(); throw new FetchFailed('wrong type'); }
      // a download that must be whole and says up front it's too big isn't downloaded at all
      if (!opts.partial && Number(res.headers['content-length']) > opts.maxBytes) { res.destroy(); throw new FetchFailed('too big'); }
      const { body, truncated } = await readBody(res, opts.maxBytes, opts.partial, by);
      return { url: url.href, contentType, body, truncated };
    }
  } catch (e) {
    if (e instanceof FetchFailed) e.url ??= at;
    throw e;
  } finally {
    leave();
  }
}

const ROOTS = [...rootCertificates];

/** A lookup that only ever answers with the addresses already checked, so the connection can't go anywhere else. */
function pinned(addresses: Address[]): LookupFunction {
  return (_host, options, done) => {
    if (options.all) done(null, addresses);
    else done(null, addresses[0].address, addresses[0].family);
  };
}

/** Sends the GET and waits for the response headers (until `by`). */
function open(t: Target, accept: string, by: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const secure = t.url.protocol === 'https:';
    const options: https.RequestOptions = {
      protocol: t.url.protocol, hostname: t.host, port: t.url.port || (secure ? 443 : 80),
      path: `${t.url.pathname}${t.url.search}`, method: 'GET',
      agent: false,   // a fresh connection every time: never one left open to some other address
      lookup: pinned(t.addresses),
      // the certificate is still checked against the name (TLS doesn't allow an IP as the server name)
      ...(secure && !isIP(t.host) ? { servername: t.host } : {}),
      // Node's own trusted roots, passed explicitly: with the default store, shops whose chain is cross-signed (Argos,
      // Waterstones: Sectigo R46 via USERTrust) fail with "unable to get issuer certificate". Same roots, still fully checked.
      ...(secure ? { ca: ROOTS } : {}),
      headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en-GB,en;q=0.8', 'accept-encoding': 'gzip, deflate, br' },
    };
    const req = secure ? https.request(options) : http.request(options);
    const timer = setTimeout(() => req.destroy(new FetchFailed('timeout')), Math.max(0, by - Date.now()));
    req.on('response', res => { clearTimeout(timer); resolve(res); });
    // stays attached: a socket error after the response arrived must not go unhandled
    req.on('error', e => { clearTimeout(timer); reject(e instanceof FetchFailed ? e : new FetchFailed(e.message)); });
    req.end();
  });
}

/** Does this deflate body start with a zlib header? (Some servers send raw deflate without one.) */
const zlibHeader = (b: Buffer) => b.length < 2 || ((b[0] & 0x0f) === 8 && ((b[0] << 8) | b[1]) % 31 === 0);

/** Reads (and decompresses) a body, never holding more than `max` bytes, compressed or not. */
function readBody(res: IncomingMessage, max: number, partial: boolean, by: number): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, raw = 0, settled = false;
    let decoder: zlib.Gunzip | zlib.Inflate | zlib.InflateRaw | zlib.BrotliDecompress | null = null;
    const finish = (problem?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.destroy();
      decoder?.destroy();
      if (problem && !partial) reject(new FetchFailed(problem));
      else resolve({ body: Buffer.concat(chunks), truncated: !!problem });
    };
    const timer = setTimeout(() => finish('timeout'), Math.max(0, by - Date.now()));
    const take = (chunk: Buffer) => {
      if (settled) return;
      if (size + chunk.length > max) {
        chunks.push(chunk.subarray(0, max - size));
        size = max;
        return finish('too big');
      }
      chunks.push(chunk);
      size += chunk.length;
    };
    res.on('error', () => finish('cut off'));
    res.on('close', () => { if (!res.complete) finish('cut off'); });

    const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
    if (encoding === '' || encoding === 'identity') {
      res.on('data', take);
      res.on('end', () => finish());
      return;
    }
    if (!['gzip', 'x-gzip', 'deflate', 'br'].includes(encoding)) return finish('unknown encoding');
    // the size limit applies to what comes out, so a small compressed "bomb" can't fill the memory
    res.on('data', (chunk: Buffer) => {
      if (settled) return;
      raw += chunk.length;
      if (raw > max) return finish('too big');
      if (!decoder) {
        decoder = encoding === 'br' ? zlib.createBrotliDecompress()
          : encoding !== 'deflate' ? zlib.createGunzip()
          : zlibHeader(chunk) ? zlib.createInflate() : zlib.createInflateRaw();
        decoder.on('data', take);
        decoder.on('end', () => finish());
        decoder.on('error', () => finish('bad compression'));
      }
      decoder.write(chunk);
    });
    res.on('end', () => { if (decoder) decoder.end(); else finish(); });
  });
}
