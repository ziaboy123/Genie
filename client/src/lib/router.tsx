// A tiny router: real paths under the app's base (e.g. /genie/lists), with the browser's back and forward.
import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');   // "/genie"
const listeners = new Set<() => void>();
const current = () => location.pathname.slice(BASE.length).replace(/\/+$/, '') || '/';

/** The current page path, e.g. "/", "/login", "/lists/…". */
export function usePath(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const update = () => setPath(current());
    listeners.add(update);
    addEventListener('popstate', update);
    return () => { listeners.delete(update); removeEventListener('popstate', update); };
  }, []);
  return path;
}

export function navigate(to: string, replace = false) {
  const url = BASE + (to === '/' ? '/' : to);
  if (url === location.pathname) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  scrollTo(0, 0);
  listeners.forEach(l => l());
}

/** Where to go after logging in (a page of yours opened while logged out). */
export const rememberPath = (path: string) => { try { sessionStorage.setItem('genie:next', path); } catch {} };
export function takeRememberedPath(): string | null {
  try { const p = sessionStorage.getItem('genie:next'); sessionStorage.removeItem('genie:next'); return p && /^\/[\w/-]*$/.test(p) ? p : null; } catch { return null; }
}

/** A link that changes page without reloading. */
export function Link({ to, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={BASE + to} {...rest} onClick={e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault(); rest.onClick?.(e); navigate(to);
    }}>{children}</a>
  );
}

/** Sends the browser somewhere else as soon as it renders (replacing this page in the history). */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}
