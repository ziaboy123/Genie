// Checks link fetching and page reading, with no database: `npx tsx check-unfurl.ts` (in server/).
//
// The SSRF guard is the point: LAN names and addresses are refused before anything is sent, a server on 127.0.0.1
// never sees a request, and every redirect is checked again. A local test server stands in for shops, reached only
// through a test `vet` that lets the name "shop.test" (and nothing else) through to it. The last check fetches
// https://example.com/ for real, and is skipped when there's no network.
import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

process.env.GENIE_NO_FETCH = 'Opted-Out.test., www.also-out.test, Bücher.test, not a domain';   // read once, when unfurl loads
const { cleanUrl, optedOut, unfurl } = await import('./src/unfurl/index.ts');
const { Blocked, FetchFailed, isBlockedAddress, safeFetch, vetUrl } = await import('./src/unfurl/safefetch.ts');
const { readPage, parsePrice, slugTitle, decodeHtml } = await import('./src/unfurl/metadata.ts');
const { Problem } = await import('./src/http.ts');
type Vet = import('./src/unfurl/safefetch.ts').Vet;

const MB = 1024 * 1024;
const BLOCKED = "Genie can't open that link.", PASTE = 'Paste a link that starts with http:// or https://.';
const PAGE = { accept: 'text/html', maxBytes: 2 * MB, partial: true, types: ['text/html', 'application/xhtml+xml'] };
// a download that must arrive whole (nothing in the app uses this yet, but the caps should hold for it too)
const IMAGE = { accept: 'image/*', maxBytes: 5 * MB, partial: false };

async function fails(p: Promise<unknown> | (() => unknown), ok: (e: any) => boolean, what: string) {
  try { await (typeof p === 'function' ? p() : p); }
  catch (e: any) { assert.ok(ok(e), `${what}: wrong error: ${e?.constructor?.name} ${e?.message}`); return; }
  assert.fail(`${what}: should have failed`);
}
const isProblem = (message: string) => (e: any) => e instanceof Problem && e.message === message;
const isBlocked = (reason?: string) => (e: any) => e instanceof Blocked && (!reason || e.reason === reason);
const isFailed = (e: any) => e instanceof FetchFailed;
const listen = (server: Server) => new Promise<number>(r => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
const soon = (ms = 5000) => Date.now() + ms;

// ---------- fixtures ----------
const PRODUCT_PAGE = `<!doctype html><html><head>
  <title>Heavyweight Hoodie | Shop Name</title>
  <meta property="og:site_name" content="Shop Name">
  <meta property="og:title" content="OG title loses to JSON-LD">
  <meta property="og:image" content="https://cdn.example.com/og.jpg">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Heavyweight Hoodie &amp; Cap",
    "image":["/img/hoodie.jpg"],"offers":{"@type":"Offer","price":"39.90","priceCurrency":"gbp"}}</script>
</head><body><h1>Heavyweight Hoodie</h1></body></html>`;
const PNG = Buffer.alloc(20_000, 7);   // any bytes: only the size caps are checked
const BOMB = zlib.gzipSync(Buffer.alloc(50 * MB, ' '));   // about 50 KB that opens up to 50 MB

// ---------- the stand-in shop on 127.0.0.1 ----------
const hits: { path: string; headers: IncomingHttpHeaders }[] = [];
let active = 0, maxActive = 0;
const shop = createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x'), p = u.pathname;
  hits.push({ path: p, headers: req.headers });
  const html = (body: string | Buffer, status = 200, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  };
  const redirect = (to: string, status = 302, headers: Record<string, string> = {}) => { res.writeHead(status, { location: to, ...headers }); res.end(); };
  const hop = /^\/hops\/(\d+)$/.exec(p);
  if (hop) return Number(hop[1]) === 0 ? html('<title>Arrived</title>') : redirect(`/hops/${Number(hop[1]) - 1}`, 301);
  switch (p) {
    case '/page': return html('<html><head><title>Plain Page</title></head></html>');
    case '/redirect': return redirect(u.searchParams.get('to') ?? '/');
    case '/setcookie': return redirect('/echo', 302, { 'set-cookie': 'sid=secret; Path=/' });
    case '/echo': return html('<title>Echo</title>');
    case '/big': return html(`<title>Big</title>${'x'.repeat(3 * MB)}`);
    case '/bomb': return html(BOMB, 200, { 'content-encoding': 'gzip' });
    case '/br': return html(zlib.brotliCompressSync('<title>Brotli Socks</title>'), 200, { 'content-encoding': 'br' });
    case '/deflate': return html(zlib.deflateSync('<title>Deflate Socks</title>'), 200, { 'content-encoding': 'deflate' });
    case '/rawdeflate': return html(zlib.deflateRawSync('<title>Raw Socks</title>'), 200, { 'content-encoding': 'deflate' });
    case '/latin1': res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' }); return res.end(Buffer.from('<title>Café Mug</title>', 'latin1'));
    case '/pdf': res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4');
    case '/hang': return;   // never answers
    case '/stall': res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html><head><title>Slow Socks</title>'); return;
    case '/delay':
      active++;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => { active--; html('<title>Delayed</title>'); }, 300);
      return;
    case '/products/heavyweight-hoodie-black': return html(PRODUCT_PAGE);
    case '/robot/heavyweight-hoodie-black': return html('<html><head><title>Just a moment...</title></head></html>');
    case '/s/abc': return redirect('/products/cosy-wool-socks?utm_medium=share');
    case '/products/cosy-wool-socks': return html('<title>Access denied</title>', 403);
    case '/products/fancy-socks': res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4');
    case '/pic.png': res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG);
    case '/huge.png': res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.alloc(6 * MB));
    case '/liar.png': res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(6 * MB) }); res.write(PNG); return;
  }
  if (p.startsWith('/status/')) return html('<title>Nope</title>', Number(p.slice(8)));
  res.writeHead(404);
  res.end();
});
const port = await listen(shop);
const base = `http://shop.test:${port}`;
// the only way past the guard: "shop.test" goes to the local server; everything else gets the real checks
const testVet: Vet = async (url, by) => url.hostname === 'shop.test'
  ? { url, host: 'shop.test', addresses: [{ address: '127.0.0.1', family: 4 }] }
  : vetUrl(url, by);

