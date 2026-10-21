// Settings: your name, email and password, logging out (here or everywhere), trusted devices, and deleting the account.
// Simple stacked sections; each change opens just below its section and saves on its own.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { LIMITS, type Me } from '@genie/shared';
import { api, message } from '../lib/api.ts';
import { navigate } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { Back, CodeInput, ErrorText, Field, Loading, Note, Page, Sheet, TopBar, useTitle } from '../components/ui.tsx';
import { Foot } from './Legal.tsx';

/** A browser that skips the emailed code. The server sends dates as ISO strings. */
interface TrustedDevice { id: string; label: string; created_at?: string; expires_at?: string; current?: boolean }
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export function Settings() {
  const { me, setMe } = useSession();
  const [devicesKey, setDevicesKey] = useState(0);   // reload the device list after changes that forget devices
  useTitle('Settings');
  if (!me) return null;
  const changed = (next?: Me | null) => { if (next) setMe(next); };

  return (
    <Page className="settings" foot={<Foot narrow />}>
      <TopBar left={<Back to="/lists">My lists</Back>} />
      <h1 className="title">Settings</h1>
      <NameSection me={me} onSaved={changed} />
      <EmailSection me={me} onSaved={changed} />
      <PasswordSection me={me} onSaved={next => { changed(next); setDevicesKey(k => k + 1); }} />
      <LogoutSection me={me} onSaved={next => { changed(next); setDevicesKey(k => k + 1); }} />
      <Devices key={devicesKey} />
      <DeleteSection />
    </Page>
  );
}

function Section({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <h2 className="h2">{title}</h2>
      {text && <p className="hint">{text}</p>}
      {children}
    </section>
  );
}

function NameSection({ me, onSaved }: { me: Me; onSaved: (me?: Me | null) => void }) {
  const [name, setName] = useState(me.name), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [ok, setOk] = useState(false);
  const clean = name.trim().replace(/\s+/g, ' ');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean) return setErr('Enter your name.');
    setBusy(true); setErr(''); setOk(false);
    try { const r = await api('account/name', { name: clean }); onSaved(r.me); setOk(true); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <Section title="Your name" text="It's on your lists, so people know whose they are.">
      <form className="form" onSubmit={save} noValidate>
        <Field label="Name" hideLabel value={name} onChange={v => { setName(v); setOk(false); }} autoComplete="given-name" maxLength={LIMITS.name} />
        <ErrorText>{err}</ErrorText>
        {ok && <Note>Name saved.</Note>}
        <button className="btn small self-start" disabled={busy || clean === me.name}>{busy ? 'Saving…' : 'Save name'}</button>
      </form>
    </Section>
  );
}

function EmailSection({ me, onSaved }: { me: Me; onSaved: (me?: Me | null) => void }) {
  const [step, setStep] = useState<'' | 'details' | 'code'>(''), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const cancel = () => { setStep(''); setErr(''); setPassword(''); setCode(''); };
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!validEmail(email)) return setErr('Enter a valid email address.');
    if (!password) return setErr('Enter your password.');
    setBusy(true); setErr(''); setOk('');
    try { await api('account/email', { email: email.trim(), password }); setCode(''); setStep('code'); if (!e) setOk('New code sent.'); }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const r = await api('account/email/verify', { email: email.trim(), code }); onSaved(r.me); cancel(); setEmail(''); setOk('Email changed.'); }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <Section title="Email" text={<>You log in with <strong>{me.email}</strong>.</>}>
      {ok && <Note>{ok}</Note>}
      {step === '' && <button type="button" className="btn ghost small self-start" onClick={() => { setStep('details'); setOk(''); }}>Change email</button>}
      {step === 'details' && (
        <form className="form" onSubmit={send} noValidate>
          <p className="lede small">We'll send a code to the new address. Your email only changes once you enter it.</p>
          <Field label="New email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={254} autoFocus />
          <Field label="Your password" type="password" value={password} onChange={setPassword} autoComplete="current-password" maxLength={72} />
          <ErrorText>{err}</ErrorText>
          <div className="row"><button className="btn small" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button><button type="button" className="btn text small" onClick={cancel}>Cancel</button></div>
        </form>
      )}
      {step === 'code' && (
        <form className="form" onSubmit={verify} noValidate>
          <p className="lede small">Enter the 6-digit code we sent to <strong>{email.trim()}</strong>.</p>
          <CodeInput value={code} onChange={setCode} />
          <ErrorText>{err}</ErrorText>
          <div className="row">
            <button className="btn small" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
            <button type="button" className="btn text small accent" disabled={busy} onClick={() => send()}>Resend code</button>
            <button type="button" className="btn text small" onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}
    </Section>
  );
}

