// The site's pages and who may see them. Share pages, Privacy and Terms are for everyone and don't wait to find out
// who's logged in; signed-out pages send logged-in visitors to My lists; everything else needs a login.
import type { ComponentType } from 'react';
import { Redirect, rememberPath, usePath } from './lib/router.tsx';
import { useSession } from './lib/session.tsx';
import { Page } from './components/ui.tsx';
import { Forgot, LogIn, SignUp } from './pages/Auth.tsx';
import { Editor } from './pages/Editor.tsx';
import { Home } from './pages/Home.tsx';
import { Privacy, Terms } from './pages/Legal.tsx';
import { MyLists } from './pages/MyLists.tsx';
import { NewList } from './pages/NewList.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { Reveal } from './pages/Reveal.tsx';
import { Settings } from './pages/Settings.tsx';
import { Wishlist } from './pages/Wishlist.tsx';

const PUBLIC: Record<string, ComponentType> = { '/privacy': Privacy, '/terms': Terms };
const SIGNED_OUT: Record<string, ComponentType> = { '/': Home, '/signup': SignUp, '/login': LogIn, '/forgot': Forgot };
const SIGNED_IN: Record<string, ComponentType> = { '/lists': MyLists, '/lists/new': NewList, '/settings': Settings };
const LIST = /^\/lists\/([0-9a-f-]{36})(\/reveal)?$/i;

export function App() {
  const { me, loading, trouble } = useSession();
  const path = usePath();

  const Public = PUBLIC[path];
  if (Public) return <Public />;
  const share = /^\/w\/([^/]+)$/.exec(path)?.[1];
  if (share !== undefined) return <Wishlist key={share} code={share} />;

  const SignedOut = SIGNED_OUT[path], SignedIn = SIGNED_IN[path], list = LIST.exec(path);
  if (!SignedOut && !SignedIn && !list) return <NotFound />;
  if (loading) return <Page>{trouble && <p className="loading-text" role="status">Can't reach Genie. Check your connection. Trying again…</p>}</Page>;

  if (SignedOut) return me ? <Redirect to="/lists" /> : <SignedOut />;
  if (!me) { rememberPath(path); return <Redirect to="/login" />; }   // come back here after logging in
  if (list) return list[2] ? <Reveal key={path} id={list[1]} /> : <Editor key={path} id={list[1]} />;
  return SignedIn ? <SignedIn key={path} /> : <NotFound />;
}
