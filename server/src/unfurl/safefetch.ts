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
import { domainToASCII } from 'node:url';
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
const STATIC_BLOCK: string[] = [];
for (const entry of (process.env.GENIE_FETCH_BLOCK ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
  const [address, bits, extra] = entry.split('/');
  const v = isIP(address);
  if (!v || extra !== undefined || (bits !== undefined && !/^\d{1,3}$/.test(bits))) throw new Error(`GENIE_FETCH_BLOCK: "${entry}" isn't an address or a range`);
  (v === 4 ? BLOCKED_V4 : BLOCKED_V6).addSubnet(address, bits === undefined ? (v === 4 ? 32 : 128) : Number(bits), v === 4 ? 'ipv4' : 'ipv6');
  STATIC_BLOCK.push(entry);
}

// ---------- names whose addresses are off limits too ----------
// The home's public address changes now and then (it's a home broadband line), so a fixed GENIE_FETCH_BLOCK entry
// would quietly go stale. GENIE_FETCH_BLOCK_HOSTS names it instead (comma-separated, e.g. a dynamic DNS name), and
// whatever those names point to is blocked as well, looked up at start-up and every 5 minutes. The lookups go to
// public DNS servers, because the home network's own DNS may answer with a private address for its own names.
// It never fails open: a lookup that fails keeps the last addresses that worked, and until every name has been
// found once, nothing is fetched at all (wishes are named from their links meanwhile).
const REFRESH_MS = 5 * 60_000, RETRY_MS = 30_000;

/** Looks up a name's addresses: a Resolver, or check-unfurl.ts's stand-in. */
export interface HostLookup {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}
const publicDns = (): HostLookup => {
  const resolver = new Resolver({ timeout: 3_000, tries: 2 });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  return resolver;
};

/** GENIE_FETCH_BLOCK_HOSTS's names, in ASCII, each once. Anything that isn't a host name stops the server starting. */
export function parseBlockHosts(value: string): string[] {
  const hosts = value.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    if (isIP(entry)) throw new Error(`GENIE_FETCH_BLOCK_HOSTS: "${entry}" is an address (those go in GENIE_FETCH_BLOCK)`);
    const host = domainToASCII(entry.replace(/\.+$/, ''));   // lower case too
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new Error(`GENIE_FETCH_BLOCK_HOSTS: "${entry}" isn't a host name`);
    return host;
  });
  // a name written twice ("mc.example, MC.example.") would be looked up once but waited for twice, so nothing would
  // ever be fetched
  return [...new Set(hosts)];
}

/** The addresses some names point to, kept up to date (see above). */
export class HostBlock {
  /** The last answer that worked, for each name. */
  private readonly found = new Map<string, { v4: string[]; v6: string[] }>();
  private v4 = new BlockList();
  private v6 = new BlockList();
  private readonly failing = new Set<string>();
  private logged = '';
  constructor(readonly hosts: readonly string[], private readonly lookup: () => HostLookup = publicDns,
    private readonly log: (line: string) => void = console.log, private readonly fixed: readonly string[] = []) {}

  /** True once every name has been found (straight away when there are none). Until then, nothing is fetched. */
  get ready() { return this.found.size === this.hosts.length; }
  /** Is this address one the names point to? */
  has(address: string, family: 4 | 6) { return family === 4 ? this.v4.check(address, 'ipv4') : this.v6.check(address, 'ipv6'); }
  addresses() { return this.hosts.flatMap(h => { const f = this.found.get(h); return f ? [...f.v4, ...f.v6] : []; }); }

