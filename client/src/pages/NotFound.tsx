// One page for anything that isn't there. Bad and old share links all get the same answer, so nobody can tell
// a code that never existed from one that was replaced.
import { Link } from '../lib/router.tsx';
import { Page, TopBar, useTitle } from '../components/ui.tsx';

export function NotFound({ title = 'Page not found', text = "There's nothing at this address. It may have moved, or the link has a typo.", link }: {
  title?: string; text?: string; link?: { to: string; label: string };
}) {
  useTitle(title);
  const go = link ?? { to: '/', label: 'Make your own list' };
  return (
    <Page slim className="notfound">
      <TopBar />
      <div className="notfound-body">
        <h1 className="title">{title}</h1>
        <p className="lede">{text}</p>
        <Link to={go.to} className="strong-link">{go.label}</Link>
      </div>
    </Page>
  );
}

export const ListNotFound = () => <NotFound title="List not found" text="This link doesn't work any more. Ask the person who sent it for a new one." />;
