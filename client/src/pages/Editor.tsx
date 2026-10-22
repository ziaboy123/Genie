// The editor: your list's name and date, its share link, and its wishes (paste a link to add one; edit, remove,
// move up and down). Grants never show here before the day: the server doesn't even send them.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS, type OwnerItem, type OwnerList } from '@genie/shared';
import { api, ApiError, message } from '../lib/api.ts';
import { countdown, currencySymbol, formatDay, isoDay, okEventDate, parsePrice, plural, priceText, wishMeta } from '../lib/format.ts';
import { Link, navigate } from '../lib/router.tsx';
import { ErrorText, Field, Icon, Loading, Note, Page, ShareLink, Sheet, TopBar, useTitle } from '../components/ui.tsx';
import { shareUrl } from './MyLists.tsx';
import { NotFound } from './NotFound.tsx';

export function Editor({ id }: { id: string }) {
  const [list, setList] = useState<OwnerList | null>(null);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { const r = await api<{ list: OwnerList }>('lists/get', { id }); setList(r.list); setErr(''); }
    catch (x) { if (x instanceof ApiError && x.status === 404) setMissing(true); else setErr(message(x)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useTitle(list?.title ?? 'Your list');

  if (missing) return <NotFound title="List not found" text="This list doesn't exist any more." link={{ to: '/lists', label: 'Back to My lists' }} />;
  if (!list) return (
    <Page>
      <TopBar right={<Link to="/lists" className="navlink">My lists</Link>} />
      {err ? <><ErrorText>{err}</ErrorText><button type="button" className="btn ghost small self-start" onClick={load}>Try again</button></> : <Loading />}
    </Page>
  );
  return <ListEditor list={list} setList={setList} reload={load} />;
}

type Focus = { id: string; what: 'up' | 'down' | 'edit' } | 'add' | null;

function ListEditor({ list, setList, reload }: { list: OwnerList; setList: (fn: (l: OwnerList | null) => OwnerList | null) => void; reload: () => Promise<void> }) {
  const update = (fn: (l: OwnerList) => OwnerList) => setList(l => (l ? fn(l) : l));
  const items = list.items;
  const [editingDetails, setEditingDetails] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [moveErr, setMoveErr] = useState(''), [linkNote, setLinkNote] = useState('');
  const [sheet, setSheet] = useState<'' | 'link' | 'delete' | { remove: OwnerItem }>('');
  const day = formatDay(list.eventDate);

  // after moving, editing or removing a wish, keyboard focus goes back to a sensible place instead of the top of the page
  const [focus, setFocus] = useState<Focus>(null);
  const addInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focus) return;
    if (focus === 'add') addInput.current?.focus();
    else {
      const el = document.querySelector<HTMLButtonElement>(`[data-focus="${focus.id}:${focus.what}"]`);
      // a wish moved to the very top (or bottom) has its "up" (or "down") button switched off: use the other one
      const other = focus.what === 'up' ? 'down' : focus.what === 'down' ? 'up' : null;
      (el && !el.disabled ? el : other && document.querySelector<HTMLButtonElement>(`[data-focus="${focus.id}:${other}"]`))?.focus();
    }
    setFocus(null);
  }, [focus]);

  // ----- adding a wish -----
  const [text, setText] = useState(''), [adding, setAdding] = useState(false), [addErr, setAddErr] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);   // the wish just added, outlined for a moment
  useEffect(() => {
    if (!fresh) return;
    // new wishes go at the end of the list: bring it into view if it's below the fold
    document.querySelector(`[data-wish="${fresh}"]`)?.scrollIntoView({ block: 'nearest', behavior: smooth() });
    const t = setTimeout(() => setFresh(null), 2500);
    return () => clearTimeout(t);
  }, [fresh]);
  const full = items.length >= LIMITS.itemsPerList;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (adding) return;
    const url = pickUrl(text);
    if (!url) return setAddErr(text.trim() ? 'Paste a link that starts with http:// or https://.' : 'Paste a link from a shop first.');
    if (url.length > LIMITS.url) return setAddErr('That link is too long.');
    setAdding(true); setAddErr(''); setText(''); setFresh(null);
    try {
      const { item } = await api<{ item: OwnerItem }>('items/add', { listId: list.id, url });
      update(l => ({ ...l, items: [...l.items, item], wishCount: l.items.length + 1 }));
      setFresh(item.id);
    } catch (x) {
      setAddErr(message(x));
      setText(t => t || text);   // put the link back so it can be fixed (unless they've already pasted another)
    } finally { setAdding(false); }
  };

  // ----- moving wishes: shown at once, then the server's order (only the latest reply counts) -----
  const moves = useRef(0);
  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    update(l => ({ ...l, items: next }));
    setFocus({ id: items[index].id, what: dir < 0 ? 'up' : 'down' });
    const mine = ++moves.current;
    setMoveErr('');
    try {
      const r = await api<{ list: OwnerList }>('items/reorder', { listId: list.id, ids: next.map(i => i.id) });
      if (mine === moves.current) setList(() => r.list);
    } catch (x) {
      if (mine === moves.current) { setMoveErr(message(x)); reload(); }
    }
  };

  return (
    <Page className="editor">
      <TopBar right={<Link to="/lists" className="navlink">My lists</Link>} />

      {editingDetails
        ? <DetailsForm list={list} onDone={l => { if (l) setList(() => l); setEditingDetails(false); }} />
        : (
          <header className="head">
            <h1 className="title big">{list.title}</h1>
            <span className="sub">{day} · {countdown(list.eventDate)} · <button type="button" className="linkbtn" onClick={() => setEditingDetails(true)}>Edit</button></span>
          </header>
        )}

      {list.revealed && (
        <div className="banner reveal">
          <p><strong>The day has been and gone.</strong> {items.filter(i => i.granted).length} of {plural(items.length, 'wish was', 'wishes were')} granted.</p>
          <Link to={`/lists/${list.id}/reveal`} className="btn small">See what got granted</Link>
        </div>
      )}

      <section aria-label="Share" className="share">
        <ShareLink url={shareUrl(list.shareCode)}>
          <Link to={`/w/${list.shareCode}`} className="btn ghost preview">Preview</Link>
        </ShareLink>
        {!list.revealed && <span className="hint">You won't see what's been granted until after {day}.</span>}
        {linkNote && <Note>{linkNote}</Note>}
        <button type="button" className="linkbtn quiet self-start" onClick={() => { setSheet('link'); setLinkNote(''); }}>Get a new link</button>
      </section>

      <section aria-labelledby="wishes-h" className="wishes-section">
        <h2 id="wishes-h" className="h2">Wishes</h2>
        {full ? <p className="hint">This list has {LIMITS.itemsPerList} wishes, which is as many as a list can hold.</p> : (
          <form className="addform" onSubmit={add} noValidate>
            <label htmlFor="ed-url" className="sr-only">Link to a product</label>
            <input ref={addInput} id="ed-url" className="input" type="url" inputMode="url" enterKeyHint="go" autoComplete="off" autoCapitalize="none" spellCheck={false}
              placeholder="Paste a link from any shop" value={text} onChange={e => { setText(e.target.value); setAddErr(''); }} />
            <button className="btn add" disabled={adding}>Add</button>
          </form>
        )}
        <ErrorText>{addErr}</ErrorText>
        <ErrorText>{moveErr}</ErrorText>

        {items.length === 0 && !adding ? <p className="empty-line">No wishes yet. Paste a link from any shop to add your first.</p> : (
          <ul className="wishes">
            {adding && (
              <li className="wish loading" role="status">
                <span className="wish-title muted">Getting the details…</span>
              </li>
            )}
            {items.map((item, i) => editing === item.id
              ? <WishEdit key={item.id} item={item} onDone={saved => {
                  if (saved) update(l => ({ ...l, items: l.items.map(x => (x.id === saved.id ? saved : x)) }));
                  setEditing(null); setFocus({ id: item.id, what: 'edit' });
                }} />
              : <WishRow key={item.id} item={item} first={i === 0} last={i === items.length - 1} fresh={fresh === item.id}
                  onMove={dir => move(i, dir)} onEdit={() => { setEditing(item.id); setMoveErr(''); }} onRemove={() => setSheet({ remove: item })} />)}
          </ul>
        )}
      </section>

      <section aria-label="List options" className="options">
        <button type="button" className="btn ghost danger small self-start" onClick={() => setSheet('delete')}>Delete list</button>
      </section>

      <NewLinkSheet open={sheet === 'link'} list={list} onClose={() => setSheet('')} onDone={l => { setList(() => l); setSheet(''); setLinkNote('New link ready. Send it to everyone again: the old one has stopped working.'); }} />
      <DeleteListSheet open={sheet === 'delete'} list={list} onClose={() => setSheet('')} />
      <RemoveSheet item={typeof sheet === 'object' ? sheet.remove : null} onClose={() => setSheet('')} onDone={removed => {
        const at = items.findIndex(x => x.id === removed.id), after = items[at + 1] ?? items[at - 1];
        update(l => ({ ...l, items: l.items.filter(x => x.id !== removed.id), wishCount: l.items.length - 1 }));
        setSheet(''); setFocus(after ? { id: after.id, what: 'edit' } : 'add');
      }} />
    </Page>
  );
}

