// The share page (/w/<code>): what family and friends see. No account needed. Grant a wish and everyone else sees
// it's taken (except the owner); only this browser can undo it, with the token it keeps.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SHARE_CODE, type PublicItem, type PublicList, type WishState } from '@genie/shared';
import { api, ApiError, message } from '../lib/api.ts';
import { countdown, daysUntil, formatDay, wishMeta } from '../lib/format.ts';
import { adoptOld, dropGrant, file, forgetPassed, heldFor, readGrants, saveGrant, tokensFor, type Tokens } from '../lib/grants.ts';
import { Link } from '../lib/router.tsx';
import { ErrorText, Loading, Note, Page, Sheet, safeHref, useTitle } from '../components/ui.tsx';
import { ShareFoot } from './Legal.tsx';
import { ListNotFound } from './NotFound.tsx';

/** Someone else's grants sink to the bottom; everything else keeps the list's order. */
const ordered = (items: PublicItem[]) => [...items].sort((a, b) => Number(a.state === 'granted') - Number(b.state === 'granted'));

type Sort = 'list' | 'high' | 'low';
/** The order to show: the owner's, or by price (wishes without one last). Granted ones stay at the bottom either way. */
function sorted(items: PublicItem[], sort: Sort): PublicItem[] {
  if (sort === 'list') return items;
  const dir = sort === 'high' ? -1 : 1;
  return [...items].sort((a, b) => Number(a.state === 'granted') - Number(b.state === 'granted')
    || Number(a.price === null) - Number(b.price === null)
    || ((a.price ?? 0) - (b.price ?? 0)) * dir);
}

