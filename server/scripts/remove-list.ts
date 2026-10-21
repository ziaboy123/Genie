// Takedowns: removes one Genie list, or with --account its owner's whole account, after showing what it is and asking.
// It can also remove an account found by its email address (--email), or one wish (--wish).
// What to do when a report comes in (and when to use --keep) is in docs/compliance/handling-reports.md.
//
// Run it on the server, as the genie user, from Genie's server folder:
//   sudo -u genie env PGHOST=/var/run/postgresql PGUSER=genie PGDATABASE=genie ../node_modules/.bin/tsx scripts/remove-list.ts <share code or list id>
// (tsx is installed at the workspace root; `npx tsx` works too where the user has a home for npm's cache)
// What to remove (one of):
//   <share code, list id or share link>   that list (it also prints the list's wishes, with their ids)
//   --email <address>   the whole account with that email, found without a list (say it has none, or the owner lost
//                       access). It prints the account's lists, so it also finds a list whose link has changed.
//   --wish <wish id>    just that wish (the ids are printed when you look up its list)
// Options:
//   --account      with a list: delete the owner's whole account (every list, wish, grant, login and trusted device)
//   --keep <file>  with a list or --email: first write a copy of what's being removed (the list or lists, their wishes,
//                  the owner's account details) to <file>, readable only by its owner. Only for a child sexual abuse
//                  report to the NCA, which the reporting rules say must be kept for a year. Never otherwise.
// Nothing is changed until you type "yes".
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { SHARE_CODE } from '@genie/shared';
import { BASE } from '../src/config.ts';
import { one, pool, q, tx } from '../src/db/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = `Usage:
  tsx scripts/remove-list.ts <share code, list id or share link> [--account] [--keep <file>]
  tsx scripts/remove-list.ts --email <address> [--keep <file>]
  tsx scripts/remove-list.ts --wish <wish id>`;
const day = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));
const today = () => new Date().toISOString().slice(0, 10);
const linkTo = (code: string) => `https://daniyalzia.co.uk${BASE}/w/${code}`;
const lists = (n: number) => `${n} ${n === 1 ? 'list' : 'lists'}`;

function args() {
  const rest = process.argv.slice(2);
  let list = '', email = '', wish = '', account = false, keep = '';
  const value = (flag: string, v: string | undefined) => {
    if (!v || v.startsWith('-')) throw new Error(`${flag} needs a value.\n${USAGE}`);
    return v;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--account') account = true;
    else if (a === '--keep') keep = value(a, rest[++i]);
    else if (a === '--email') email = value(a, rest[++i]).trim().toLowerCase();
    else if (a === '--wish') wish = value(a, rest[++i]).trim();
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (!list && !a.startsWith('-')) list = a.replace(/^.*\/w\//, '').replace(/[/?#].*$/, '');   // a whole share link works too
    else throw new Error(`Don't know "${a}".\n${USAGE}`);
  }
  if ([list, email, wish].filter(Boolean).length !== 1) throw new Error(`Give one list, one --email or one --wish.\n${USAGE}`);
  if (list && !SHARE_CODE.test(list) && !UUID.test(list)) throw new Error(`"${list}" isn't a share code (8 letters and digits) or a list id.`);
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error(`"${email}" isn't an email address.`);
  if (wish && !UUID.test(wish)) throw new Error(`"${wish}" isn't a wish id (the long id printed under a list's wishes).`);
  if (wish && (account || keep)) throw new Error('--wish removes one wish only: --account and --keep go with a list or --email.');
  if (email && account) throw new Error('--email already deletes the whole account: leave out --account.');
  return { list, email, wish, account, keep };
}

/** Asks before anything changes. */
async function confirm(what: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\nDelete ${what} for good? Type "yes" to go ahead: `)).trim().toLowerCase();
  rl.close();
  if (answer === 'yes') return true;
  console.log('Nothing changed.');
  process.exitCode = 2;
  return false;
}

type Owner = { user_id: string; email: string; name: string; user_created: Date; last_seen_at: Date; lists: number; all_wishes: number };
type Found = Owner & { id: string; title: string; share_code: string; event_date: string; created_at: Date; wishes: number };
const OWNER_COLUMNS = `u.id as user_id, u.email, u.name, u.created_at as user_created, u.last_seen_at,
  (select count(*)::int from genie.lists o where o.user_id = u.id) as lists,
  (select count(*)::int from genie.items i join genie.lists o on o.id = i.list_id where o.user_id = u.id) as all_wishes`;

/** Everything about the lists being removed, for --keep: one list, or (listId null) every list on the account. */
async function snapshot(owner: Owner, listId: string | null, reported: string | null) {
  const columns = 'id, title, share_code, event_date, created_at, updated_at';
  const found = listId
    ? await q(`select ${columns} from genie.lists where id = $1`, [listId])
    : await q(`select ${columns} from genie.lists where user_id = $1 order by created_at`, [owner.user_id]);
  for (const l of found) l.wishes = await q('select title, url, shop, price, currency, created_at from genie.items where list_id = $1 order by position', [l.id]);
  return {
    kept_at: new Date().toISOString(),
    why: 'Removed with scripts/remove-list.ts after a report. Kept for the NCA reporting rules (one year from the report).',
    reported_list: reported,
    owner: { id: owner.user_id, email: owner.email, name: owner.name, created_at: owner.user_created, last_seen_at: owner.last_seen_at },
    lists: found,
  };
}

function keepCopy(file: string, copy: unknown) {
  // 'wx': never overwrites an earlier copy; 0600: only this user can read it
  writeFileSync(file, JSON.stringify(copy, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Kept a copy in ${file}. Move it somewhere safe and encrypted, and delete it a year after the report.`);
}