function PasswordSection({ me, onSaved }: { me: Me; onSaved: (me?: Me | null) => void }) {
  const [open, setOpen] = useState(false), [current, setCurrent] = useState(''), [next, setNext] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [ok, setOk] = useState(false);
  const cancel = () => { setOpen(false); setErr(''); setCurrent(''); setNext(''); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setErr('Enter your current password.');
    if (next.length < 10) return setErr('Your new password needs at least 10 characters.');
    setBusy(true); setErr('');
    try { const r = await api('account/password', { current, password: next }); onSaved(r.me); cancel(); setOk(true); }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <Section title="Password" text="Changing it logs you out everywhere else.">
      {ok && <Note>Password changed. You've been logged out everywhere else.</Note>}
      {!open ? <button type="button" className="btn ghost small self-start" onClick={() => { setOpen(true); setOk(false); }}>Change password</button> : (
        <form className="form" onSubmit={save} noValidate>
          <input type="email" autoComplete="username" value={me.email} readOnly hidden />
          <Field label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" maxLength={72} autoFocus />
          <Field label="New password" type="password" value={next} onChange={setNext} autoComplete="new-password" placeholder="At least 10 characters" maxLength={72} />
          <ErrorText>{err}</ErrorText>
          <div className="row"><button className="btn small" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button><button type="button" className="btn text small" onClick={cancel}>Cancel</button></div>
        </form>
      )}
    </Section>
  );
}

function LogoutSection({ me, onSaved }: { me: Me; onSaved: (me?: Me | null) => void }) {
  const { setMe } = useSession();
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [ok, setOk] = useState(false);
  const logout = async () => { try { await api('auth/logout'); } catch {} setMe(null); navigate('/', true); };
  const everywhere = async () => {
    setBusy(true); setErr('');
    try { const r = await api('account/logout-everywhere'); onSaved(r.me); setAsking(false); setOk(true); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <Section title="Logging out" text={<>Logged in as <strong>{me.email}</strong> on this device.</>}>
      {ok && <Note>Logged out everywhere else.</Note>}
      <div className="row">
        <button type="button" className="btn ghost small" onClick={logout}>Log out</button>
        <button type="button" className="btn ghost small" onClick={() => { setAsking(true); setOk(false); }}>Log out everywhere</button>
      </div>
      <Sheet open={asking} onClose={() => { setAsking(false); setErr(''); }} title="Log out everywhere?">
        <p className="lede">This ends every other login and forgets your trusted devices. You stay logged in here.</p>
        <ErrorText>{err}</ErrorText>
        <button type="button" className="btn" disabled={busy} onClick={everywhere}>{busy ? 'Logging out…' : 'Log out everywhere'}</button>
        <button type="button" className="btn text" onClick={() => { setAsking(false); setErr(''); }}>Cancel</button>
      </Sheet>
    </Section>
  );
}

function Devices() {
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const load = () => api<{ devices: TrustedDevice[] }>('account/devices').then(r => setDevices(r.devices ?? [])).catch(x => { setErr(message(x)); setDevices([]); });
  useEffect(() => { load(); }, []);
  const forget = async (d: TrustedDevice) => {
    setErr(''); setOk('');
    try { await api('account/devices/forget', { id: d.id }); setOk(d.current ? 'This device will ask for a code next time.' : 'Device forgotten.'); load(); }
    catch (x) { setErr(message(x)); }
  };
  return (
    <Section title="Trusted devices" text="Logging in on a device that isn't trusted asks for an emailed code. Trust lasts 30 days.">
      {ok && <Note>{ok}</Note>}
      <ErrorText>{err}</ErrorText>
      {devices === null ? <Loading /> : devices.length === 0 ? <p className="muted-line">No trusted devices.</p> : (
        <ul className="devices">
          {devices.map(d => (
            <li key={d.id}>
              <span className="device-text">
                <span className="device-name">{d.label || 'Browser'}{d.current && <span className="pill">This device</span>}</span>
                {d.expires_at && <span className="device-meta">Trusted until {day(d.expires_at)}</span>}
              </span>
              <button type="button" className="btn ghost small" onClick={() => forget(d)} aria-label={`Forget ${d.label || 'this browser'}`}>Forget</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DeleteSection() {
  const { setMe } = useSession();
  const [open, setOpen] = useState(false), [password, setPassword] = useState(''), [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const ask = (e: FormEvent) => { e.preventDefault(); if (!password) return setErr('Enter your password.'); setErr(''); setAsking(true); };
  const go = async () => {
    setBusy(true); setErr('');
    try { await api('account/delete', { password }); setMe(null); navigate('/', true); }
    catch (x) { setErr(message(x)); setAsking(false); setBusy(false); }
  };
  return (
    <Section title="Delete account" text="Deletes your account and every list on it, for good. Links you've sent will stop working.">
      {!open ? <button type="button" className="btn ghost danger small self-start" onClick={() => setOpen(true)}>Delete account</button> : (
        <form className="form" onSubmit={ask} noValidate>
          <Field label="Your password" type="password" value={password} onChange={setPassword} autoComplete="current-password" maxLength={72} autoFocus />
          <ErrorText>{err}</ErrorText>
          <div className="row">
            <button className="btn danger small">Delete account</button>
            <button type="button" className="btn text small" onClick={() => { setOpen(false); setPassword(''); setErr(''); }}>Cancel</button>
          </div>
        </form>
      )}
      <Sheet open={asking} onClose={() => setAsking(false)} title="Delete your account?">
        <p className="lede">Your account and all your lists will be gone for good. This can't be undone.</p>
        <button type="button" className="btn danger" disabled={busy} onClick={go}>{busy ? 'Deleting…' : 'Delete for good'}</button>
        <button type="button" className="btn text" onClick={() => setAsking(false)}>Cancel</button>
      </Sheet>
    </Section>
  );
}
