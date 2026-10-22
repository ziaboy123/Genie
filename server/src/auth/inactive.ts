// Accounts nobody has used for two years are deleted, as the privacy page and terms promise:
//   - at 23 months unused, the owner gets one warning email (warned_at records it, so it's sent once);
//   - an account is deleted once it's 24 months unused AND its warning went out at least 30 days ago, so nobody is
//     deleted without a warning and a month to act on it;
//   - logging in, or just using Genie while logged in, clears the warning (accounts.ts);
//   - an account with a list whose day is coming up, or was in the last 30 days, is neither warned nor deleted, so a
//     list never vanishes just as family are opening it (the privacy page says so).
// An address Resend refuses outright (a 4xx for that one email, such as a malformed address; one that simply doesn't
// exist is accepted and bounces later, so it's marked warned the normal way) counts as warned, so a
// few dead addresses at the front of the queue can't hold up everyone behind them. That's only recorded once another
// warning in the same run has gone out: a bad key or sending domain gives a 4xx too, and must never count as a warning.
// Deleting an account takes its lists, wishes, grants, logins and trusted devices with it (the database cascades).
// Runs once a day, a few minutes after start-up. Small batches, so a backlog is worked through over several days.
// Warnings leave the last 30 of the day's emails (mailer.ts allows 80) for codes, so a backlog of warnings can't stop
// anyone signing up or logging in; the rest wait for tomorrow's run.
import { q } from '../db/index.ts';
import { FOOTER, MAIL_DAILY_CAP, MAIL_READY, MailRefused, mailLeft, sendMail } from './mailer.ts';

const WARN_BATCH = 50, DELETE_BATCH = 100;
const KEEP_FOR_CODES = Math.min(30, Math.floor(MAIL_DAILY_CAP / 2));   // so a lower allowance still leaves room for warnings
const MAIL_GAP_MS = 600;            // Resend accepts a couple of emails a second
const MAX_MAIL_FAILURES = 3;        // in a row: email is down, so try the rest tomorrow
const DAY_MS = 86400_000;

/** SQL: the account `u` has no list whose day is coming up or was in the last 30 days. */
const noRecentList = (u: string) => `not exists (select 1 from genie.lists l where l.user_id = ${u}.id and l.event_date >= current_date - 30)`;

/** Resend refused this one email (say, an address that can't exist), so sending it again won't help. Not a bad key or
 *  sending domain (401, 403) and not "slow down" (429): those are about email as a whole, so the run stops instead. */
const isRefused = (e: unknown) => e instanceof MailRefused && e.status >= 400 && e.status < 500 && ![401, 403, 429].includes(e.status);

const longDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });

/** The warning email. `deleteFrom` is the earliest the account can go. */
export function warningMail(name: string, deleteFrom: Date) {
  const day = longDay.format(deleteFrom);
  return {
    subject: 'Your Genie account will be deleted soon',
    text: `Hi ${name},\n\nYou haven't used your Genie account for nearly two years, so it's due to be deleted.\n\n`
      + `To keep it, just log in at daniyalzia.co.uk/genie before ${day}.\n\n`
      + `If you don't need it any more, you don't have to do anything. The account and all its lists will be deleted soon after ${day}.${FOOTER}`,
  };
}

let running = false;

/** One pass: deletes up to 100 warned accounts and warns up to 50 more. Never throws; returns what it did. */
export async function inactiveSweep(): Promise<{ deleted: number; warned: number; refused: number }> {
  if (running) return { deleted: 0, warned: 0, refused: 0 };
  running = true;
  let deleted = 0, warned = 0, counted = 0;
  try {
    // the conditions are repeated outside the subquery so a login at the same moment saves the account
    // (Postgres re-checks them against the row as it is when it deletes)
    const gone = await q(`delete from genie.users u where u.id in (
        select x.id from genie.users x
        where x.last_seen_at < now() - interval '24 months' and x.warned_at < now() - interval '30 days' and ${noRecentList('x')}
        order by x.last_seen_at limit $1)
      and u.last_seen_at < now() - interval '24 months' and u.warned_at < now() - interval '30 days' and ${noRecentList('u')}
      returning u.id`, [DELETE_BATCH]);
    deleted = gone.length;

    if (!MAIL_READY) return { deleted, warned, refused: 0 };   // never warned means never deleted, so nothing is lost by waiting
    const due = await q<{ id: string; email: string; name: string; delete_from: Date }>(`select u.id, u.email, u.name,
        greatest(u.last_seen_at + interval '24 months', now() + interval '30 days') as delete_from
      from genie.users u where u.warned_at is null and u.last_seen_at < now() - interval '23 months' and ${noRecentList('u')}
      order by u.last_seen_at limit $1`, [WARN_BATCH]);
    // recorded only after it's sent (or refused for good); skipped if they logged in meanwhile
    const markWarned = (id: string) =>
      q(`update genie.users set warned_at = now() where id = $1 and warned_at is null and last_seen_at < now() - interval '23 months'`, [id]);
    const dead: string[] = [];   // accounts whose warning Resend refused
    let failures = 0, sentOne = false;
    for (const [i, u] of due.entries()) {
      if (i) await new Promise(r => setTimeout(r, MAIL_GAP_MS));
      if (mailLeft() <= KEEP_FOR_CODES) {
        console.log(`inactive accounts: leaving today's last ${KEEP_FOR_CODES} emails for codes; ${due.length - i} warning(s) wait for tomorrow`);
        break;
      }
      try {
        const mail = warningMail(u.name, u.delete_from);
        await sendMail(u.email, mail.subject, mail.text);
      } catch (e: any) {
        // an address that will never take mail: noted, and doesn't stop the run
        if (isRefused(e)) { dead.push(u.id); continue; }
        // not recorded, so it's tried again tomorrow (and the account can't be deleted until a warning has gone out)
        console.error(`inactive accounts: a warning email wasn't sent (${e?.message ?? e})`);
        if (++failures >= MAX_MAIL_FAILURES) break;
        continue;
      }
      failures = 0;
      sentOne = true;
      await markWarned(u.id);
      warned++;
    }
    if (dead.length) {
      // email works (another warning went out), so these addresses are the problem: count them as warned
      if (sentOne) for (const id of dead) { await markWarned(id); counted++; }
      console.error(`inactive accounts: Resend refused ${dead.length} warning email(s); `
        + (sentOne ? 'counted as warned (deleted after 30 days, like any warned account)' : 'nothing else was sent, so trying them again tomorrow'));
    }
  } catch (e: any) {
    console.error(`inactive accounts: sweep failed (${e?.message ?? e}); trying again tomorrow`);
  } finally {
    running = false;
  }
  return { deleted, warned, refused: counted };
}

let started = false;
/** Starts the daily sweep (once the database is ready). */
export function startInactiveSweep() {
  if (started) return;
  started = true;
  const run = () => inactiveSweep().then(({ deleted, warned, refused }) => {
    if (deleted || warned || refused) console.log(`inactive accounts: deleted ${deleted}, warned ${warned}, counted as warned after a refused email ${refused}`);
  });
  setTimeout(run, 10 * 60_000).unref();
  setInterval(run, DAY_MS).unref();
}