/** The whole account: its codes by hand, everything else by the database's cascade. */
async function deleteAccount(owner: Owner) {
  await tx(async c => {
    await c.query('delete from genie.codes where email = $1', [owner.email]);
    // the database takes its lists, wishes, grants, logins and trusted devices with it
    if (!(await c.query('delete from genie.users where id = $1 returning id', [owner.user_id])).rowCount) throw new Error('the account had already gone');
  });
}

function showOwner(o: Owner, label = 'Owner:  ') {
  console.log(`${label} ${o.name} <${o.email}>, account made ${day(o.user_created)}, last used ${day(o.last_seen_at)}, ${lists(o.lists)}, ${o.all_wishes} wishes in all`);
}

// ---------- a list (and with --account, its owner's whole account) ----------
async function removeList(target: string, account: boolean, keep: string) {
  const found = await one<Found>(`select l.id, l.title, l.share_code, l.event_date, l.created_at,
      (select count(*)::int from genie.items i where i.list_id = l.id) as wishes, ${OWNER_COLUMNS}
    from genie.lists l join genie.users u on u.id = l.user_id
    where ${UUID.test(target) ? 'l.id = $1::uuid' : 'l.share_code = $1'}`, [target]);
  if (!found) {
    console.log(`No list with ${UUID.test(target) ? 'id' : 'share code'} ${target}. A list whose link was changed has a new code: `
      + 'try its id, or run this with --email <owner\'s address> to see their lists (then type anything but "yes").');
    process.exitCode = 2;
    return;
  }

  console.log(`\nList:    "${found.title}"`);
  console.log(`Link:    ${linkTo(found.share_code)}`);
  console.log(`Date:    ${day(found.event_date)} (made ${day(found.created_at)})`);
  console.log(`Wishes:  ${found.wishes}`);
  const wishes = await q<{ id: string; title: string; shop: string | null }>('select id, title, shop from genie.items where list_id = $1 order by position, created_at', [found.id]);
  for (const w of wishes) console.log(`  ${w.id}  "${w.title}"${w.shop ? ` (${w.shop})` : ''}`);
  showOwner(found);
  if (!account && wishes.length) console.log('\nTo remove just one wish, stop here and run this again with --wish <its id>.');
  if (account) console.log(`\n--account: this deletes the WHOLE account: ${lists(found.lists)} and ${found.all_wishes} wishes in all, plus its logins.`);
  if (keep) console.log(`--keep:    a copy goes to ${keep} first.`);

  if (!(await confirm(account ? 'this account' : 'this list'))) return;
  if (keep) keepCopy(keep, await snapshot(found, account ? null : found.id, found.share_code));
  if (account) await deleteAccount(found);
  else if (!(await q('delete from genie.lists where id = $1 returning id', [found.id])).length) throw new Error('the list had already gone');

  console.log(`\nDone: ${account ? `account deleted (${lists(found.lists)})` : 'list deleted'}. The link now shows "not found".`);
  console.log('For the report log (add the reason and who reported it):');
  console.log(`  ${today()} | list ${found.share_code} | ${found.wishes} wishes | ${account ? 'account deleted' : 'list removed'}${keep ? ' | copy kept for the NCA' : ''}`);
}

