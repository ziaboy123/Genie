// The undo tokens for wishes this browser granted, kept per list as { [itemId]: token }. Visitors have no account,
// so this is the only thing that says "you granted this": whoever holds the token can undo the grant, nobody else.
// The share page clears a list's tokens once its day has passed, since grants can't be undone after that.
// Storage can be blocked or full (private windows); then grants still work, they just can't be undone later.

const key = (code: string) => `genie:grants:${code}`;

export function readGrants(code: string): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key(code)) ?? '{}');
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [id, token] of Object.entries(raw)) if (typeof token === 'string' && token.length <= 64 && id.length <= 64) out[id] = token;
    return out;
  } catch { return {}; }
}

export function writeGrants(code: string, grants: Record<string, string>) {
  try {
    if (Object.keys(grants).length) localStorage.setItem(key(code), JSON.stringify(grants));
    else localStorage.removeItem(key(code));
  } catch {}
}

export function saveGrant(code: string, itemId: string, token: string) {
  writeGrants(code, { ...readGrants(code), [itemId]: token });
}

export function dropGrant(code: string, itemId: string) {
  const grants = readGrants(code);
  delete grants[itemId];
  writeGrants(code, grants);
}