export function Wishlist({ code }: { code: string }) {
  const valid = SHARE_CODE.test(code);
  const [list, setList] = useState<PublicList | null>(null);
  const [missing, setMissing] = useState(!valid);
  const [err, setErr] = useState(''), [notice, setNotice] = useState('');
  const [sort, setSort] = useState<Sort>('list');
  const loadedAt = useRef(0);

  const load = useCallback(async () => {
    adoptOld();   // tokens kept the old way (per share code) are filed the new way first
    const view = (tokens: Tokens) => api<{ list: PublicList }>('w/view', { code, tokens: Object.values(tokens).slice(0, 200) });
    let opened: string | undefined;
    try {
      const sent = tokensFor(code);
      let r = await view(sent);
      // tokens this browser filed elsewhere for this list (before it got a new link, say): look again with them
      const { tokens: held, from } = heldFor(r.list.key, code, r.list.items.map(i => i.id));
      const asked = new Set(Object.values(sent));
      if (Object.values(held).some(t => !asked.has(t))) r = await view(held);
      loadedAt.current = Date.now();
      const { key, eventDate, items } = r.list;
      opened = key;
      // once the day has passed, grants can't be undone, so the keys are no use any more: forget them (the privacy
      // page says so). Before that, forget tokens that no longer mean anything, and say why: the grant was cleared
      // (the owner can clear them all with a new link), or the wish has been taken off the list altogether
      if (r.list.revealed) file(key, code, eventDate, {}, from);
      else if (items.some(i => i.state === 'hidden')) file(key, code, eventDate, held, from);   // the owner: nothing to go on
      else {
        const byId = new Map(items.map(i => [i.id, i]));
        const kept: Tokens = {}, cleared: PublicItem[] = [];
        let removed = 0;
        Object.entries(held).forEach(([id, token], n) => {
          const item = byId.get(id);
          if (n >= 200 || item?.state === 'mine') kept[id] = token;   // past 200 they weren't sent, so there's no telling
          else if (!item) removed++;
          else cleared.push(item);
        });
        file(key, code, eventDate, kept, from);
        const notes = [
          cleared.length === 1 ? `Your grant on “${cleared[0].title}” was cleared, ${cleared[0].state === 'open' ? "so it's open again. Grant it again if you're still getting it." : 'and someone else has granted it since.'}`
            : cleared.length ? `Your grants on ${cleared.length} wishes were cleared, so check the list and grant again what you're still getting.` : '',
          removed === 1 ? 'A wish you granted has been taken off the list, so you can skip that one.'
            : removed ? 'Some wishes you granted have been taken off the list, so you can skip those.' : '',
        ].filter(Boolean);
        if (notes.length) setNotice(notes.join(' '));
      }
      setList({ ...r.list, items: ordered(items) });
      setErr('');
    } catch (x) {
      if (x instanceof ApiError && x.status === 404) setMissing(true);
      else setErr(message(x));
    } finally {
      // other lists' tokens, long after their day; never this list's by date alone, since its day may have been moved
      // (the server's `revealed` above decides for it)
      forgetPassed({ key: opened, code });
    }
  }, [code]);

  useEffect(() => { if (valid) load(); }, [valid, load]);
  // coming back to the tab later: others may have granted things since, so fetch the list again
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible' && loadedAt.current && Date.now() - loadedAt.current > 30_000) load(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [load]);
  useTitle(list?.title ?? (missing ? 'List not found' : 'Wishlist'));

  const setState = (id: string, state: WishState) => setList(l => (l ? { ...l, items: l.items.map(i => (i.id === id ? { ...i, state } : i)) } : l));

  // ----- granting: one "Getting this?" sheet, then the token is kept so it can be undone -----
  const [asking, setAsking] = useState<PublicItem | null>(null);
  const [busy, setBusy] = useState(false), [sheetErr, setSheetErr] = useState(''), [stale, setStale] = useState(false);
  const closeSheet = () => { setAsking(null); setSheetErr(''); setStale(false); };
  const grant = async () => {
    if (!asking) return;
    setBusy(true); setSheetErr('');
    try {
      const { token } = await api<{ token: string }>('w/grant', { code, itemId: asking.id });
      if (list) saveGrant(list.key, code, list.eventDate, asking.id, token);
      setState(asking.id, 'mine');
      setAsking(null);
    } catch (x) {
      // someone beat you to it, the day has passed, or the wish has gone: show why, and show the list as it is now
      setSheetErr(message(x));
      if (x instanceof ApiError && x.status >= 400 && x.status < 500) { setStale(true); load(); }
    } finally { setBusy(false); }
  };

  const [undoing, setUndoing] = useState<string | null>(null);
  const undo = async (item: PublicItem) => {
    if (!list) return;
    const token = readGrants(list.key)[item.id];
    setNotice(''); setErr('');
    if (!token) { setNotice("This browser can't undo that one any more."); return load(); }
    setUndoing(item.id);
    try {
      await api('w/ungrant', { code, itemId: item.id, token });
      dropGrant(list.key, item.id);
      setState(item.id, 'open');
    } catch (x) {
      if (x instanceof ApiError && x.status === 404) { dropGrant(list.key, item.id); setNotice('That wish has changed since you granted it. Here is the list as it is now.'); load(); }
      else setErr(message(x));
    } finally { setUndoing(null); }
  };

  if (missing) return <ListNotFound />;
  if (!list) return <Page className="wishlist"><Link to="/" className="brand">Genie</Link>{err ? <ErrorText>{err}</ErrorText> : <Loading />}</Page>;

  const owner = list.ownerName || 'the list owner';
  const hidden = list.isOwner && !list.revealed;
  const canGrant = !list.isOwner && !list.revealed;
  const soon = daysUntil(list.eventDate) >= 0;
  return (
    <Page className="wishlist">
      <header className="head">
        <Link to="/" className="brand">Genie</Link>
        <h1 className="title big">{list.title}</h1>
        <span className="sub">{formatDay(list.eventDate)}{soon && !list.revealed ? ` · ${countdown(list.eventDate)}` : ''}</span>
        {hidden ? <p className="banner">This is your list. Grants are hidden until after the day.</p>
          : list.revealed ? <span className="hint lead">This day has been and gone, so wishes can't be granted any more.</span>
          : <span className="hint lead"><span className="touch">Tap</span><span className="mouse">Press</span> <strong>Grant</strong> on what you're getting so nobody doubles up. {list.ownerName ? `${list.ownerName} won't see.` : "The list's owner won't see."}</span>}
      </header>

      {notice && <Note>{notice}</Note>}
      {err && <ErrorText>{err}</ErrorText>}

      {list.items.filter(i => i.price !== null).length >= 2 && (
        <div className="sortbar">
          <label htmlFor="w-sort">Sort</label>
          <select id="w-sort" className="select" value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="list">{list.ownerName ? `${list.ownerName}'s order` : 'List order'}</option>
            <option value="high">Price: high to low</option>
            <option value="low">Price: low to high</option>
          </select>
        </div>
      )}

      {list.items.length === 0 ? <p className="empty-line">No wishes on this list yet. Check back soon.</p> : (
        <ul className="wishes">
          {sorted(list.items, sort).map(item => (
            <PublicRow key={item.id} item={item} canGrant={canGrant} busy={undoing === item.id}
              onGrant={() => { setAsking(item); setSheetErr(''); setStale(false); }} onUndo={() => undo(item)} />
          ))}
        </ul>
      )}

      {list.items.some(i => i.price !== null) && <p className="hint center">Prices are from when each wish was added, so check the shop for the latest.</p>}
      <Link to="/" className="strong-link small self-center">Make your own list</Link>
      <ShareFoot code={code} isOwner={list.isOwner} />

      <Sheet open={!!asking} onClose={closeSheet} title="Getting this?">
        {asking && <>
          {!stale && <p className="lede"><strong>{asking.title}</strong> will show as granted to everyone except {owner}.</p>}
          <ErrorText>{sheetErr}</ErrorText>
          {stale
            ? <button type="button" className="btn" onClick={closeSheet}>OK</button>
            : <button type="button" className="btn" disabled={busy} onClick={grant}>{busy ? 'Granting…' : 'Yes, grant it'}</button>}
          {!stale && <button type="button" className="btn text" onClick={closeSheet}>Cancel</button>}
        </>}
      </Sheet>
    </Page>
  );
}

function PublicRow({ item, canGrant, busy, onGrant, onUndo }: { item: PublicItem; canGrant: boolean; busy: boolean; onGrant: () => void; onUndo: () => void }) {
  const taken = item.state === 'granted';
  const href = safeHref(item.url);
  // no price from the shop's page: the link has it
  const meta = wishMeta(item.shop, item.price, item.currency, href ? 'Open the link for the price' : undefined);
  const inner = <>
    <span className="wish-text">
      <span className="wish-title">{item.title}</span>
      {meta && <span className="wish-meta">{meta}</span>}
    </span>
  </>;
  return (
    <li className={`wish public ${taken ? 'taken' : ''}`}>
      {/* tapping the wish opens the shop; Genie's address isn't passed on */}
      {href ? <a className="wish-link" href={href} target="_blank" rel="noopener noreferrer">{inner}</a> : <span className="wish-link">{inner}</span>}
      {item.state === 'open' && canGrant && <button type="button" className="btn grant" onClick={onGrant} aria-label={`Grant ${item.title}`}>Grant</button>}
      {item.state === 'mine' && (canGrant
        ? <button type="button" className="btn mine" onClick={onUndo} disabled={busy} aria-label={`You're granting ${item.title}. Undo`}>{busy ? 'Undoing…' : 'Yours · Undo'}</button>
        : <span className="state mine">Yours</span>)}
      {taken && <span className="state">Granted</span>}
    </li>
  );
}
