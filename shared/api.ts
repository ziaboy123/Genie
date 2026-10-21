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