// ---------- cleanUrl ----------
assert.equal(cleanUrl('https://shop.com/item?utm_source=x&size=M&fbclid=1#reviews'), 'https://shop.com/item?size=M');
assert.equal(cleanUrl('  https://shop.com/a  '), 'https://shop.com/a');
assert.equal(cleanUrl('HTTPS://Shop.COM/Item'), 'https://shop.com/Item');
assert.equal(cleanUrl('https://shop.com/s?q=a%20b&utm_medium=x&_ga=1&gclid=2&mc_cid=3&mc_eid=4&igshid=5&si=6&spm=7&ref_=8'), 'https://shop.com/s?q=a%20b');
assert.equal(cleanUrl('https://shop.com/?UTM_Campaign=x'), 'https://shop.com/');
assert.equal(cleanUrl('https://www.amazon.co.uk/dp/B0TEST?tag=aff-21&psc=1&ref_=x&qid=9&th=1'), 'https://www.amazon.co.uk/dp/B0TEST?psc=1&th=1');
assert.equal(cleanUrl('https://shop.com/item?qid=9&sr=1'), 'https://shop.com/item?qid=9&sr=1');   // Amazon's leftovers mean something elsewhere
assert.equal(cleanUrl('http://shop.com/a b'), 'http://shop.com/a%20b');
for (const link of ['https://shop.com/item?utm_source=x&size=M#top', 'https://shop.com/s?q=a%20b&x=%2F'])
  assert.equal(cleanUrl(cleanUrl(link)), cleanUrl(link), 'cleaning twice changes nothing');
for (const bad of ['javascript:alert(1)', 'ftp://shop.com/x', 'shop.com/item', 'data:text/html,hi', 'file:///etc/passwd', '', '   ', 'https://', 42, null, undefined, {}])
  await fails(() => cleanUrl(bad), isProblem(PASTE), `cleanUrl(${JSON.stringify(bad)})`);
await fails(() => cleanUrl('https://user:pw@shop.com/'), e => e instanceof Problem, 'login in link');
await fails(() => cleanUrl(`https://shop.com/${'a'.repeat(2000)}`), isProblem('That link is too long.'), 'long link');
console.log('cleanUrl OK');

