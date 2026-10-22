// What the browser app and the server send each other. Everything under <base>/api is JSON.
// Errors always come back as { error: string } with a 4xx/5xx status.

/** The logged-in person. */
export interface Me {
  id: string;
  email: string;
  name: string;
}

/** A list in "My lists". */
export interface ListSummary {
  id: string;
  title: string;
  /** The day it's for, as YYYY-MM-DD. */
  eventDate: string;
  shareCode: string;
  wishCount: number;
  /** True from the day after eventDate: grants are no longer secret from the owner. */
  revealed: boolean;
  /** Only once revealed (null before), so the owner can't find out early. */
  grantedCount: number | null;
}

/** A wish as its owner sees it in the editor. Grant state only appears after the reveal. */
export interface OwnerItem {
  id: string;
  title: string;
  url: string | null;
  shop: string | null;
  /** In minor units (pence), or null if unknown. */
  price: number | null;
  currency: string;
  /** Only once the list is revealed; null before. */
  granted: boolean | null;
}

export interface OwnerList extends ListSummary {
  items: OwnerItem[];
}

/**
 * A wish as a visitor sees it on the share page.
 * open: nobody has granted it. granted: someone else has. mine: this browser granted it (it holds the undo token).
 * hidden: the viewer is the list's owner before the reveal, so no grant state is shown at all.
 */
export type WishState = 'open' | 'granted' | 'mine' | 'hidden';

export interface PublicItem {
  id: string;
  title: string;
  url: string | null;
  shop: string | null;
  price: number | null;
  currency: string;
  state: WishState;
}

export interface PublicList {
  /** Stays the same when the owner gets a new link (unlike the share code), so the browser files its undo tokens
   *  under it. Not the list's id: it can't be used for anything else. */
  key: string;
  title: string;
  ownerName: string;
  eventDate: string;
  revealed: boolean;
  /** The logged-in viewer owns this list (grants stay hidden from them until the reveal). */
  isOwner: boolean;
  items: PublicItem[];
}

// ---------- request bodies (POST JSON) ----------
// auth/*: see server/src/auth/routes.ts
export interface CreateListBody { title: string; eventDate: string }
export interface UpdateListBody { id: string; title?: string; eventDate?: string }
export interface AddItemBody { listId: string; url: string }
export interface UpdateItemBody { id: string; title?: string; url?: string | null; price?: number | null }
export interface ReorderBody { listId: string; ids: string[] }
/** View a share page; tokens are this browser's grant undo tokens (from localStorage), so its own grants show as "mine". */
export interface ViewBody { code: string; tokens: string[] }
export interface GrantBody { code: string; itemId: string }
export interface UngrantBody { code: string; itemId: string; token: string }

/** Limits both sides check (the server is the one that counts). */
export const LIMITS = {
  title: 120,          // list and wish names
  name: 40,            // a person's display name
  url: 2000,
  itemsPerList: 100,
  listsPerUser: 50,
  maxPrice: 100_000_00, // £100,000 in pence
} as const;

/** Share codes: 8 letters and digits. Anything else is a 404 before it touches the database. */
export const SHARE_CODE = /^[A-Za-z0-9]{8}$/;

// Characters that never belong in a name someone else reads: control characters, and every invisible "format"
// character (Unicode category Cf: zero-width spaces, soft hyphens, direction marks and overrides, the Arabic letter
// mark, invisible maths operators, tag characters), which could hide text or change how a name or shop reads. Going
// by category catches the ones a hand-made list misses. Kept: the joiners some scripts and emoji need (U+200C, U+200D),
// and the tag characters inside England's, Scotland's and Wales's flags (exactly those three: tags spelling anything
// else after a black flag are hidden ASCII text, so they go). Also gone: the Hangul fillers (letters that draw nothing)
// and half an emoji (a lone surrogate, left by cutting text in the wrong place).
const HIDDEN = /(\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F})|(\p{Cc})|[\p{Cf}\p{Cs}\u115F\u1160\u3164\uFFA0]/gu;
const JOINER = /^[\u200C\u200D]$/;
// accents (and the joiners between them) piled on one letter: kept to 4, since a pile draws over the line below
const PILE = /([\p{Mn}\p{Me}\u200C\u200D]{4})[\p{Mn}\p{Me}\u200C\u200D]+/gu;
/** One line of text, as names and titles are kept (lists, wishes, titles read from shops): hidden characters out,
 *  at most 4 accents stacked on one letter, spaces collapsed, nothing invisible left at either end. */
export function plainLine(s: string): string {
  return s.replace(HIDDEN, (c, flag, control) => (flag ? c : control ? ' ' : JOINER.test(c) ? c : ''))
    .replace(PILE, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\u200C\u200D]+|[\s\u200C\u200D]+$/g, '');   // a joiner with nothing to join at either end goes too
}
