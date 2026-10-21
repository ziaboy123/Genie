// Who's logged in, shared by every page.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Me } from '@genie/shared';
import { fetchMe } from './api.ts';

interface Session {
  me: Me | null; loading: boolean;
  /** Finding out who's logged in keeps failing (the server is unreachable); it keeps trying. */
  trouble: boolean;
  /** False on a server without a database: there are no accounts or lists. */
  accounts: boolean;
  setMe: (me: Me | null) => void; refresh: () => Promise<void>;
}
const Ctx = createContext<Session>({ me: null, loading: true, trouble: false, accounts: true, setMe: () => {}, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [accounts, setAccounts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [trouble, setTrouble] = useState(false);
  const retrying = useRef(false);
  // if the server can't be reached, keep what we know and try again (a slow connection shouldn't log you out)
  const refresh = useCallback(async (): Promise<void> => {
    try { const r = await fetchMe(); setAccounts(r.accounts); setMe(r.me); setTrouble(false); setLoading(false); }
    catch {
      setTrouble(true);
      if (retrying.current) return;   // one retry loop at a time
      retrying.current = true;
      await new Promise(res => setTimeout(res, 3000));
      retrying.current = false;
      return refresh();
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // a call came back "log in again": check, and if the login really has gone, the pages send you to Log in
  useEffect(() => {
    const recheck = () => { refresh(); };
    addEventListener('genie:recheck', recheck);
    return () => removeEventListener('genie:recheck', recheck);
  }, [refresh]);

  return <Ctx.Provider value={{ me, loading, trouble, accounts, setMe, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
