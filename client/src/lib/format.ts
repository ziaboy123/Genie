// Prices, dates and countdowns, the way people in the UK expect to read them. Everything is worked out in the browser.
import { LIMITS } from '@genie/shared';

const money = new Map<string, Intl.NumberFormat>();
function moneyFormat(currency: string): Intl.NumberFormat {
  let f = money.get(currency);
  if (!f) {
    // an odd code from a shop's page falls back to pounds rather than breaking the page
    try { f = new Intl.NumberFormat('en-GB', { style: 'currency', currency }); } catch { f = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }); }
    money.set(currency, f);
  }
  return f;
}
/** Prices are always kept in hundredths of the currency (pence for pounds, and ¥1500 is 150000), whatever its usual decimals. */
const digits = (currency: string) => moneyFormat(currency).resolvedOptions().maximumFractionDigits ?? 2;

/** "£39.90" from 3990, or null when the price isn't known. */
export function formatPrice(minor: number | null, currency: string): string | null {
  if (minor === null || !Number.isFinite(minor)) return null;
  return moneyFormat(currency).format(minor / 100);
}

/** "£" for GBP, "$" for USD…, for the price field's label. */
export function currencySymbol(currency: string): string {
  return moneyFormat(currency).formatToParts(0).find(p => p.type === 'currency')?.value ?? currency;
}

/** The price as you'd type it into the edit form: "39.90", "1299.00", or empty. */
export function priceText(minor: number | null, currency: string): string {
  if (minor === null) return '';
  return (minor / 100).toFixed(digits(currency));
}

/** What someone typed in the price field, in minor units. Null when empty; undefined when it isn't a price. */
export function parsePrice(text: string, currency: string): number | null | undefined {
  let t = text.replace(/[^\d.,]/g, '');   // "£1,299.00 " → "1,299.00"
  if (!t) return text.trim() ? undefined : null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');   // thousands commas
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');           // "39,90"
  const d = digits(currency);
  if (!(d ? new RegExp(`^\\d+(\\.\\d{0,${d}})?$`) : /^\d+$/).test(t)) return undefined;
  const minor = Math.round(Number(t) * 100);
  return minor <= LIMITS.maxPrice ? minor : undefined;
}

/** "lego.com · £399.99", or whichever half is known; `noPrice` stands in when the shop didn't give one. */
export function wishMeta(shop: string | null, price: number | null, currency: string, noPrice?: string): string {
  return [shop, formatPrice(price, currency) ?? noPrice].filter(Boolean).join(' · ');
}

// ---------- dates ----------
// Event dates are plain YYYY-MM-DD days: they're read as days on the calendar, never as a moment in some time zone.
const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number];
const dayNumber = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400_000);
const todayNumber = () => { const t = new Date(); return dayNumber(t.getFullYear(), t.getMonth() + 1, t.getDate()); };

/** "Sun 1 Nov", with the year when it isn't this year ("Fri 25 Dec 2027"). */
export function formatDay(iso: string): string {
  const [y, m, d] = ymd(iso);
  if (!y || !m || !d) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(new Date(y, m - 1, d));
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  // put together by hand: with a year, en-GB would say "Thu, 30 Sept 2027"
  return [part('weekday'), part('day'), part('month'), y !== new Date().getFullYear() ? part('year') : ''].filter(Boolean).join(' ');
}

/** How many days from today until the date (0 = today, negative = it's been). */
export function daysUntil(iso: string): number {
  const [y, m, d] = ymd(iso);
  return dayNumber(y, m, d) - todayNumber();
}

/** "12 days to go", "Tomorrow", "Today!", or "Done" once it's been. */
export function countdown(iso: string): string {
  const n = daysUntil(iso);
  return n > 1 ? `${n} days to go` : n === 1 ? 'Tomorrow' : n === 0 ? 'Today!' : 'Done';
}

/** Today (plus some days or years) as YYYY-MM-DD, for date pickers' limits. */
export function isoDay(addDays = 0, addYears = 0): string {
  const t = new Date();
  const d = new Date(t.getFullYear() + addYears, t.getMonth(), t.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Is this a real day, from yesterday to two years ahead (what the server accepts)? */
export function okEventDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = ymd(iso), date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return false;
  return iso >= isoDay(-1) && iso <= isoDay(0, 2);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

