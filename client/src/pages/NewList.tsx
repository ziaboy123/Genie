// New list: a name and a date, then "Your list is ready" with the link to send.
import { useState, type FormEvent } from 'react';
import { LIMITS, type OwnerList } from '@genie/shared';
import { api, message } from '../lib/api.ts';
import { isoDay, okEventDate } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { Back, ErrorText, Field, Page, ShareLink, TopBar, useTitle } from '../components/ui.tsx';
import { shareUrl } from './MyLists.tsx';

export function NewList() {
  const { me } = useSession();
  const [title, setTitle] = useState(''), [date, setDate] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [made, setMade] = useState<OwnerList | null>(null);
  useTitle(made ? 'Your list is ready' : 'New list');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    const problem = !name ? 'Give your list a name.' : !date ? 'Pick the date.' : !okEventDate(date) ? 'Pick a date between today and two years from now.' : '';
    setErr(problem);
    if (problem) return;
    setBusy(true);
    try { const { list } = await api<{ list: OwnerList }>('lists/create', { title: name, eventDate: date }); setMade(list); }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };

  return (
    <Page slim>
      <TopBar left={<Back to="/lists">My lists</Back>} />
      {!made ? (
        <form className="form" onSubmit={create} noValidate>
          <h1 className="title">New list</h1>
          <Field label="Name" value={title} onChange={setTitle} maxLength={LIMITS.title} placeholder={me ? `${me.name.split(' ')[0]}'s birthday` : 'My birthday'} autoFocus />
          <Field label="Date" type="date" value={date} onChange={setDate} min={isoDay()} max={isoDay(0, 2)} />
          <ErrorText>{err}</ErrorText>
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create list'}</button>
        </form>
      ) : (
        <div className="form">
          <h1 className="title">Your list is ready</h1>
          <p className="lede">Send this link to family and friends. They don't need an account.</p>
          <ShareLink url={shareUrl(made.shareCode)} hideLabel />
          <Link to={`/lists/${made.id}`} className="btn ghost">Add wishes</Link>
        </div>
      )}
    </Page>
  );
}
