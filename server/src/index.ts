// Genie's server: the JSON API and (in production) the built browser app, all under one path prefix so it sits
// behind nginx like the other sites (https://daniyalzia.co.uk/genie).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { SHARE_CODE } from '@genie/shared';
import { startInactiveSweep } from './auth/inactive.ts';
import { accountRoutes } from './auth/routes.ts';
import { BASE, CLIENT_DIST, DEV, HOST, PORT } from './config.ts';
import { DB_ENABLED, migrate } from './db/index.ts';
import { clientIp, send } from './http.ts';
import { listRoutes } from './lists/routes.ts';
import { shareMeta } from './lists/store.ts';
import { limited } from './ratelimit.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

let indexHtml: string | null = null;
/** The app's page; a share link's page also says whose list it is, for link previews in WhatsApp, iMessage and so on. */
async function sendIndex(req: IncomingMessage, res: ServerResponse, rel: string) {
  if (indexHtml === null || DEV) indexHtml = readFileSync(path.join(CLIENT_DIST, 'index.html'), 'utf8');
  let html = indexHtml;
  const code = rel.match(/^\/w\/([^/]+)\/?$/)?.[1];
  if (code) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');   // people's lists never end up in search engines
    // whether the preview is there says whether the code is real, so the lookup gets the same allowance as opening a
    // list through the API (300 per visitor per 15 minutes): past it the page still loads, just without a preview
    const meta = SHARE_CODE.test(code) && DB_ENABLED && !limited(`preview:${clientIp(req)}`, 300, 15 * 60_000)
      ? await shareMeta(code).catch(() => null) : null;
    if (meta) {
      const title = escapeHtml(`${meta.title}`), desc = escapeHtml(`${meta.ownerName}'s wishlist on Genie · ${meta.count} ${meta.count === 1 ? 'wish' : 'wishes'}`);
      // replacer functions: a replacement string would expand $& $` $$ in the owner's title or name ("Gifts under $`10" copied the head in)
      html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${title} · Genie</title>`)
        .replace('</head>', () => `<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:type" content="website"><meta name="robots" content="noindex, nofollow"></head>`);
    }
  }
  res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
  res.end(html);
}

async function serveClient(req: IncomingMessage, res: ServerResponse, rel: string) {
  if (!existsSync(CLIENT_DIST)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('The browser app isn\'t built. In development use `npm run dev`; for production run `npm run build`.'); return; }
  const file = path.join(CLIENT_DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(CLIENT_DIST + path.sep) || !existsSync(file) || statSync(file).isDirectory() || file.endsWith('index.html')) return sendIndex(req, res, rel);   // app routes
  const hashed = /[-.][A-Za-z0-9_]{8,}\.(js|css|woff2)$/.test(file);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/** Headers on every response: no sniffing, no framing, no referrer, and a strict content policy (nothing from other sites). */
function securityHeaders(res: ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self'", "connect-src 'self'",
    "manifest-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'",
  ].join('; '));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  securityHeaders(res);
  // path-only redirects: nothing from the request ends up in a Location header (a huge one once overflowed nginx's buffer)
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === BASE) { res.writeHead(301, { location: BASE + '/' }); res.end(); return; }
  if (!url.pathname.startsWith(BASE + '/')) { res.writeHead(302, { location: BASE + '/' }); res.end(); return; }
  const rel = url.pathname.slice(BASE.length);
  if (rel.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex');
    if (rel === '/api/health') return send(res, 200, { ok: true, db: DB_ENABLED });
    if (DB_ENABLED && await accountRoutes(req, res, rel)) return;
    if (DB_ENABLED && await listRoutes(req, res, rel)) return;
    return send(res, 404, { error: 'Not found.' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  return serveClient(req, res, rel);
}

// a request that breaks something (a malformed address, say) gets an error; it never takes the server down
const server = createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error(`http ${req.method} ${String(req.url).slice(0, 200)}: ${e?.stack ?? e}`);
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' });
    res.end();
  });
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
process.on('unhandledRejection', e => console.error(`unhandled: ${(e as any)?.stack ?? e}`));

// the server starts even when the database is unreachable, and keeps trying to get it ready
async function prepareDatabase() {
  if (!DB_ENABLED) return console.log('database: not configured (set PGHOST/PGUSER/PGDATABASE); accounts and lists are off');
  try { await migrate(); console.log('database: ready'); startInactiveSweep(); }
  catch (e: any) { console.error(`database: not ready (${e.message}); trying again in 30 s`); setTimeout(prepareDatabase, 30_000).unref(); }
}
prepareDatabase();

server.listen(PORT, HOST, () => console.log(`Genie on http://${HOST ?? 'localhost'}:${PORT}${BASE}/${DEV ? ' (development)' : ''}`));