// ---------- addresses and names ----------
for (const a of ['127.0.0.1', '10.68.5.135', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
  '0.0.0.0', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.68.5.135',
  '64:ff9b::a44:587', '2002:a44:587::1', '::a44:587', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'fec0::1', 'ff02::1',
  '2001:db8::1', '100::1', 'not an address'])
  assert.ok(isBlockedAddress(a), `${a} should be blocked`);
for (const a of ['8.8.8.8', '1.1.1.1', '93.184.215.14', '172.32.0.1', '100.128.0.1', '11.0.0.1', '2606:4700:4700::1111', '2a00:1450:4009:81f::200e'])
  assert.ok(!isBlockedAddress(a), `${a} should be allowed`);
// [link, why it's refused]; the spellings of 127.0.0.1 are normalised by the URL parser before the check
const refused: [string, string][] = [
  ['http://127.0.0.1/', 'address'], ['http://localhost/', 'name'], ['http://10.68.5.135/', 'address'], ['http://169.254.169.254/latest/meta-data/', 'address'],
  ['http://[::1]/', 'address'], ['http://[::ffff:127.0.0.1]/', 'address'], ['http://2130706433/', 'address'], ['http://0x7f000001/', 'address'],
  ['http://192.168.1.1/', 'address'], ['http://metadata.google.internal/', 'name'], ['http://0x7f.1/', 'address'], ['http://0177.0.0.1/', 'address'],
  ['http://127.1/', 'address'], ['http://0/', 'address'], ['http://[fe80::1]/', 'address'], ['http://[fd00::1]/', 'address'],
  ['http://[64:ff9b::a44:587]/', 'address'], ['http://[2002:a44:587::1]/', 'address'], ['http://[::a44:587]/', 'address'],
  ['http://pve/', 'name'], ['http://printer.local/', 'name'], ['http://router.lan/', 'name'], ['http://nas.home.arpa/', 'name'],
  ['http://LOCALHOST./', 'name'], ['http://app.localhost/', 'name'], ['http://shop.test/', 'name'], ['https://shop.com:8443/', 'port'],
  ['http://shop.com:22/', 'port'], ['ftp://shop.com/', 'scheme'], ['https://user:pw@shop.com/', 'login'],
];
for (const [link, reason] of refused) await fails(vetUrl(new URL(link), soon()), isBlocked(reason), link);
for (const [link] of refused.filter(([l]) => !/^ftp:|@/.test(l))) await fails(unfurl(link), isProblem(BLOCKED), `unfurl ${link}`);
// the normal ports are fine (no lookup happens for a public IP literal)
for (const link of ['http://8.8.8.8/', 'https://8.8.8.8:443/', 'http://8.8.8.8:80/', 'http://[2606:4700:4700::1111]/'])
  assert.equal((await vetUrl(new URL(link), soon())).addresses.length, 1, link);
// public names that resolve to LAN addresses, through real DNS (skipped when DNS doesn't answer for them: some
// home routers drop such answers as a rebinding guard)
const answered = await Promise.all(['localtest.me', '10.68.5.135.nip.io'].map(async name => {
  try { await vetUrl(new URL(`http://${name}/`), soon()); }
  catch (e: any) {
    if (e instanceof FetchFailed) return false;
    assert.ok(isBlocked('address')(e), `${name}: ${e?.message}`);
    return true;
  }
  assert.fail(`${name} resolves to a private address and must be refused`);
}));
console.log(`blocked hosts and addresses OK${answered.every(Boolean) ? '' : ` (${answered.filter(a => !a).length} DNS rebinding check(s) skipped: no answer)`}`);

// ---------- a server on 127.0.0.1 is never reached ----------
for (const link of [`http://127.0.0.1:${port}/page`, `http://localhost:${port}/page`, `http://[::ffff:127.0.0.1]:${port}/page`, `http://2130706433:${port}/page`])
  await fails(safeFetch(link, PAGE), isBlocked(), link);
await fails(unfurl(`http://127.0.0.1:${port}/products/heavyweight-hoodie-black`), isProblem(BLOCKED), 'unfurl of the local server');
assert.equal(hits.length, 0, 'the local server must not have seen a single request');
console.log('local server refused OK');