  /** Looks every name up again. A name that can't be looked up keeps its last addresses. */
  async refresh(): Promise<void> {
    const dns = this.lookup();
    await Promise.all(this.hosts.map(async host => {
      // no records of one kind (ENODATA) is an answer; anything else (a timeout, no such name) is a failure
      const ask = (query: Promise<string[]>) => query.then(list => list.filter(a => isIP(a)), (e: any) => (e?.code === 'ENODATA' ? [] : e?.code ?? 'error'));
      const [v4, v6] = await Promise.all([ask(dns.resolve4(host)), ask(dns.resolve6(host))]);
      const last = this.found.get(host);
      const next = { v4: Array.isArray(v4) ? v4 : last?.v4 ?? [], v6: Array.isArray(v6) ? v6 : last?.v6 ?? [] };
      const problem = !Array.isArray(v4) ? v4 : !Array.isArray(v6) ? v6 : null;
      if (!next.v4.length && !next.v6.length) {
        // a name with no address at all is broken, not a reason to stop blocking what it pointed to
        if (!this.failing.has(host)) this.log(`fetch block: couldn't look up ${host} (${problem ?? 'no addresses'}); ${last ? 'keeping its last addresses' : 'no links are fetched until it can be'}`);
        this.failing.add(host);
        return;
      }
      if (problem && !this.failing.has(host)) this.log(`fetch block: couldn't look up all of ${host}'s addresses (${problem}); the rest stay as they were`);
      if (problem) this.failing.add(host);
      else if (this.failing.delete(host)) this.log(`fetch block: ${host} looked up again`);
      this.found.set(host, next);
    }));
    const v4 = new BlockList(), v6 = new BlockList();
    for (const address of this.addresses()) {
      if (isIP(address) === 4) v4.addAddress(address, 'ipv4');
      else v6.addAddress(address, 'ipv6');
    }
    this.v4 = v4;
    this.v6 = v6;
    this.show();
  }

  /** Logs every address that's blocked on top of the private ranges, at start-up and whenever that changes. */
  show() {
    const line = [...new Set([...this.fixed, ...this.addresses()])].join(', ');
    if (line && line !== this.logged) this.log(`fetch block: ${line}`);
    this.logged = line;
  }

  /** Looks the names up now and every 5 minutes (every 30 s until they've all been found). */
  start() {
    this.show();
    if (!this.hosts.length) return;
    const tick = async () => {
      await this.refresh().catch(e => this.log(`fetch block: lookup failed: ${e?.message ?? e}`));
      setTimeout(tick, this.ready ? REFRESH_MS : RETRY_MS).unref();
    };
    tick();
  }
}
const HOME = new HostBlock(parseBlockHosts(process.env.GENIE_FETCH_BLOCK_HOSTS ?? ''), publicDns, console.log, STATIC_BLOCK);
HOME.start();
// on the home server one of them is always needed (the runbook sets both), so their going missing from the .env is
// worth a line in the journal. Only a warning: GenieBot still never reaches the private ranges without them
if (process.env.NODE_ENV === 'production' && !STATIC_BLOCK.length && !HOME.hosts.length)
  console.warn("fetch block: neither GENIE_FETCH_BLOCK nor GENIE_FETCH_BLOCK_HOSTS is set, so links to the home's own public address aren't blocked");

/** Is this address anywhere but the public internet, or one of GENIE_FETCH_BLOCK_HOSTS's? (Anything that isn't an
 *  address at all counts as blocked.) `home` is only ever swapped by check-unfurl.ts. */
export function isBlockedAddress(address: string, home: HostBlock = HOME): boolean {
  const addr = address.split('%')[0];   // a zone id ("fe80::1%eth0") would make the lists miss the address
  const v = isIP(addr);
  if (v === 4) return BLOCKED_V4.check(addr, 'ipv4') || home.has(addr, 4);
  if (v === 6) return !PUBLIC_V6.check(addr, 'ipv6') || BLOCKED_V6.check(addr, 'ipv6') || BLOCKED_V4.check(addr, 'ipv6') || home.has(addr, 6);   // the third: a mapped v4 address
  return true;
}

// Names that only mean something inside a network (home.arpa and reverse-DNS names are under arpa), or never resolve publicly.
const LAN_NAMES = ['localhost', 'local', 'internal', 'lan', 'arpa', 'localdomain', 'home', 'corp', 'intranet', 'private', 'test', 'invalid', 'example', 'onion'];