/** The link in what was pasted: share sheets often add the product's name before it ("Look at this! https://…"). */
function pickUrl(text: string): string | null {
  const t = text.trim();
  const found = t.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (found) return found.replace(/[.,;:!?]+$/, '');
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) return `https://${t}`;   // "argos.co.uk/product/123" without the https://
  return null;
}
const smooth = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function WishRow({ item, first, last, fresh, onMove, onEdit, onRemove }: {
  item: OwnerItem; first: boolean; last: boolean; fresh: boolean; onMove: (dir: -1 | 1) => void; onEdit: () => void; onRemove: () => void;
}) {
  // the shop's page didn't say: prices are optional, and the owner can add one with Edit
  const meta = wishMeta(item.shop, item.price, item.currency, 'No price');
  return (
    <li className={`wish owner ${fresh ? 'fresh' : ''}`} data-wish={item.id}>
      <span className="wish-text">
        <span className="wish-title">{item.title}</span>
        {meta && <span className="wish-meta">{meta}</span>}
      </span>
      <span className="wish-tools">
        <span className="move">
          <button type="button" className="iconbtn" aria-label={`Move ${item.title} up`} disabled={first} data-focus={`${item.id}:up`} onClick={() => onMove(-1)}><Icon name="up" /></button>
          <button type="button" className="iconbtn" aria-label={`Move ${item.title} down`} disabled={last} data-focus={`${item.id}:down`} onClick={() => onMove(1)}><Icon name="down" /></button>
        </span>
        <button type="button" className="btn text small" aria-label={`Edit ${item.title}`} data-focus={`${item.id}:edit`} onClick={onEdit}>Edit</button>
        <button type="button" className="iconbtn" aria-label={`Remove ${item.title}`} onClick={onRemove}><Icon name="close" /></button>
      </span>
    </li>
  );
}

