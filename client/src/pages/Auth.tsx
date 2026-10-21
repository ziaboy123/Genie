// The signed-out forms: Sign up (details → emailed code), Log in (+ a code on a new device) and Forgot password.
// Ported from Millennium Arena's, with one code box instead of six and a name instead of a username.
import { useState, type FormEvent, type ReactNode } from 'react';
import { LIMITS, type Me } from '@genie/shared';
import { api, authMessage } from '../lib/api.ts';
import { Link, navigate, takeRememberedPath } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { CodeInput, ErrorText, Field, Note, Page, TopBar, useTitle } from '../components/ui.tsx';

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
const cleanName = (v: string) => v.trim().replace(/\s+/g, ' ');

function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  const { accounts } = useSession();
  useTitle(title);
  return (
    <Page slim>
      <TopBar />
      {!accounts && <p className="banner">Signing up and logging in are switched off for a moment.</p>}
      {children}
    </Page>
  );
}

/** The code step every flow shares: "Check your email", the box, Verify, then Back and Resend. */
function CodeStep({ email, why, code, setCode, busy, err, sent, onSubmit, onBack, onResend, children, button = 'Verify' }: {
  email: string; why?: string; code: string; setCode: (c: string) => void; busy: boolean; err: string; sent: boolean;
  onSubmit: (e: FormEvent) => void; onBack: () => void; onResend: () => void; children?: ReactNode; button?: string;
}) {
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <h1 className="title">Check your email</h1>
      <p className="lede">{why ? `${why} ` : ''}Enter the 6-digit code we sent to <strong>{email.trim()}</strong>.</p>
      <CodeInput value={code} onChange={setCode} />
      {children}
      <ErrorText>{err}</ErrorText>
      <button className="btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : button}</button>
      {sent && <Note>New code sent. It can take a minute to arrive.</Note>}
      <div className="split">
        <button type="button" className="btn text" onClick={onBack}>Back</button>
        <button type="button" className="btn text accent" onClick={onResend} disabled={busy}>Resend code</button>
      </div>
    </form>
  );
}

export function SignUp() {
  const { setMe } = useSession();
  const [step, setStep] = useState<'details' | 'code'>('details'), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [sent, setSent] = useState(false);
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');

  const send = () => api('auth/signup', { name: cleanName(name), email: email.trim(), password });
  const start = async (e: FormEvent) => {
    e.preventDefault();
    const problem = !cleanName(name) ? 'Enter your name.' : !validEmail(email) ? 'Enter a valid email address.' : password.length < 10 ? 'Your password needs at least 10 characters.' : '';
    setErr(problem);
    if (problem) return;
    setBusy(true);
    try { await send(); setCode(''); setSent(false); setStep('code'); } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const res = await api('auth/signup/verify', { email: email.trim(), code }); setMe(res.me ?? null); navigate(takeRememberedPath() ?? '/lists/new', true); }
    catch (x) { setErr(authMessage(x)); setBusy(false); }
  };
  const resend = async () => { setErr(''); setSent(false); try { await send(); setSent(true); } catch (x) { setErr(authMessage(x)); } };

  return (
    <AuthPage title="Sign up">
      {step === 'details' ? (
        <form className="form" onSubmit={start} noValidate>
          <h1 className="title">Sign up</h1>
          <Field label="Name" hint="Shown on your lists. A first name is enough." value={name} onChange={setName} autoComplete="given-name" maxLength={LIMITS.name} autoFocus />
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={254} />
          <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 10 characters" maxLength={72} />
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={busy}>{busy ? 'Signing up…' : 'Sign up'}</button>
          <p className="fine">By signing up you agree to the <Link to="/terms">Terms</Link> and confirm you're 13 or older. If you're under 18, check with a parent or guardian first. <Link to="/privacy">Privacy</Link> says what Genie keeps.</p>
          <p className="alt">Have an account? <Link to="/login">Log in</Link></p>
        </form>
      ) : (
        <CodeStep email={email} code={code} setCode={setCode} busy={busy} err={err} sent={sent} onSubmit={verify} onResend={resend}
          onBack={() => { setStep('details'); setErr(''); }} />
      )}
    </AuthPage>
  );
}

