// The database: Genie's own Postgres database on the homelab's apps server. All tables live in the `genie` schema.
//
// Connection settings are the standard Postgres variables, so no password is ever needed or stored:
//   production:  PGHOST=/var/run/postgresql PGUSER=genie PGDATABASE=genie          (local socket + peer login)
//   development: PGHOST=/tmp/genie-pg PGUSER=genie_dev PGDATABASE=genie_dev        (the server's socket, forwarded over SSH)
import pg from 'pg';

export const DB_ENABLED = !!process.env.PGDATABASE;

// generous connection timeout: in development the database is reached through an SSH tunnel over the VPN
export const pool = new pg.Pool({ max: 8, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000, options: '-c TimeZone=UTC' });
pool.on('error', err => console.error(`database: ${err.message}`));
// "date" columns come back as the plain YYYY-MM-DD text, not a Date at local midnight
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

/** A query with parameters ($1, $2…). Values are never pasted into SQL. */
export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return (await pool.query<T>(text, params)).rows;
}
export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

/** Run `fn` in a transaction: everything or nothing. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  // a connection that drops while it's checked out (between queries) must not take the server down with it
  let broken: Error | null = null;
  const onError = (e: Error) => { broken = e; console.error(`database: connection lost mid-transaction: ${e.message}`); };
  c.on('error', onError);
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.off('error', onError);
    c.release(broken ?? undefined);   // a broken connection is thrown away, not reused
  }
}

// Genie's tables, applied in order on start-up. Never edit a step that has shipped: add a new one.
const MIGRATIONS: string[] = [
  `create table genie.users (
     id uuid primary key default gen_random_uuid(),
     email text not null unique,                    -- always stored lower-case
     name text not null,
     password text not null,                        -- bcrypt hash
     session_version integer not null default 0,    -- bumped to end every login at once
     created_at timestamptz not null default now(),
     last_seen_at timestamptz not null default now()
   );
   -- one-time email codes (sign-up, a new device, password reset, email change); only a keyed hash is stored
   create table genie.codes (
     id bigserial primary key,
     email text not null,
     purpose text not null check (purpose in ('signup', 'login', 'reset', 'email')),
     code_hash text not null,
     payload jsonb not null default '{}',
     attempts integer not null default 0,
     expires_at timestamptz not null,
     created_at timestamptz not null default now()
   );
   create index on genie.codes (email, purpose);
   -- logins: only the SHA-256 of the cookie's token is stored
   create table genie.sessions (
     token_hash text primary key,
     user_id uuid not null references genie.users (id) on delete cascade,
     session_version integer not null,
     created_at timestamptz not null default now(),
     last_seen timestamptz not null default now(),
     expires_at timestamptz not null,
     user_agent text not null default ''
   );
   create index on genie.sessions (user_id);
   -- browsers that skip the emailed code for 30 days
   create table genie.devices (
     token_hash text primary key,
     user_id uuid not null references genie.users (id) on delete cascade,
     label text not null default '',
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   );
   create index on genie.devices (user_id);

   create table genie.lists (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references genie.users (id) on delete cascade,
     title text not null,
     event_date date not null,
     share_code text not null unique,               -- the /w/<code> link; a new one kills the old link
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   create index on genie.lists (user_id);
   create table genie.items (
     id uuid primary key default gen_random_uuid(),
     list_id uuid not null references genie.lists (id) on delete cascade,
     position integer not null,
     title text not null,
     url text,
     shop text,
     price integer,                                 -- minor units (pence); null = unknown
     currency text not null default 'GBP',
     image text,                                    -- (dropped in 2: no pictures are kept)
     created_at timestamptz not null default now()
   );
   create index on genie.items (list_id, position);
   -- one grant per wish; only the hash of the granter's undo token is kept, never who they are
   create table genie.grants (
     item_id uuid primary key references genie.items (id) on delete cascade,
     undo_hash text not null,
     created_at timestamptz not null default now()
   );`,
  // 2: no copies of shop pictures: the link opens the shop's own page, which always has the current photo
  `alter table genie.items drop column image;`,
  // 3: accounts unused for two years are deleted (auth/inactive.ts). This is when the one warning email went out;
  // null = not warned. Using the account again clears it.
  `alter table genie.users add column warned_at timestamptz;`,
];

export async function migrate() {
  // production's schema can be made once by postgres (AUTHORIZATION genie), so the genie login needs no CREATE on the database
  if (!(await q("select 1 from pg_namespace where nspname = 'genie'")).length) await q('create schema genie');
  await q('create table if not exists genie.migrations (version int primary key, applied_at timestamptz not null default now())');
  const done = new Set((await q<{ version: number }>('select version from genie.migrations')).map(r => r.version));
  for (const [i, sql] of MIGRATIONS.entries()) {
    if (done.has(i + 1)) continue;
    await tx(async c => { await c.query(sql); await c.query('insert into genie.migrations (version) values ($1)', [i + 1]); });
    console.log(`database: applied Genie migration ${i + 1}`);
  }
  // expired codes, sessions and devices are cleared out every 6 hours, so a code (with a sign-up's name and password
  // hash) is gone within a day of being made, as the privacy page says
  const sweep = () => q(`delete from genie.codes where expires_at < now();
    delete from genie.sessions where expires_at < now(); delete from genie.devices where expires_at < now();`).catch(() => {});
  sweep();
  setInterval(sweep, 6 * 3600_000).unref();
}
