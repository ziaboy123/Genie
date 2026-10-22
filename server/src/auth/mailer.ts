// Sending email (codes and account notices). Production uses Resend (RESEND_API_KEY, from GENIE_MAIL_FROM on a domain
// verified in Resend). The development server keeps mail in memory instead (read it at /api/dev/mail?to=).
import { DEV } from '../config.ts';
import { Problem } from '../http.ts';
import { limited } from '../ratelimit.ts';

const KEY = process.env.RESEND_API_KEY ?? '';
const FROM = process.env.GENIE_MAIL_FROM || 'Genie <noreply@mail.daniyalzia.co.uk>';
export const MAIL_READY = DEV || !!KEY;

// Resend's free plan sends 100 emails a day (3,000 a month). Genie sends at most 80 in any 24 hours
// (GENIE_MAIL_DAILY_CAP changes it), so a flood of sign-ups from lots of addresses can't use up the allowance, and people
// are told plainly instead of waiting for a code that never comes. Each email is taken from the allowance (takeMail)
// before the work that leads to it, so a full day is said straight away, and the same way whether or not an account
// exists. Only the times are kept, in memory, so a restart starts the count again (Resend's own limit still stands
// behind it). The development server allows far more, for the checks.
export const MAIL_DAILY_CAP = Number(process.env.GENIE_MAIL_DAILY_CAP) || (DEV ? 1000 : 80);
// One visitor (an IPv4 address, or an IPv6 /64: see clientIp) can cause at most 8 of them a day, across sign-ups,
// password resets, new-device codes and email changes. Without it, one address asking for resets for made-up emails
// could use up the whole day's allowance on its own and stop everyone signing up or logging in. It's taken first, so a
// visitor turned away takes nothing from everyone's allowance. The same on the development server (its checks come
// from separate made-up addresses).
export const MAIL_PER_VISITOR = 8;
const DAY_MS = 86400_000;
const takenAt: number[] = [];   // oldest first
let full = false;
export const MAIL_FULL = "Genie can't send any more emails today. Try again tomorrow.";
export const VISITOR_FULL = 'Genie has sent as many emails as it can for your internet connection today. Try again tomorrow.';

/** How many more emails can go out right now (out of the last 24 hours' allowance). */
export function mailLeft() {
  const now = Date.now();
  while (takenAt.length && now - takenAt[0] >= DAY_MS) takenAt.shift();
  return MAIL_DAILY_CAP - takenAt.length;
}
/** Takes one email from the day's allowance, or refuses (503, politely) once it's used up; the first refusal each time
 *  it fills is logged. `visitor` (clientIp) is who asked: their own 8 a day are checked before anything is taken from
 *  everyone's. `always`: taken even on a full day (see sendMail). */
export function takeMail({ visitor, always = false }: { visitor?: string; always?: boolean } = {}) {
  const left = mailLeft();
  if (left <= 0 && !always) {
    if (!full) console.error(`email: all ${MAIL_DAILY_CAP} of the day's emails are used, so codes are refused until the oldest is a day old`);
    full = true;
    throw new Problem(MAIL_FULL, 503);   // only looked at, not taken: so a full day doesn't use up visitors' own allowances too
  }
  if (left > 0) full = false;
  if (visitor && limited(`mail:${visitor}`, MAIL_PER_VISITOR, DAY_MS)) throw new Problem(VISITOR_FULL, 429);
  takenAt.push(Date.now());
}

/** Development only: the last email sent to each address, for testing sign-up flows without a mailbox. */
export const devOutbox = new Map<string, { subject: string; text: string; at: number }>();

/** Resend answered, but didn't take the email. `status` is its HTTP status. */
export class MailRefused extends Error {
  constructor(readonly status: number) { super(`email not sent (${status})`); }
}

/** Sends one email, taking it from the day's allowance first unless the caller already has (`taken`). `always`: sent
 *  even on a full day (still counted), only for the notice that an account's email was changed, which is how someone
 *  would find out it was taken (and only a logged-in owner, a few times an hour, can cause one). */
export async function sendMail(to: string, subject: string, text: string, { taken = false, always = false } = {}): Promise<void> {
  if (!taken) takeMail({ always });
  if (KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new MailRefused(res.status);
    return;
  }
  if (!DEV) throw new Error('email is not set up on this server');
  devOutbox.set(to, { subject, text, at: Date.now() });
  // only the development server gets here (its database is genie_dev, never real accounts), so printing the code is fine
  console.log(`[dev mail] to ${to}: ${subject}`);
}

export const FOOTER = '\n\nGenie';
export const codeMail = (code: string, what: string) => ({
  subject: `${code} is your Genie code`,
  text: `Your code to ${what} is ${code}. It works for 10 minutes and only once.\n\nIf you didn't ask for this, you can ignore this email.${FOOTER}`,
});
