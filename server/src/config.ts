// Server settings. Everything can be overridden with environment variables when deployed.
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export const PORT = Number(process.env.GENIE_PORT ?? 3018);   // not PORT: dev tools set that for the browser app
/** The address to listen on: 127.0.0.1 in production, so the only way in is through nginx. Unset = every interface. */
export const HOST = process.env.GENIE_HOST || undefined;
/** The site lives under this path (nginx passes it through unchanged): https://daniyalzia.co.uk/genie */
export const BASE = (process.env.BASE_PATH ?? '/genie').replace(/\/$/, '');
/** The built browser app, served in production. */
export const CLIENT_DIST = path.join(root, 'client/dist');
/** Development server: dev-only endpoints are on and cookies aren't Secure. Never set in production. */
export const DEV = process.env.GENIE_DEV === '1';
// the development server reads anyone's codes (/api/dev/mail) and drops Secure cookies, so it must never touch real accounts
if (DEV && process.env.PGDATABASE && (process.env.PGDATABASE !== 'genie_dev' || process.env.PGUSER !== 'genie_dev'))
  throw new Error('GENIE_DEV=1 may only use the genie_dev database (PGDATABASE and PGUSER genie_dev)');