/** The checks that need no lookup: http(s), no login, the normal ports, a public-looking name. Returns the bare host name. */
function checkShape(url: URL, home: HostBlock): string {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Blocked('scheme');
  if (url.username || url.password) throw new Blocked('login');
  if (url.port !== '' && url.port !== '80' && url.port !== '443') throw new Blocked('port');
  // the URL parser has already turned 2130706433, 0x7f.1 and 0177.0.0.1 into 127.0.0.1, and [::ffff:127.0.0.1] into [::ffff:7f00:1]
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.+$/, '').toLowerCase();
  if (isIP(host)) {
    if (isBlockedAddress(host, home)) throw new Blocked('address');
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
  /** Nobody in it and nobody waiting. */
  get idle() { return this.busy === 0 && !this.queue.length; }
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

// Each account gets one fetch at a time (a second add waits for the first, within the same 10 s), so a few accounts
// pasting slow pages can't take every slot and leave everyone else's wishes named from their links.
const accounts = new Map<string, Gate>();
async function ownTurn(who: string, waitMs: number): Promise<() => void> {
  let gate = accounts.get(who);
  if (!gate) accounts.set(who, gate = new Gate(1));
  const forget = () => { if (gate.idle && accounts.get(who) === gate) accounts.delete(who); };
  let leave: () => void;
  try { leave = await gate.enter(waitMs); } catch (e) { forget(); throw e; }
  return () => { leave(); forget(); };
}

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

/** The real checks, against `home`'s addresses as well as the private ranges (only check-unfurl.ts passes another). */
export const vetWith = (home: HostBlock): Vet => async (url, by) => {
  const host = checkShape(url, home);
  // GENIE_FETCH_BLOCK_HOSTS's addresses aren't known yet: fetch nothing rather than risk one of them
  if (!home.ready) throw new FetchFailed('blocked addresses not known yet');
  if (isIP(host)) return { url, host, addresses: [{ address: host, family: isIP(host) }] };
  const found = await resolve(host, by);
  if (!found.length) throw new FetchFailed('no such site');
  // every address must pass: the connection could end up at any of them
  if (found.some(a => isBlockedAddress(a.address, home))) throw new Blocked('address');
  return { url, host, addresses: found };
};
export const vetUrl: Vet = vetWith(HOME);

// ---------- fetching ----------
export interface FetchOptions {
  accept: string;
  maxBytes: number;
  /** Pages: keep what arrived when the body is too big, too slow or cut off (the <head> comes first). False: it must arrive whole. */
  partial: boolean;
  /** The content types worth reading; anything else fails before its body is downloaded. Every type when left out. */
  types?: string[];
  /** The account asking: it waits for its own earlier fetch to finish first (see ownTurn). */
  who?: string;
  /**
   * Pages only (with `partial`): shown everything up to the first `</head>` once it has arrived (with the page's link
   * and type), and reading stops there if it says that's enough. A slow or big page then holds one of the 4 slots for
   * only as long as its <head> takes. Asked once, so a page full of `</head>`s can't make it run again and again.
   */
  enoughAtHead?: (head: Buffer, page: { url: string; contentType: string }) => boolean;
  /** Gives up on a body that sends nothing at all for this long (with `partial`, what did arrive is kept). */
  idleMs?: number;
}
export interface Fetched {
  /** The link that finally answered, after any redirects (no #fragment). */
  url: string;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

/**
 * GET a link from the public internet: at most 3 redirects (each checked again), 5 s for an answer, 8 s in all (less
 * with `idleMs` or `enoughAtHead`), and never more than `maxBytes` (after decompression). No cookies are sent or kept.
 * `vet` is only ever swapped by check-unfurl.ts, to aim at its local test server.
 */
export async function safeFetch(link: string, opts: FetchOptions, vet: Vet = vetUrl): Promise<Fetched> {
  let url: URL;
  try { url = new URL(link); } catch { throw new Blocked('scheme'); }
  // waiting for this account's own turn and then for a slot share one 10 s
  const queueBy = Date.now() + QUEUE_MS;
  const leaveOwn = opts.who ? await ownTurn(opts.who, QUEUE_MS) : () => {};
  let leave: () => void;
  try { leave = await fetches.enter(Math.max(0, queueBy - Date.now())); } catch (e) { leaveOwn(); throw e; }
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
      const enough = opts.partial && opts.enoughAtHead;
      const { body, truncated } = await readBody(res, opts.maxBytes, opts.partial, by, {
        idleMs: opts.idleMs, enoughAtHead: enough ? head => enough(head, { url: url.href, contentType }) : undefined,
      });
      return { url: url.href, contentType, body, truncated };
    }
  } catch (e) {
    if (e instanceof FetchFailed) e.url ??= at;
    throw e;
  } finally {
    leave();
    leaveOwn();
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

// the end of a page's <head> (the character after it too, so "</header" doesn't count), found in the text as it arrives
const HEAD_END = /<\/head[\s>]/i;

/**
 * Reads (and decompresses) a body, never holding more than `max` bytes, compressed or not. `idleMs`: gives up after
 * that long with nothing arriving. `enoughAtHead`: see FetchOptions (the caller only passes it for pages).
 */
function readBody(res: IncomingMessage, max: number, partial: boolean, by: number,
  { idleMs, enoughAtHead }: { idleMs?: number; enoughAtHead?: (head: Buffer) => boolean } = {}): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, raw = 0, settled = false;
    let decoder: zlib.Gunzip | zlib.Inflate | zlib.InflateRaw | zlib.BrotliDecompress | null = null;
    let idle: NodeJS.Timeout | undefined;
    const finish = (problem?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idle);
      res.destroy();
      decoder?.destroy();
      if (problem && !partial) reject(new FetchFailed(problem));
      else resolve({ body: Buffer.concat(chunks), truncated: !!problem });
    };
    const timer = setTimeout(() => finish('timeout'), Math.max(0, by - Date.now()));
    /** Bytes arrived from the shop: the idle clock starts again. */
    const alive = () => {
      if (!idleMs || settled) return;
      clearTimeout(idle);
      idle = setTimeout(() => finish('stalled'), idleMs);
    };
    alive();
    // looking for </head>: the last few characters of the text so far, in case it's split between two chunks
    let tail = '', headLooked = !enoughAtHead;
    const lookForHead = (chunk: Buffer, at: number) => {
      const text = tail + chunk.toString('latin1');   // one character per byte, so positions match the bytes
      const found = text.search(HEAD_END);
      tail = text.slice(-6);
      if (found < 0) return;
      headLooked = true;
      let enough = false;
      try { enough = enoughAtHead!(Buffer.concat(chunks).subarray(0, at - (text.length - chunk.length) + found)); }
      catch (e: any) { console.error(`fetch: checking a page's <head> failed: ${e?.stack ?? e}`); }   // a bug of ours: read on
      if (enough) finish('enough in the <head>');
    };
    const take = (chunk: Buffer) => {
      if (settled) return;
      const tooBig = size + chunk.length > max;
      if (tooBig) chunk = chunk.subarray(0, max - size);
      chunks.push(chunk);
      const at = size;
      size += chunk.length;
      if (!headLooked) lookForHead(chunk, at);
      if (tooBig) finish('too big');
    };
    res.on('error', () => finish('cut off'));
    res.on('close', () => { if (!res.complete) finish('cut off'); });

    const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
    if (encoding === '' || encoding === 'identity') {
      res.on('data', (chunk: Buffer) => { alive(); take(chunk); });
      res.on('end', () => finish());
      return;
    }
    if (!['gzip', 'x-gzip', 'deflate', 'br'].includes(encoding)) return finish('unknown encoding');
    // the size limit applies to what comes out, so a small compressed "bomb" can't fill the memory
    res.on('data', (chunk: Buffer) => {
      if (settled) return;
      alive();
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
