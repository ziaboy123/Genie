// After the day: which wishes were granted (never by whom), and "Reuse this list" for next time.
import { useEffect, useState, type FormEvent } from 'react';
import type { OwnerList } from '@genie/shared';
import { api, ApiError, message } from '../lib/api.ts';
import { formatDay, isoDay, okEventDate, plural } from '../lib/format.ts';
import { Link, navigate, Redirect } from '../lib/router.tsx';
import { Back, ErrorText, Field, Loading, Page, TopBar, useTitle } from '../components/ui.tsx';
import { NotFound } from './NotFound.tsx';

export function Reveal({ id }: { id: string }) {
  const [list, setList] = useState<OwnerList | null>(null);
  const [missing, setMissing] = useState(false), [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api<{ list: OwnerList }>('lists/get', { id }).then(r => live && setList(r.list))
      .catch(x => { if (!live) return; if (x instanceof ApiError && x.status === 404) setMissing(true); else setErr(message(x)); });
    return () => { live = false; };
  }, [id]);
  useTitle('What got granted');

  if (missing) return <NotFound title="List not found" text="This list doesn't exist any more." link={{ to: '/lists', label: 'Back to My lists' }} />;
  // before the day this page would give the surprise away, so it's the editor instead
  if (list && !list.revealed) return <Redirect to={`/lists/${id}`} />;

  const top = <TopBar left={<Back to="/lists">My lists</Back>} right={<Link to={`/lists/${id}`} className="navlink">Edit list</Link>} />;
  if (!list) return <Page>{top}{err ? <ErrorText>{err}</ErrorText> : <Loading />}</Page>;

  const granted = list.items.filter(i => i.granted), rest = list.items.filter(i => !i.granted);
  return (
    <Page className="reveal">
      {top}
      <header className="head">
        <h1 className="title">{list.items.length ? `${granted.length} of ${plural(list.items.length, 'wish', 'wishes')} granted` : 'No wishes on this list'}</h1>
        <span className="sub">{list.title} · {formatDay(list.eventDate)}</span>
      </header>
      {list.items.length > 0 && (
        <ul className="tally">
          {granted.map(i => <li key={i.id} className="yes"><span>{i.title}</span><span className="tag">Granted</span></li>)}
          {rest.map(i => <li key={i.id}><span>{i.title}</span><span className="tag">Not granted</span></li>)}
        </ul>
      )}
      <p className="hint center">Nobody's name is shown. That stays secret.</p>
      <Reuse list={list} />
    </Page>
  );
}

function Reuse({ list }: { list: OwnerList }) {
  const [open, setOpen] = useState(false), [date, setDate] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const reuse = async (e: FormEvent) => {
    e.preventDefault();
    const problem = !date ? 'Pick the new date.' : !okEventDate(date) || date < isoDay() ? 'Pick a date between today and two years from now.' : '';
    setErr(problem);
    if (problem) return;
    setBusy(true);
    try { await api('lists/reuse', { id: list.id, eventDate: date }); navigate(`/lists/${list.id}`, true); }
    catch (x) { setErr(message(x)); setBusy(false); }
  };
  if (!open) return <button type="button" className="btn push-down" onClick={() => setOpen(true)}>Reuse this list</button>;
  return (
    <form className="panel form push-down" onSubmit={reuse} noValidate>
      <h2 className="h2">Reuse this list</h2>
      <p className="lede">Every grant is cleared, so people can grant from it again. The wishes and the link stay the same.</p>
      <Field label="New date" type="date" value={date} onChange={setDate} min={isoDay()} max={isoDay(0, 2)} autoFocus />
      <ErrorText>{err}</ErrorText>
      <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Reuse list'}</button>
      <button type="button" className="btn text" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
    </form>
  );
}