function WishEdit({ item, onDone }: { item: OwnerItem; onDone: (saved: OwnerItem | null) => void }) {
  const [title, setTitle] = useState(item.title), [price, setPrice] = useState(priceText(item.price, item.currency)), [url, setUrl] = useState(item.url ?? '');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim(), minor = parsePrice(price, item.currency), link = url.trim();
    const problem = !name ? 'Give the wish a name.'
      : minor === undefined ? `Enter a price like ${priceText(2499, item.currency)}, or leave it empty.`
      : link && !/^https?:\/\//i.test(link) ? 'Links start with http:// or https://.' : '';
    setErr(problem);
    if (problem) return;
    setBusy(true);
    try { const r = await api<{ item: OwnerItem }>('items/update', { id: item.id, title: name, url: link || null, price: minor }); onDone(r.item); }
    catch (x) { setErr(message(x)); setBusy(false); }
  };
  return (
    <li className="wish editing">
      <form className="wish-form" onSubmit={save} noValidate onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone(null); } }}>
        <Field label="Name" value={title} onChange={setTitle} maxLength={LIMITS.title} hint="Put details like colour or size in the name." autoFocus />
        <Field label={`Price (${currencySymbol(item.currency)})`} value={price} onChange={setPrice} inputMode="decimal" placeholder="Leave empty if you're not sure" maxLength={16} />
        <Field label="Link" type="url" inputMode="url" value={url} onChange={setUrl} maxLength={LIMITS.url} autoCapitalize="none" spellCheck={false} />
        <ErrorText>{err}</ErrorText>
        <div className="row">
          <button className="btn small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn text small" onClick={() => onDone(null)}>Cancel</button>
        </div>
      </form>
    </li>
  );
}

