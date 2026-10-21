// My lists: upcoming lists first (soonest at the top), then the ones whose day has been.
import { useEffect, useState } from 'react';
import type { ListSummary } from '@genie/shared';
import { api, message } from '../lib/api.ts';
import { countdown, formatDay, plural } from '../lib/format.ts';
import { BASE, Link } from '../lib/router.tsx';
import { CopyButton, ErrorText, Loading, ManualLink, Page, TopBar, useTitle } from '../components/ui.tsx';
import { Foot } from './Legal.tsx';

export const shareUrl = (code: string) => `${location.origin}${BASE}/w/${code}`;

export function MyLists() {
  useTitle('My lists');
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api<{ lists: ListSummary[] }>('lists/mine').then(r => live && setLists(r.lists)).catch(x => live && setErr(message(x)));
    return () => { live = false; };
  }, []);

  return (
    <Page foot={<Foot narrow />}>
      <TopBar right={<Link to="/settings" className="navlink">Settings</Link>} />
      <div className="headrow">
        <h1 className="title">My lists</h1>
        <Link to="/lists/new" className="btn small">New list</Link>
      </div>
      <ErrorText>{err}</ErrorText>
      {!lists ? (!err && <Loading />)
        : lists.length === 0 ? (
          <div className="empty">
            <p>No lists yet. Make one for your next birthday, Christmas, or anything else.</p>
            <Link to="/lists/new" className="btn">Make a list</Link>
          </div>
        ) : (
          <ul className="cards">
            {lists.map(l => <ListCard key={l.id} list={l} />)}
          </ul>
        )}
    </Page>
  );
}

function ListCard({ list }: { list: ListSummary }) {
  const [manual, setManual] = useState(false);   // copying wasn't allowed: show the link to copy by hand
  if (list.revealed) return (
    <li className="listcard done">
      <Link to={`/lists/${list.id}/reveal`} className="listcard-link">
        <span className="listcard-title">{list.title}</span>
        <span className="listcard-meta">Done · {list.grantedCount ?? 0} of {list.wishCount} granted</span>
      </Link>
    </li>
  );
  return (
    <li className="listcard">
      <Link to={`/lists/${list.id}`} className="listcard-link">
        <span className="listcard-title">{list.title}</span>
        <span className="listcard-meta">{formatDay(list.eventDate)} · {countdown(list.eventDate)} · {plural(list.wishCount, 'wish', 'wishes')}</span>
      </Link>
      <CopyButton text={shareUrl(list.shareCode)} label="Copy link" className="ghost small" onFail={() => setManual(true)} />
      {manual && <ManualLink url={shareUrl(list.shareCode)} />}
    </li>
  );
}