// ---------- the fetch itself (through the test vet) ----------
// pinned: "shop.test" doesn't exist in DNS, so this only works because the connection goes to the vetted address
const page = await safeFetch(`${base}/page#frag`, PAGE, testVet);
assert.match(page.body.toString(), /Plain Page/);
assert.equal(page.url, `${base}/page`);
const seen = hits.at(-1)!.headers;
assert.equal(seen.host, `shop.test:${port}`);
assert.equal(seen['user-agent'], 'Mozilla/5.0 (compatible; GenieBot/1.0; +https://daniyalzia.co.uk/genie/terms#geniebot)');
assert.equal(seen['accept-language'], 'en-GB,en;q=0.8');
assert.equal(seen.cookie, undefined);
// every redirect is checked again from scratch
const before = hits.length;
for (const to of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', `http://localhost:${port}/page`, 'http://[::ffff:10.68.5.135]/',
  'http://10.68.5.135/', 'http://router.lan/', 'ftp://shop.com/', 'http://shop.com:8080/'])
  await fails(safeFetch(`${base}/redirect?to=${encodeURIComponent(to)}`, PAGE, testVet), isBlocked(), `redirect to ${to}`);
assert.deepEqual(hits.slice(before).map(h => h.path), Array(8).fill('/redirect'), 'only the redirects themselves were fetched');
await fails(unfurl(`${base}/redirect?to=${encodeURIComponent('http://10.68.5.135/')}`, testVet), isProblem(BLOCKED), 'unfurl of a redirect into the LAN');
assert.match((await safeFetch(`${base}/hops/3`, PAGE, testVet)).body.toString(), /Arrived/, '3 redirects are fine');
await fails(safeFetch(`${base}/hops/4`, PAGE, testVet), isFailed, '4 redirects are too many');
assert.equal((await safeFetch(`${base}/redirect?to=/page`, PAGE, testVet)).url, `${base}/page`, 'relative redirect');
await safeFetch(`${base}/setcookie`, PAGE, testVet);
assert.equal(hits.at(-1)!.path, '/echo');
assert.equal(hits.at(-1)!.headers.cookie, undefined, 'cookies are never sent back');
// size limits apply after decompression
const big = await safeFetch(`${base}/big`, PAGE, testVet);
assert.ok(big.truncated && big.body.length === 2 * MB, 'a big page is cut at 2 MB');
await fails(safeFetch(`${base}/big`, { ...IMAGE, maxBytes: 2 * MB }, testVet), isFailed, 'a big picture fails');
const bomb = await safeFetch(`${base}/bomb`, PAGE, testVet);
assert.ok(bomb.truncated && bomb.body.length === 2 * MB, 'a gzip bomb stops at 2 MB');
await fails(safeFetch(`${base}/bomb`, IMAGE, testVet), isFailed, 'a gzip bomb picture fails');
for (const [p, title] of [['/br', 'Brotli Socks'], ['/deflate', 'Deflate Socks'], ['/rawdeflate', 'Raw Socks']])
  assert.match((await safeFetch(`${base}${p}`, PAGE, testVet)).body.toString(), new RegExp(title), p);
await fails(safeFetch(`${base}/huge.png`, IMAGE, testVet), isFailed, 'a 6 MB picture fails');
await fails(safeFetch(`${base}/liar.png`, IMAGE, testVet), isFailed, 'a picture that says it is 6 MB fails at once');
await fails(safeFetch(`${base}/pdf`, PAGE, testVet), isFailed, 'not a web page');
await fails(safeFetch(`${base}/status/403`, PAGE, testVet), isFailed, 'an error status');
// at most 4 at once, server-wide
await Promise.all(Array.from({ length: 8 }, () => safeFetch(`${base}/delay`, PAGE, testVet)));
assert.equal(maxActive, 4, 'at most 4 fetches in flight');
// time limits: no answer gives up after 5 s; a page that stalls mid-body is used as far as it got, after 8 s
const t0 = Date.now();
const [hang, stall, slow] = await Promise.all([
  safeFetch(`${base}/hang`, PAGE, testVet).then(() => null, e => ({ e, ms: Date.now() - t0 })),
  safeFetch(`${base}/stall`, PAGE, testVet).then(r => ({ r, ms: Date.now() - t0 })),
  unfurl(`${base}/stall`, testVet),
]);
assert.ok(hang && isFailed(hang.e) && hang.ms > 4500 && hang.ms < 6500, `no answer: gave up after ${hang?.ms} ms`);
assert.ok(stall.r.truncated && /Slow Socks/.test(stall.r.body.toString()) && stall.ms > 7500 && stall.ms < 9500, `stalled page: ${stall.ms} ms`);
assert.equal(slow.title, 'Slow Socks');
console.log('safe fetch OK');

