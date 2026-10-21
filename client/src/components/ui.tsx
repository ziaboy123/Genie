// Pieces every page uses: the page frame, the top bar, form fields, the code box, pop-up sheets, copy buttons.
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';

/** Sets the browser tab's title while the page is open. */
export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · Genie` : 'Genie'; }, [title]);
}

/** A page: one centred column on the lavender ground. `slim` is for single forms (sign up, new list). `foot` goes
 *  below the column (the site footer, on the pages that have one). */
export function Page({ children, slim = false, className = '', foot }: { children: ReactNode; slim?: boolean; className?: string; foot?: ReactNode }) {
  return <div className="page"><main className={`col ${slim ? 'slim' : ''} ${className}`}>{children}</main>{foot}</div>;
}

/** The "Genie" wordmark: to your lists when logged in, otherwise Home. */
export function Brand({ big = false }: { big?: boolean }) {
  const { me } = useSession();
  return <Link to={me ? '/lists' : '/'} className={`brand ${big ? 'big' : ''}`}>Genie</Link>;
}

/** The row along the top: the wordmark (or a back link) on the left, a link or two on the right. */
export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return <nav aria-label="Main" className="topbar">{left ?? <Brand />}{right && <div className="topbar-r">{right}</div>}</nav>;
}

export const Back = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="back">← {children}</Link>;

/** A labelled text field. Anything else (type, autoComplete, maxLength…) goes straight to the input. */
export function Field({ label, hint, value, onChange, hideLabel = false, ...rest }: {
  label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; hideLabel?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const auto = useId(), id = rest.id ?? auto, hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>{label}</label>
      <input className="input" {...rest} id={id} value={value} onChange={e => onChange(e.target.value)} aria-describedby={hint ? hintId : undefined} />
      {hint && <span className="hint" id={hintId}>{hint}</span>}
    </div>
  );
}

/** One box for an emailed 6-digit code: typing, autofill from the email, or pasting "123 456" all work. */
export function CodeInput({ value, onChange, autoFocus = true }: { value: string; onChange: (code: string) => void; autoFocus?: boolean }) {
  const id = useId();
  return <>
    <label htmlFor={id} className="sr-only">6-digit code</label>
    <input id={id} className="input code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" autoFocus={autoFocus}
      value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      // the box only holds 6 characters, so a pasted "123 456" would lose its last digit: take the digits first
      onPaste={e => { const digits = e.clipboardData.getData('text').replace(/\D/g, ''); if (digits) { e.preventDefault(); onChange(digits.slice(0, 6)); } }} />
  </>;
}

/** An error message by the thing that failed. Nothing at all when there's no error. */
export const ErrorText = ({ children }: { children: ReactNode }) => (children ? <p className="err" role="alert">{children}</p> : null);

/** A short confirmation that's read out to screen readers too ("New code sent"). */
export const Note = ({ children }: { children: ReactNode }) => <p className="note" role="status">{children}</p>;

export const Loading = ({ children = 'Loading…' }: { children?: ReactNode }) => <p className="loading-text" role="status">{children}</p>;

/** A pop-up that asks one question: slides up from the bottom on phones, sits in the middle on bigger screens.
 *  It's a real modal <dialog>, so focus stays inside and Escape closes it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={onClose}
      // a click on the dim backdrop lands on the dialog itself (its content fills it), so that closes it
      onClick={e => { if (e.target === ref.current) onClose(); }}>
      {open && <div className="sheet-body"><h2 id={titleId} className="sheet-title">{title}</h2>{children}</div>}
    </dialog>
  );
}

/** Puts text on the clipboard. Older browsers get the hidden-textarea trick; false if neither worked. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.className = 'offscreen';
    document.body.append(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}

/** "Copy" that turns green and says "Copied" for a moment. If the browser won't allow copying, the link gets selected
 *  instead so it can be copied by hand: in the share-link box (`select`), or in one `onFail` shows. */
export function CopyButton({ text, select, onFail, label = 'Copy', className = '' }: {
  text: string; select?: () => HTMLInputElement | null; onFail?: () => void; label?: string; className?: string;
}) {
  const [state, setState] = useState<'' | 'copied' | 'manual'>('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(text);
    if (!ok) { const input = select?.(); input?.focus(); input?.select(); onFail?.(); }
    setState(ok ? 'copied' : 'manual');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(''), 2200);
  };
  return <>
    <button type="button" className={`btn ${state === 'copied' ? 'copied' : ''} ${className}`} onClick={copy}>
      {state === 'copied' ? 'Copied' : state === 'manual' ? 'Selected' : label}</button>
    <span className="sr-only" role="status">{state === 'copied' ? 'Link copied' : state === 'manual' ? "Couldn't copy. The link is selected, so copy it by hand." : ''}</span>
  </>;
}

/** A link in a box, selected as soon as it appears: for copying by hand when the browser won't copy it. */
export function ManualLink({ url }: { url: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <input ref={input} className="input share manual" type="text" readOnly value={url} aria-label="Share link" onFocus={e => e.target.select()} />;
}

/** The share link box with Copy (and anything else, like Preview, after it). */
export function ShareLink({ url, hideLabel = false, children }: { url: string; hideLabel?: boolean; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>Share link</label>
      <div className="share-row">
        <input ref={input} id={id} className="input share" type="text" readOnly value={url} onFocus={e => e.target.select()} />
        <CopyButton text={url} select={() => input.current} className="copy" />
        {children}
      </div>
    </div>
  );
}

/** Only real web links become clickable: never javascript: or anything else that slipped through. */
export const safeHref = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : undefined);

/** Small line icons. */
const ICONS = {
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};
export const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
);
