// Turning a pasted link into a wish: a tidy link, the shop, and whatever name and price the page offers.
// Shops often block this kind of fetch (Amazon especially), so a failed fetch is normal: the wish still gets the shop
// and a name guessed from the link, and the owner fixes the rest. Only links Genie won't open at all are an error.
import { domainToASCII } from 'node:url';
import { LIMITS } from '@genie/shared';
import { Problem } from '../http.ts';
import { decodeHtml, readPage, slugTitle } from './metadata.ts';
import { Blocked, FetchFailed, safeFetch, vetUrl, type Fetched, type Vet } from './safefetch.ts';

export interface Unfurled {
  /** The cleaned link after any redirects (a short link becomes the shop's own). */
  url: string;
  title: string | null;
  /** The host without "www.", kept in its ASCII form so a look-alike domain can't pass for a real shop. */
  shop: string;
  /** Hundredths of the currency (pence), or null. */
  price: number | null;
  /** ISO 4217, upper case; null when there's no price. */
  currency: string | null;
}

const PASTE = 'Paste a link that starts with http:// or https://.';
const BLOCKED = "Genie can't open that link.";

// Tracking added to links by ads, newsletters and share buttons. It says nothing about the product, and it would
// tell the shop where every visitor came from.
const TRACKING = new Set(['fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'mc_cid', 'mc_eid', '_ga', '_gl', '_hsenc', '_hsmi', '__hstc', '__hssc', '__hsfp', 'mkt_tok', 'igshid', 'igsh', 'si', 'spm', 'scm',
  'ref_', 'ref_src', 'srsltid', 'epik', 'rcm', '_branch_match_id', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'wickedid', 'rb_clickid',
  's_cid', 'irclickid', 'irgwc', 'awc', 'cjevent', 'cjdata']);
const TRACKING_PREFIX = /^(utm_|pd_rd_|pf_rd_|hsa_|mtm_|pk_|matomo_)/;
// Amazon's search and affiliate leftovers (keeps the ones that pick a size or colour, like psc and th)
const AMAZON_TRACKING = new Set(['qid', 'sr', 'crid', 'sprefix', 'dib', 'dib_tag', 'keywords', 'tag', 'linkcode', 'linkid', 'ascsubtag',
  'camp', 'creative', 'creativeasin', 'content-id', '_encoding', 'ref']);

function isTracking(key: string, amazon: boolean) {
  return TRACKING.has(key) || TRACKING_PREFIX.test(key) || (amazon && AMAZON_TRACKING.has(key));
}

/**
 * A pasted link made safe to store and share: trimmed, http(s) only, no login in it, no tracking parameters and no
 * #fragment. The rest of the query keeps its exact spelling (re-encoding it can break a shop's link).
 */
export function cleanUrl(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Problem(PASTE);
  if (text.length > LIMITS.url) throw new Problem('That link is too long.');
  let url: URL;
  try { url = new URL(text); } catch { throw new Problem(PASTE); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Problem(PASTE);
  if (url.username || url.password) throw new Problem('Take the username and password out of that link first.');
  const amazon = /(^|\.)amazon\.[a-z.]+$/.test(url.hostname);
  const kept = url.search.slice(1).split('&').filter(pair => {
    if (!pair) return false;
    let key = pair.split('=')[0];
    try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch { /* an odd key is kept as it is */ }
    return !isTracking(key.toLowerCase(), amazon);
  });
  url.search = kept.length ? `?${kept.join('&')}` : '';
  url.hash = '';
  // percent-encoding can make the parsed link longer than what was pasted
  if (url.href.length > LIMITS.url) throw new Problem('That link is too long.');
  return url.href;
}

const shopOf = (link: string) => new URL(link).hostname.replace(/\.+$/, '').replace(/^www\./, '');

// Sites whose owners asked GenieBot not to visit (the terms say they can, by email). Set on the server as
// GENIE_NO_FETCH="shop.example,other.example"; a domain covers its subdomains. Their links can still be added: the
// wish is named from the link, nothing is fetched, and a redirect into one of them stops there.
// Each entry is turned into the ASCII form links' hostnames always use, so "bücher.example" as written matches
// xn--bcher-kva.example; one that isn't a domain at all is dropped.
const NO_FETCH = (process.env.GENIE_NO_FETCH ?? '').split(',')
  .map(d => domainToASCII(d.trim().replace(/^\.+|\.+$/g, '')).replace(/^www\./, '')).filter(Boolean);
/** Has this host's site asked GenieBot to stay away? */
export function optedOut(host: string, list: readonly string[] = NO_FETCH): boolean {
  const h = host.toLowerCase().replace(/\.+$/, '');
  return list.some(d => h === d || h.endsWith(`.${d}`));
}
/** cleanUrl, or `fallback` if the link (say, where a redirect went) doesn't pass. */
function cleanOr(link: string | undefined, fallback: string) {
  try { return link ? cleanUrl(link) : fallback; } catch { return fallback; }
}

/**
 * Fetches a pasted link's page and reads the wish from it. Never fails because of the shop (timeouts, errors, bot
 * walls, not a web page): it returns at least the shop and a name guessed from the link. Throws a Problem only for a
 * link that isn't one, or that points somewhere Genie never goes. `vet` is only ever swapped by check-unfurl.ts.
 */
export async function unfurl(raw: unknown, vet: Vet = vetUrl): Promise<Unfurled> {
  const pasted = cleanUrl(raw);
  const bare = (link: string): Unfurled => ({ url: link, title: slugTitle(link) ?? slugTitle(pasted), shop: shopOf(link), price: null, currency: null });
  if (optedOut(new URL(pasted).hostname)) return bare(pasted);
  // every hop of a redirect is checked against the list too
  const vetting: Vet = (url, by) => {
    if (optedOut(url.hostname)) throw new FetchFailed('site asked not to be fetched');
    return vet(url, by);
  };
  let page: Fetched;
  try {
    page = await safeFetch(pasted, {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', maxBytes: 2 * 1024 * 1024, partial: true,
      types: ['text/html', 'application/xhtml+xml'],
    }, vetting);
  } catch (e) {
    if (e instanceof Blocked) throw new Problem(BLOCKED);
    // still worth using where it got to: a short link that reached the shop's own link has a better name in it
    return bare(cleanOr(e instanceof FetchFailed ? e.url : undefined, pasted));
  }
  const url = cleanOr(page.url, pasted);
  try {
    const facts = readPage(decodeHtml(page.body, page.contentType), page.url);
    return { url, title: facts.title ?? slugTitle(url) ?? slugTitle(pasted), shop: shopOf(url), price: facts.price, currency: facts.price === null ? null : facts.currency };
  } catch (e: any) {
    console.error(`unfurl: reading a page failed: ${e?.stack ?? e}`);   // a bug of ours, not the shop's: worth knowing, never the link
    return bare(url);
  }
}