// ---------- unfurl, end to end ----------
const hoodie = await unfurl(`${base}/products/heavyweight-hoodie-black?utm_source=newsletter&colour=black`, testVet);
assert.deepEqual(hoodie, {
  url: `${base}/products/heavyweight-hoodie-black?colour=black`, title: 'Heavyweight Hoodie & Cap', shop: 'shop.test',
  price: 3990, currency: 'GBP',
});
const robot = await unfurl(`${base}/robot/heavyweight-hoodie-black`, testVet);
assert.equal(robot.title, 'Heavyweight hoodie black', 'a bot wall falls back to the link');
const short = await unfurl(`${base}/s/abc`, testVet);   // a short link to a shop that then refuses us
assert.deepEqual(short, { url: `${base}/products/cosy-wool-socks`, title: 'Cosy wool socks', shop: 'shop.test', price: null, currency: null });
assert.equal((await unfurl(`${base}/products/fancy-socks`, testVet)).title, 'Fancy socks', 'not a web page');
assert.equal((await unfurl(`${base}/latin1`, testVet)).title, 'Café Mug', 'charset from the header');
assert.equal((await unfurl('http://shop.test.invalid/', testVet).catch(e => e)).message, BLOCKED);
console.log('unfurl OK');

// ---------- sites that asked GenieBot not to visit ----------
assert.ok(optedOut('opted-out.test') && optedOut('www.opted-out.test') && optedOut('SHOP.Opted-Out.test.') && optedOut('also-out.test'));
assert.ok(!optedOut('notopted-out.test') && !optedOut('opted-out.test.evil') && !optedOut('shop.test'));
assert.ok(!optedOut('anything.example', []), 'nothing is opted out by default');
// a non-ASCII domain, entered as written, matches the punycode hostname links always have
assert.ok(optedOut('xn--bcher-kva.test') && optedOut(new URL('https://shop.Bücher.test/').hostname), 'a punycode domain matches');
assert.ok(!optedOut('not a domain'), 'an entry that isn\'t a domain is dropped');
const hitsBefore = hits.length;
assert.deepEqual(await unfurl('https://www.bücher.test/products/blue-glass-mug', testVet),
  { url: 'https://www.xn--bcher-kva.test/products/blue-glass-mug', title: 'Blue glass mug', shop: 'xn--bcher-kva.test', price: null, currency: null });
assert.deepEqual(await unfurl('https://www.opted-out.test/products/blue-glass-mug?utm_source=x', testVet),
  { url: 'https://www.opted-out.test/products/blue-glass-mug', title: 'Blue glass mug', shop: 'opted-out.test', price: null, currency: null });
const viaRedirect = await unfurl(`${base}/redirect?to=${encodeURIComponent('http://opted-out.test/products/red-scarf')}`, testVet);
assert.equal(viaRedirect.url, 'http://opted-out.test/products/red-scarf', 'a redirect into an opted-out site stops there');
assert.equal(viaRedirect.title, 'Red scarf');
assert.equal(hits.length, hitsBefore + 1, 'only the redirect itself was fetched');
console.log('opted-out sites OK');

// ---------- reading pages ----------
const at = 'https://www.shop-name.co.uk/products/heavyweight-hoodie-black';
// JSON-LD @graph with an AggregateOffer
let facts = readPage(`<script type="application/ld+json">{"@graph":[{"@type":"WebPage","name":"Page"},{"@type":["Product"],"name":"Caf&eacute; Mug",
  "image":{"@type":"ImageObject","url":"//cdn.shop.com/mug.jpg"},"offers":{"@type":"AggregateOffer","lowPrice":"1,299.00","priceCurrency":"USD"}}]}</script>`, at);
