// Sending email (codes and account notices). Production uses Resend (RESEND_API_KEY, from GENIE_MAIL_FROM on a domain
// verified in Resend). The development server keeps mail in memory instead (read it at /api/dev/mail?to=).
import { DEV } from '../config.ts';

const KEY = process.env.RESEND_API_KEY ?? '';
const FROM = process.env.GENIE_MAIL_FROM || 'Genie <noreply@mail.daniyalzia.co.uk>';
export const MAIL_READY = DEV || !!KEY;

/** Development only: the last email sent to each address, for testing sign-up flows without a mailbox. */
export const devOutbox = new Map<string, { subject: string; text: string; at: number }>();

/** Resend answered, but didn't take the email. `status` is its HTTP status. */
export class MailRefused extends Error {
  constructor(readonly status: number) { super(`email not sent (${status})`); }
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
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
