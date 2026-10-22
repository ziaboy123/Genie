// Reading a shop's page for the wish's name and price. Shops embed product data for Google (JSON-LD) and
// preview tags for link previews (Open Graph, Twitter); the page's <title> is the last resort, then the link itself.
//
// A page is a stranger's input, so it's read with a small scanner that walks the text once, front to back, and only
// looks at the few tags that matter. A full HTML parser builds a tree, and a crafted page can make that take minutes:
// node-html-parser needs 26 s for 8,000 nested <div>s (40 KB), and the whole server would stall meanwhile.
// node-html-parser still decodes the entities.
import { LIMITS } from '@genie/shared';
import { TextNode } from 'node-html-parser';

export interface PageFacts {
  title: string | null;
  /** Hundredths of the currency (pence, cents), or null. */
  price: number | null;
  currency: string | null;
}

// ---------- the scanner ----------
// elements whose contents are text, not tags (a "<" inside a script is just a character)
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
const closers = new Map<string, RegExp>();
const isSpace = (c: number) => c === 32 || (c >= 9 && c <= 13);

/** The attributes of a tag (from `i`, just after its name) and where the tag ends. An unterminated one runs to the end, as in browsers. */
function readAttrs(html: string, i: number, keep: boolean): [Map<string, string>, number] {
  const attrs = new Map<string, string>(), n = html.length;
  while (i < n) {
    while (i < n && (isSpace(html.charCodeAt(i)) || html[i] === '/')) i++;
    if (i >= n) break;
    if (html[i] === '>') return [attrs, i + 1];
    const start = i++;
    while (i < n && !isSpace(html.charCodeAt(i)) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
    const key = keep ? html.slice(start, i).toLowerCase() : '';
    while (i < n && isSpace(html.charCodeAt(i))) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < n && isSpace(html.charCodeAt(i))) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return [attrs, n];
        if (keep) value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const from = i;
        while (i < n && !isSpace(html.charCodeAt(i)) && html[i] !== '>') i++;
        if (keep) value = html.slice(from, i);
      }
    }
    if (keep && !attrs.has(key)) attrs.set(key, value);
  }
  return [attrs, n];
}

/**
 * Calls `visit` for each start tag named in `wanted` (and any tag carrying microdata), in order, with its attributes
 * and, for raw-text elements like <title> and <script>, their contents. Every step moves forward, so it's linear.
 */
function eachTag(html: string, wanted: Set<string>, visit: (name: string, attrs: Map<string, string>, text: string | null) => void) {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) return;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const next = html[lt + 1];
    if (next === '!' || next === '?' || next === '/') {   // doctype, processing instruction, closing tag
      const end = html.indexOf('>', lt + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    TAG_NAME.lastIndex = lt + 1;
    const m = TAG_NAME.exec(html);
    if (!m) { i = lt + 1; continue; }
    const name = m[0].toLowerCase(), from = TAG_NAME.lastIndex;
    let [attrs, end] = readAttrs(html, from, wanted.has(name));
    // <span itemprop="price" content="39.90">: read again, keeping the attributes (each tag is read at most twice)
    const microdata = !wanted.has(name) && html.slice(from, end).includes('itemprop');
    if (microdata) [attrs] = readAttrs(html, from, true);
    i = end;
    let text: string | null = null;
    if (RAW_TEXT.has(name)) {
      let closer = closers.get(name);
      if (!closer) closers.set(name, closer = new RegExp(`</${name}[\\s/>]`, 'gi'));
      closer.lastIndex = end;
      const close = closer.exec(html);
      i = close ? close.index : html.length;
      if (wanted.has(name)) text = html.slice(end, i);
    }
    if (wanted.has(name) || microdata) visit(name, attrs, text);
  }
}

// ---------- text ----------
const ENTITY = /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi;
/** Complete entities only ("&amp;", "&#39;"), the way attribute values are read: a bare "&" in a link ("?a=1&times=2") stays put. */
const decodeEntities = (s: string) => s.replace(ENTITY, e => new TextNode(e).text);
/** Text between tags (a <title>), decoded the way browsers do. */
const decodeText = (s: string) => new TextNode(s).text;