/** Rename the list or move its date. After the day only the name changes: "Reuse this list" is how it gets a new day. */
function DetailsForm({ list, onDone }: { list: OwnerList; onDone: (l: OwnerList | null) => void }) {
  const [title, setTitle] = useState(list.title), [date, setDate] = useState(list.eventDate);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim(), dateChanged = !list.revealed && date !== list.eventDate;
    const problem = !name ? 'Give your list a name.' : dateChanged && !okEventDate(date) ? 'Pick a date between today and two years from now.' : '';
    setErr(problem);
    if (problem) return;
    setBusy(true);
    try { const r = await api<{ list: OwnerList }>('lists/update', { id: list.id, title: name, ...(dateChanged ? { eventDate: date } : {}) }); onDone(r.list); }
    catch (x) { setErr(message(x)); setBusy(false); }
  };
  return (
    <form className="form details" onSubmit={save} noValidate onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone(null); } }}>
      <h1 className="sr-only">{list.title}</h1>
      <Field label="Name" value={title} onChange={setTitle} maxLength={LIMITS.title} autoFocus />
      {!list.revealed && <Field label="Date" type="date" value={date} onChange={setDate} min={isoDay()} max={isoDay(0, 2)} />}
      <ErrorText>{err}</ErrorText>
      <div className="row">
        <button className="btn small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn text small" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </form>
  );
}

/** A sheet with one action: runs it, shows what went wrong if it fails. */
function useAction() {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return { busy, err, run, reset: () => setErr('') };
}

function NewLinkSheet({ open, list, onClose, onDone }: { open: boolean; list: OwnerList; onClose: () => void; onDone: (l: OwnerList) => void }) {
  const a = useAction();
  const [clearGrants, setClearGrants] = useState(false);
  const close = () => { a.reset(); setClearGrants(false); onClose(); };
  return (
    <Sheet open={open} onClose={close} title="Get a new link?">
      <p className="lede">The old link will stop working. Anyone you've sent it to will need the new one. Your wishes stay as they are, and so do grants unless you clear them.</p>
      {/* for a link that got out and had wishes marked as granted; clearing them all gives nothing away about which */}
      <label className="check"><input type="checkbox" checked={clearGrants} onChange={e => setClearGrants(e.target.checked)} />
        <span>Also clear all grants, in case someone marked wishes they aren't buying. Anyone who really granted one will need to grant it again.</span></label>
      <ErrorText>{a.err}</ErrorText>
      <button type="button" className="btn" disabled={a.busy} onClick={() => a.run(async () => { onDone((await api<{ list: OwnerList }>('lists/new-link', { id: list.id, clearGrants })).list); setClearGrants(false); })}>
        {a.busy ? 'Making a new link…' : clearGrants ? 'Get a new link and clear grants' : 'Get a new link'}</button>
      <button type="button" className="btn text" onClick={close}>Cancel</button>
    </Sheet>
  );
}

function DeleteListSheet({ open, list, onClose }: { open: boolean; list: OwnerList; onClose: () => void }) {
  const a = useAction();
  const close = () => { a.reset(); onClose(); };
  return (
    <Sheet open={open} onClose={close} title="Delete this list?">
      <p className="lede"><strong>{list.title}</strong>{list.items.length ? ` and its ${plural(list.items.length, 'wish', 'wishes')}` : ''} will be gone for good, and its link will stop working.</p>
      <ErrorText>{a.err}</ErrorText>
      <button type="button" className="btn danger" disabled={a.busy} onClick={() => a.run(async () => { await api('lists/delete', { id: list.id }); navigate('/lists', true); })}>
        {a.busy ? 'Deleting…' : 'Delete list'}</button>
      <button type="button" className="btn text" onClick={close}>Cancel</button>
    </Sheet>
  );
}

function RemoveSheet({ item, onClose, onDone }: { item: OwnerItem | null; onClose: () => void; onDone: (item: OwnerItem) => void }) {
  const a = useAction();
  const close = () => { a.reset(); onClose(); };
  return (
    <Sheet open={!!item} onClose={close} title="Remove this wish?">
      {item && <>
        <p className="lede"><strong>{item.title}</strong> will be taken off your list.</p>
        <ErrorText>{a.err}</ErrorText>
        <button type="button" className="btn danger" disabled={a.busy} onClick={() => a.run(async () => { await api('items/delete', { id: item.id }); onDone(item); })}>
          {a.busy ? 'Removing…' : 'Remove'}</button>
        <button type="button" className="btn text" onClick={close}>Cancel</button>
      </>}
    </Sheet>
  );
}