assert.deepEqual(facts, { title: 'Café Mug', price: 129900, currency: 'USD' });
// a ProductGroup whose price is on its variants, written with raw line breaks inside a string
facts = readPage(`<script type="application/ld+json">{"@type":"ProductGroup","name":"Wool
  Socks","hasVariant":[{"@type":"Product","name":"Wool Socks - Blue","offers":[{"@type":"Offer","price":12.5,"priceCurrency":"EUR"}]}]}</script>`, at);
assert.deepEqual(facts, { title: 'Wool Socks', price: 1250, currency: 'EUR' });
// Open Graph only, with the shop's name in the title, a twice-encoded apostrophe and a relative image
facts = readPage(`<head><meta property="og:site_name" content="Shop Name"><meta property="og:title" content="Men&amp;#39;s Heavyweight Hoodie | Shop Name">
  <meta property="product:price:amount" content="24.99"><meta property="product:price:currency" content="gbp">
  <meta property="og:image" content="/img/a.jpg?w=600&amp;h=600&timestamp=1"></head>`, at);
assert.deepEqual(facts, { title: "Men's Heavyweight Hoodie", price: 2499, currency: 'GBP' });
facts = readPage('<meta name="twitter:title" content="Twitter Socks"><meta property="og:price:amount" content="£39.90"><meta name="twitter:image" content="https://cdn.shop.com/t.jpg">', at);
assert.deepEqual(facts, { title: 'Twitter Socks', price: 3990, currency: 'GBP' });
// a title only (the shop's name at either end goes, other separators stay)
assert.equal(readPage('<title>Cosy Socks – Shop Name UK</title>', at).title, 'Cosy Socks');
assert.equal(readPage('<title>Amazon.co.uk: Sony WH-1000XM5 Headphones</title>', 'https://www.amazon.co.uk/dp/B0TEST').title, 'Sony WH-1000XM5 Headphones');
assert.equal(readPage('<title>Hoodie - Black</title>', at).title, 'Hoodie - Black');
assert.equal(readPage('<title>Example Domain</title>', 'https://example.com/').title, 'Example Domain');
assert.equal(readPage('<title>Forbidden Planet Mug</title>', at).title, 'Forbidden Planet Mug');
assert.equal(readPage('<TITLE>\n  Tea &amp; Biscuits  \n</TITLE>', at).title, 'Tea & Biscuits');
// what isn't a name: bot walls, the shop's name alone, nothing at all
for (const t of ['Just a moment...', 'Attention Required! | Cloudflare', 'Access Denied', '404 Not Found', 'Robot Check', 'Shop Name'])
  assert.equal(readPage(`<meta property="og:site_name" content="Shop Name"><title>${t}</title>`, at).title, null, t);
assert.deepEqual(readPage('', at), { title: null, price: null, currency: null });
// broken JSON-LD is skipped; microdata is the last resort for a price
facts = readPage(`<script type="application/ld+json">{"@type":"Product", broken</script><meta property="og:title" content="Fallback Socks">
  <span itemprop="price" content="7.50"></span><meta itemprop="priceCurrency" content="GBP">`, at);
assert.deepEqual(facts, { title: 'Fallback Socks', price: 750, currency: 'GBP' });
// a "was" price doesn't count; the <base href> is used for relative pictures; data: pictures are ignored
facts = readPage(`<base href="https://img.shop.com/assets/"><script type="application/ld+json">{"@type":"Product","name":"Sale Socks","image":"data:image/png;base64,AAA",
  "offers":{"@type":"Offer","priceSpecification":[{"@type":"UnitPriceSpecification","priceType":"https://schema.org/ListPrice","price":20,"priceCurrency":"GBP"},
  {"@type":"UnitPriceSpecification","price":15,"priceCurrency":"GBP"}]}}</script><meta property="og:image" content="socks.jpg">`, at);
assert.deepEqual(facts, { title: 'Sale Socks', price: 1500, currency: 'GBP' });
// a <script> that isn't JSON-LD, comments and attributes holding "<" don't confuse the scanner
facts = readPage(`<!-- <title>Commented Out</title> --><script>var t = "<title>In A Script</title>";</script>
  <meta content="a > b" property="og:description"><title>Real Title</title>`, at);