/** Plain one-line text: entities decoded (twice-encoded ones too), tags and invisible characters gone, spaces collapsed. */
function tidy(s: string | null | undefined): string {
  if (!s) return '';
  return decodeEntities(decodeEntities(s.slice(0, 1000)))   // cut first: everything after works on a short string
    .replace(/<\/?[a-z][^<>]*>/gi, ' ')
    .replace(/[\u0000-\u001f\u007f​-‍⁠﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** At most `max` characters, cut at a space when there's one near the end. */
function cap(s: string, max: number = LIMITS.title): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max);
  return (cut > max * 0.7 ? s.slice(0, cut) : s.slice(0, max)).replace(/[\s,;:|·–—-]+$/, '');
}

// ---------- the shop's own name, to take out of titles ----------
const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
// second-level parts of country domains, so shop.co.uk's name is "shop"
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'ltd', 'plc', 'me', 'ne', 'or', 'gen']);

function siteNames(meta: Map<string, string>, pageUrl: string): string[] {
  const names = [meta.get('og:site_name'), meta.get('application-name'), meta.get('apple-mobile-web-app-title'), meta.get('twitter:site')?.replace(/^@/, '')];
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    const labels = host.split('.');
    names.push(host, labels.length > 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[labels.length - 2]);
  } catch { /* no host to go on */ }
  return [...new Set(names.map(n => squash(tidy(n))).filter(n => n.length >= 2))];
}
/** Is this part of a title the shop's name? Loosely ("John Lewis & Partners" for johnlewis.com) unless `exact`. */
function isSite(part: string, names: string[], exact = false): boolean {
  const p = squash(part);
  if (!p || part.length > 60) return false;
  return names.some(n => p === n || (!exact && Math.min(p.length, n.length) >= 4 && (p.startsWith(n) || n.startsWith(p))
    && Math.min(p.length, n.length) / Math.max(p.length, n.length) >= 0.5));
}
const SEPARATOR = /\s+[|\-–—·•»~]\s+|\s*\|\s*|\s*::\s*|:\s+/g;
/** "Heavyweight Hoodie | Shop Name" → "Heavyweight Hoodie" (and "Amazon.co.uk: Thing" → "Thing"), only when that part is the shop. */
function dropSiteName(title: string, names: string[]): string {
  const cuts = [...title.matchAll(SEPARATOR)];
  if (!cuts.length) return title;
  const last = cuts[cuts.length - 1], first = cuts[0];
  if (isSite(title.slice(last.index + last[0].length), names)) {
    const rest = title.slice(0, last.index).trim();
    if (rest) return rest;
  }
  if (isSite(title.slice(0, first.index), names)) {
    const rest = title.slice(first.index + first[0].length).trim();
    if (rest) return rest;
  }
  return title;
}
// What a shop shows a bot instead of the product. The phrase must be the whole title (or end at a separator,
// "Attention Required! | Cloudflare"), so "Forbidden Planet" or "Not Found: a novel" are still names.
const BOT_WALL = /^(just a moment|attention required|access denied|access to this page has been denied|robot check|bot verification|human verification|are you a (human|robot)|security check|pardon our interruption|verify(ing)? (that )?(you are|you're) (a )?human|one more step|please wait|captcha|request (rejected|blocked)|too many requests|service unavailable|forbidden|(error )?(400|401|403|404|410|429|500|502|503)( forbidden| not found| error)?|(page )?not found)[\s.!?…]*($|[|:–—-])/i;

function cleanTitle(raw: string | null | undefined, names: string[]): string | null {
  const t = tidy(raw);
  // a title that's only the shop's name ("Amazon.co.uk" on a robot check) says nothing about the wish
  if (!t || BOT_WALL.test(t) || isSite(t, names, true)) return null;
  return cap(dropSiteName(t, names)) || null;
}

// ---------- prices ----------
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
/** "gbp" → "GBP", if it's a real ISO 4217 code. */
function currencyCode(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return CURRENCIES.has(s) ? s : null;
}
// a currency written into the price itself ("£39.90", "US$25", "39.90 EUR"); a bare $ is taken as US dollars
const SYMBOLS: [RegExp, string][] = [
  [/US\$/i, 'USD'], [/CA?\$/, 'CAD'], [/AU?\$/, 'AUD'], [/NZ\$/i, 'NZD'], [/HK\$/i, 'HKD'], [/S\$/, 'SGD'],
  [/£/, 'GBP'], [/€/, 'EUR'], [/[¥￥]/, 'JPY'], [/₹/, 'INR'], [/₩/, 'KRW'], [/zł/i, 'PLN'], [/\$/, 'USD'],
];
function currencyIn(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.slice(0, 100);
  for (const code of s.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []) if (CURRENCIES.has(code)) return code;
  return SYMBOLS.find(([re]) => re.test(s))?.[1] ?? null;
}

/**
 * A price in hundredths of the currency: "39.90" → 3990, "1,299.00" → 129900, "£39.90" → 3990, "1.299,00 €" → 129900,
 * 39.9 → 3990. Null for anything that isn't a sensible price (0 is usually a placeholder, so it's null too).
 */
export function parsePrice(v: unknown): number | null {
  let hundredths: number;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    hundredths = Math.round(v * 100);
  } else if (typeof v === 'string') {
    const s = v.slice(0, 100).replace(/[\s  ']/g, '');   // spaces and apostrophes group thousands too (1 299,00; 1'299.00)
    const m = /\d[\d.,]*/.exec(s);
    if (!m || s.slice(0, m.index).includes('-')) return null;
    const n = m[0].replace(/[.,]+$/, '');
    const dot = n.lastIndexOf('.'), comma = n.lastIndexOf(',');
    let whole: string, frac = '';
    if (dot >= 0 && comma >= 0) {
      // both: the last one is the decimal point, the other groups thousands
      const point = Math.max(dot, comma);
      whole = n.slice(0, point).replace(/[.,]/g, '');
      frac = n.slice(point + 1);
    } else if (comma >= 0) {
      // only commas: "1,299" and "1,299,000" group thousands, "39,90" is a decimal comma
      const groups = n.split(',');
      if (groups.length === 2 && groups[1].length !== 3) [whole, frac] = groups;
      else whole = groups.join('');
    } else if (dot >= 0) {
      // only dots: one is a decimal point (machine-readable prices use it), several group thousands (1.299.000)
      const groups = n.split('.');
      if (groups.length === 2) [whole, frac] = groups;
      else whole = groups.join('');
    } else whole = n;
    hundredths = Math.round(Number(`${whole || '0'}.${frac || '0'}`) * 100);
  } else return null;
  return Number.isSafeInteger(hundredths) && hundredths > 0 && hundredths <= LIMITS.maxPrice ? hundredths : null;
}

// ---------- JSON-LD ----------
type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const asList = (v: unknown): unknown[] => Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
const PRODUCT_TYPES = new Set(['product', 'productgroup', 'productmodel', 'individualproduct', 'someproducts', 'vehicle', 'car']);
const typesOf = (o: Json) => asList(o['@type']).filter((t): t is string => typeof t === 'string').map(t => t.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase());

// no real product block is anywhere near this big; a bigger one is skipped rather than parsed
const MAX_JSON = 512 * 1024;
function parseJson(text: string): unknown {
  if (text.length > MAX_JSON) return null;
  // unwrap <!-- --> and //<![CDATA[ ... //]]> with string methods: an unanchored regex here backtracked
  // quadratically over long runs of spaces, and one crafted page froze the whole server for minutes
  let body = text.trim();
  if (body.startsWith('<!--')) body = body.slice(4);
  if (body.endsWith('-->')) body = body.slice(0, -3);
  body = body.trim().replace(/^(?:\/\/)?\s*<!\[CDATA\[/, '');
  if (body.endsWith(']]>')) { body = body.slice(0, -3).trimEnd(); if (body.endsWith('//')) body = body.slice(0, -2); }
  try { return JSON.parse(body); }
  catch {
    // raw line breaks and tabs inside strings are a common slip; as JSON whitespace they're harmless to replace
    try { return JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ')); } catch { return null; }
  }
}

/** Every Product-like object in the blocks, outer ones first (a ProductGroup before its variants). */
function findProducts(blocks: unknown[]): Json[] {
  const found: Json[] = [];
  let seen = 0;
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || ++seen > 5000 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const o = v as Json;
    if (typesOf(o).some(t => PRODUCT_TYPES.has(t))) found.push(o);
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const b of blocks) walk(b, 0);
  return found;
}

function textOf(v: unknown, depth = 0): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (depth > 3) return null;
  if (Array.isArray(v)) return textOf(v[0], depth + 1);
  if (isObject(v)) return textOf(v['@value'] ?? v.name, depth + 1);
  return null;
}
type Price = { price: number; currency: string | null };
// a crossed-out "was" price isn't what it costs now
const OLD_PRICE = /listprice|strikethroughprice|msrp|srp/i;
/** The first usable price in an offers value (Offer, AggregateOffer with lowPrice, nested offers, priceSpecification). */
function offerPrice(offers: unknown, depth = 0): Price | null {
  if (depth > 3) return null;
  for (const o of asList(offers).slice(0, 50)) {
    if (!isObject(o)) continue;
    const specs = asList(o.priceSpecification).filter(isObject).filter(s => !OLD_PRICE.test(String(s.priceType ?? '')));
    const pairs: unknown[][] = [[o.price, o.priceCurrency], [o.lowPrice, o.priceCurrency], ...specs.map(s => [s.price, s.priceCurrency ?? o.priceCurrency])];
    for (const [amount, currency] of pairs) {
      const price = parsePrice(amount);
      if (price !== null) return { price, currency: currencyCode(currency) ?? currencyIn(amount) };
    }
    const inner = offerPrice(o.offers, depth + 1);
    if (inner) return { price: inner.price, currency: inner.currency ?? currencyCode(o.priceCurrency) };
  }
  return null;
}

// ---------- the page ----------
const WANTED = new Set(['meta', 'title', 'script']);

/** The name and price a page offers, each from the first source that has it. */
export function readPage(html: string, pageUrl: string): PageFacts {
  const meta = new Map<string, string>();   // og:title → value, decoded like an attribute
  const scripts: string[] = [];
  const seen: { title?: string; itemPrice?: string; itemCurrency?: string } = {};
  eachTag(html, WANTED, (name, attrs, text) => {
    const attr = (key: string) => { const v = attrs.get(key); return v === undefined ? undefined : decodeEntities(v).trim(); };
    if (name === 'meta') {
      const key = (attr('property') || attr('name') || attr('itemprop') || '').toLowerCase(), content = attr('content');
      if (key && content && !meta.has(key)) meta.set(key, content);
    } else if (name === 'title') seen.title ??= decodeText(text ?? '');
    else if (name === 'script') {
      if (/^application\/ld\+json\b/i.test(attr('type') ?? '') && text && scripts.length < 20) scripts.push(text);
    }
    // microdata, on any element: <span itemprop="price" content="39.90">
    const prop = attr('itemprop')?.toLowerCase();
    if (prop === 'price') seen.itemPrice ??= attr('content');
    else if (prop === 'pricecurrency') seen.itemCurrency ??= attr('content');
  });

  const products = findProducts(scripts.map(parseJson));
  const product = products.find(p => tidy(textOf(p.name))) ?? products[0];
  const names = siteNames(meta, pageUrl);

  const title = [textOf(product?.name), meta.get('og:title'), meta.get('twitter:title'), seen.title]
    .map(t => cleanTitle(t, names)).find(t => t) ?? null;

  // the product's own offers, then its variants' (a ProductGroup), then the price tags, then microdata
  let price: Price | null = product ? offerPrice(product.offers) : null;
  for (const variant of asList(product?.hasVariant).slice(0, 20)) if (!price && isObject(variant)) price = offerPrice(variant.offers);
  for (const [amount, currency] of [
    [meta.get('product:price:amount'), meta.get('product:price:currency')], [meta.get('og:price:amount'), meta.get('og:price:currency')],
    [seen.itemPrice, seen.itemCurrency],
  ]) {
    if (price) break;
    const p = parsePrice(amount);
    if (p !== null) price = { price: p, currency: currencyCode(currency) ?? currencyIn(amount) };
  }

  return { title, price: price?.price ?? null, currency: price?.currency ?? null };
}

// ---------- the link's own words ----------
// path parts that are never the product's name
const NOT_NAMES = new Set(['p', 'dp', 'gp', 'pd', 'prd', 'product', 'products', 'item', 'items', 'itm', 'ip', 'shop', 'buy', 'detail', 'details',
  'en', 'en-gb', 'en_gb', 'gb', 'uk', 'us', 'index', 'collections', 'collection', 'catalog', 'catalogue', 'store', 'listing', 'sku', 'c', 'w', 's']);
// codes rather than words: long digit runs, product ids like B09XS7JWHH, hashes
const looksLikeId = (w: string) => /^\d{5,}$/.test(w) || (w.length >= 8 && /\d/.test(w) && /^[a-z0-9]+$/i.test(w)) || /^[a-f0-9]{12,}$/i.test(w);

/** A name guessed from the link: ".../heavyweight-hoodie-black" → "Heavyweight hoodie black". Null when the link has none. */
export function slugTitle(link: string): string | null {
  let path: string;
  try { path = new URL(link).pathname; } catch { return null; }
  const segments = path.split('/').map(s => {
    try { s = decodeURIComponent(s); } catch { /* keep it as it is */ }
    return s.replace(/\.(html?|aspx?|php|jsp|cfm)$/i, '').trim();
  }).filter(s => s && !/[=;]/.test(s));   // "ref=sr_1_1" and ";jsessionid=…" are tracking, not names
  const wordsOf = (s: string) => NOT_NAMES.has(s.toLowerCase()) ? [] : s.split(/[-_+\s]+/).filter(w => w && !looksLikeId(w));
  // the last part with several words wins (that's the name, not a category); a single word is the fallback
  let best: string[] | null = null;
  for (let i = segments.length - 1; i >= 0 && !best; i--) {
    const words = wordsOf(segments[i]);
    if (words.length >= 2 && words.some(w => /\p{L}{2}/u.test(w))) best = words;
  }
  for (let i = segments.length - 1; i >= 0 && !best; i--) {
    const words = wordsOf(segments[i]);
    if (words.length === 1 && /\p{L}{3}/u.test(words[0])) best = words;
  }
  const text = best ? tidy(best.join(' ')) : '';
  // "heavyweight hoodie" reads better in sentence case; brands and model numbers keep their own capitals
  return text ? cap(text.charAt(0).toUpperCase() + text.slice(1)) : null;
}

// ---------- bytes to text ----------
/** The page's text, in the character set its byte-order mark, headers or <meta charset> name (UTF-8 otherwise), as browsers pick it. */
export function decodeHtml(body: Buffer, contentType: string): string {
  const bom = body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? 'utf-8'
    : body[0] === 0xff && body[1] === 0xfe ? 'utf-16le' : body[0] === 0xfe && body[1] === 0xff ? 'utf-16be' : undefined;
  const fromHeader = bom ?? /charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(contentType)?.[1];
  const head = fromHeader ? '' : body.subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]{0,200}?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
  try { return new TextDecoder(fromHeader ?? fromMeta ?? 'utf-8').decode(body); }
  catch { return new TextDecoder('utf-8').decode(body); }   // a charset nobody knows
}