export function LogIn() {
  const { setMe } = useSession();
  const [step, setStep] = useState<'details' | 'code'>('details'), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [sent, setSent] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [trust, setTrust] = useState(true);
  const done = (res: { me?: Me | null }) => { setMe(res.me ?? null); navigate(takeRememberedPath() ?? '/lists', true); };

  const send = () => api<{ ok: true; needCode?: boolean; me?: Me | null }>('auth/login', { email: email.trim(), password });
  const start = async (e: FormEvent) => {
    e.preventDefault();
    const problem = !validEmail(email) ? 'Enter a valid email address.' : !password ? 'Enter your password.' : '';
    setErr(problem);
    if (problem) return;
    setBusy(true);
    try {
      const res = await send();
      if (res.needCode) { setCode(''); setSent(false); setStep('code'); setBusy(false); } else done(res);
    } catch (x) { setErr(authMessage(x)); setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { done(await api('auth/login/verify', { email: email.trim(), code, trust })); } catch (x) { setErr(authMessage(x)); setBusy(false); }
  };
  const resend = async () => { setErr(''); setSent(false); try { await send(); setSent(true); } catch (x) { setErr(authMessage(x)); } };

  return (
    <AuthPage title="Log in">
      {step === 'details' ? (
        <form className="form" onSubmit={start} noValidate>
          <h1 className="title">Log in</h1>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={254} autoFocus />
          <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" maxLength={72} />
          <Link to="/forgot" className="strong-link small">Forgot password?</Link>
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          <p className="alt">New to Genie? <Link to="/signup">Sign up</Link></p>
        </form>
      ) : (
        <CodeStep email={email} why="This is a new device, so we need to check it's you." code={code} setCode={setCode} busy={busy} err={err} sent={sent}
          onSubmit={verify} onResend={resend} onBack={() => { setStep('details'); setErr(''); }} button="Log in">
          <label className="check"><input type="checkbox" checked={trust} onChange={e => setTrust(e.target.checked)} /><span>Trust this device for 30 days</span></label>
        </CodeStep>
      )}
    </AuthPage>
  );
}

export function Forgot() {
  const { setMe, refresh } = useSession();
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email'), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [sent, setSent] = useState(false);
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [password, setPassword] = useState('');
  const [after, setAfter] = useState<Me | null>(null);   // logged in once they press Continue (the router would leave this page at once)

  const send = () => api('auth/forgot', { email: email.trim() });
  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!validEmail(email)) return setErr('Enter a valid email address.');
    setBusy(true); setErr('');
    try { await send(); setCode(''); setSent(false); setStep('code'); } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  };
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setErr('Your new password needs at least 10 characters.');
    setBusy(true); setErr('');
    try { const res = await api('auth/forgot/verify', { email: email.trim(), code, password }); setAfter(res.me ?? null); setStep('done'); }
    catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  };
  const resend = async () => { setErr(''); setSent(false); try { await send(); setSent(true); } catch (x) { setErr(authMessage(x)); } };

  return (
    <AuthPage title="Reset your password">
      {step === 'email' && (
        <form className="form" onSubmit={start} noValidate>
          <h1 className="title">Reset your password</h1>
          <p className="lede">Enter your account's email and we'll send you a code to set a new password.</p>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={254} autoFocus />
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          <p className="alt">Remembered it? <Link to="/login">Log in</Link></p>
        </form>
      )}
      {step === 'code' && (
        <CodeStep email={email} why="If there's an account for this email, it has a code waiting." code={code} setCode={setCode} busy={busy} err={err} sent={sent}
          onSubmit={reset} onResend={resend} onBack={() => { setStep('email'); setErr(''); }} button="Set new password">
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 10 characters" maxLength={72} autoFocus={false} />
        </CodeStep>
      )}
      {step === 'done' && (
        <div className="form">
          <h1 className="title">Password changed</h1>
          <p className="lede">You're logged in with your new password, and every other login has been ended.</p>
          <button type="button" className="btn" autoFocus onClick={() => { if (after) setMe(after); else refresh(); navigate(takeRememberedPath() ?? '/lists', true); }}>Continue</button>
        </div>
      )}
    </AuthPage>
  );
}