// ---------- an account, by its email address ----------
async function removeAccount(email: string, keep: string) {
  const owner = await one<Owner>(`select ${OWNER_COLUMNS} from genie.users u where u.email = $1`, [email]);
  if (!owner) { console.log(`No account with the email ${email}.`); process.exitCode = 2; return; }

  console.log('');
  showOwner(owner, 'Account:');
  const found = await q<{ share_code: string; title: string; event_date: string; wishes: number }>(`select l.share_code, l.title, l.event_date,
      (select count(*)::int from genie.items i where i.list_id = l.id) as wishes
    from genie.lists l where l.user_id = $1 order by l.created_at`, [owner.user_id]);
  for (const l of found) console.log(`  ${linkTo(l.share_code)}  "${l.title}" (${day(l.event_date)}, ${l.wishes} wishes)`);
  console.log(`\nThis deletes the WHOLE account: ${lists(owner.lists)} and ${owner.all_wishes} wishes in all, plus its logins.`);
  if (keep) console.log(`--keep:    a copy goes to ${keep} first.`);

  if (!(await confirm('this account'))) return;
  if (keep) keepCopy(keep, await snapshot(owner, null, null));
  await deleteAccount(owner);

  console.log(`\nDone: account deleted (${lists(owner.lists)}).${owner.lists ? ' Its links now show "not found".' : ''}`);
  console.log('For the report log (add the reason and who asked):');
  console.log(`  ${today()} | account by email | ${lists(owner.lists)} | account deleted${keep ? ' | copy kept for the NCA' : ''}`);
}

// ---------- one wish ----------
async function removeWish(id: string) {
  const w = await one<{ id: string; title: string; url: string | null; shop: string | null; granted: boolean; list_title: string; share_code: string; name: string; email: string }>(
    `select i.id, i.title, i.url, i.shop, exists (select 1 from genie.grants g where g.item_id = i.id) as granted,
       l.title as list_title, l.share_code, u.name, u.email
     from genie.items i join genie.lists l on l.id = i.list_id join genie.users u on u.id = l.user_id where i.id = $1::uuid`, [id]);
  if (!w) { console.log(`No wish with id ${id}.`); process.exitCode = 2; return; }

  console.log(`\nWish:    "${w.title}"${w.shop ? ` (${w.shop})` : ''}${w.granted ? ', granted' : ''}`);
  if (w.url) console.log(`Its link: ${w.url}`);
  console.log(`List:    "${w.list_title}", ${linkTo(w.share_code)}`);
  console.log(`Owner:   ${w.name} <${w.email}>`);

  if (!(await confirm('this wish'))) return;
  // its grant goes with it
  if (!(await q('delete from genie.items where id = $1 returning id', [w.id])).length) throw new Error('the wish had already gone');

  console.log('\nDone: wish deleted. The rest of the list is unchanged.');
  console.log('For the report log (add the reason and who reported it):');
  console.log(`  ${today()} | list ${w.share_code} | one wish | wish removed`);
}

async function main() {
  const { list, email, wish, account, keep } = args();
  if (!process.env.PGDATABASE) throw new Error('Set PGHOST, PGUSER and PGDATABASE first (see the top of this file).');
  if (email) await removeAccount(email, keep);
  else if (wish) await removeWish(wish);
  else await removeList(list, account, keep);
}

main()
  .catch(e => { console.error(`remove-list: ${e?.message ?? e}`); process.exitCode = 1; })
  .finally(() => pool.end());