assert.equal(facts.title, 'Real Title');
assert.equal(readPage(`<title>${'Long words go here '.repeat(20)}</title>`, at).title!.length <= 120, true);
// crafted pages that make tree-building parsers crawl are read in linear time
for (const [what, html] of [
  ['nested divs', `${'<div>'.repeat(200_000)}<meta property="og:title" content="Deep Socks">`],
  ['open comments', '<!--'.repeat(200_000)],
  ['unclosed tags', '<a<a<a<a '.repeat(200_000)],
  ['unclosed quotes', `<meta content="${'x '.repeat(500_000)}`],
  ['many attributes', `<meta ${'a=b '.repeat(300_000)}>`],
  ['many tags', '<meta property="x" content="y">'.repeat(50_000)],
  ['unclosed script', `<script type="application/ld+json">${'['.repeat(500_000)}`],
] as const) {
  const t = performance.now();
  const r = readPage(html, at);
  const ms = performance.now() - t;
  assert.ok(ms < 1500, `${what}: ${Math.round(ms)} ms`);
  if (what === 'nested divs') assert.equal(r.title, 'Deep Socks');
}
// guessing from the link
for (const [link, title] of [
  ['https://shop.com/products/heavyweight-hoodie-black', 'Heavyweight hoodie black'],
  ['https://www.amazon.co.uk/Sony-WH-1000XM5-Cancelling-Headphones/dp/B09XS7JWHH/ref=sr_1_1', 'Sony WH 1000XM5 Cancelling Headphones'],
  ['https://shop.com/en-gb/p/wool-socks-123456.html', 'Wool socks'],
  ['https://shop.com/item/12345678', null],
  ['https://shop.com/', null],
  ['https://shop.com/caf%C3%A9_mug', 'Café mug'],
  ['https://shop.com/c/kitchen/teapot', 'Teapot'],
] as const) assert.equal(slugTitle(link), title, link);
assert.equal(decodeHtml(Buffer.concat([Buffer.from('<meta charset="windows-1252"><title>'), Buffer.from([0x92]), Buffer.from('</title>')]), 'text/html'),
  '<meta charset="windows-1252"><title>’</title>', 'charset from <meta>');
assert.equal(decodeHtml(Buffer.from([0x3c, 0x74, 0x3e, 0x92, 0x3c]), 'text/html; charset=windows-1252'), '<t>’<');
assert.equal(decodeHtml(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<title>Mug</title>', 'utf16le')]), 'text/html; charset=utf-8'), '<title>Mug</title>', 'a byte-order mark wins');
console.log('metadata OK');

// ---------- prices ----------
for (const [input, hundredths] of [
  ['39.90', 3990], ['1,299.00', 129900], ['£39.90', 3990], [39.9, 3990], [39.95, 3995], [19.99, 1999], ['1.299,00 €', 129900], ['1 299,00', 129900],
  ['1,299', 129900], ['39,90', 3990], ['39.9', 3990], ['1299', 129900], ['  £ 12 ', 1200], ['EUR 5.00', 500], ['£10 - £20', 1000],
  ['0', null], ['0.00', null], ['-5', null], ['£-5', null], ['free', null], ['', null], [null, null], [Infinity, null], ['99999999', null],
] as const) assert.equal(parsePrice(input), hundredths, `parsePrice(${JSON.stringify(input)})`);
console.log('prices OK');


// ---------- the real internet ----------
const real = await unfurl('https://example.com/');
if (real.title === 'Example Domain') {
  assert.equal(real.shop, 'example.com');
  assert.equal(real.url, 'https://example.com/');
  console.log('real unfurl OK');
} else {
  const online = await lookup('example.com').then(() => fetch('https://example.com/', { signal: AbortSignal.timeout(8000) }).then(r => r.ok, () => false), () => false);
  assert.ok(!online, `example.com is reachable, but unfurl gave ${JSON.stringify(real)}`);
  console.log('real unfurl skipped (no network)');
}

shop.closeAllConnections();
shop.close();
console.log('All unfurl checks passed.');
process.exit(0);
