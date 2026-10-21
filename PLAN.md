# Genie: the plan

A wishlist site. You make a list of things you want (each with a link), send one link to family and friends, and they pick what to get you. Visitors can secretly "grant" a wish so nobody buys the same thing twice. You never see what's been granted until after the day.

Lives at `daniyalzia.co.uk/genie`. Anyone can make a list, not just Daniyal.

---

## 1. The idea in one picture

```
 YOU (owner)                                  FAMILY / FRIENDS (visitors)
 ───────────                                  ───────────────────────────
 /genie  → sign up / log in   (visitors never need an account)
    │
    ▼
 My lists → new list (title, occasion, date)
    │
    └── SHARE link (send this one) ─────┬──────►  /genie/w/<code>
                                        │            │
 editor: paste a shop URL               │            ├── see the wishes (cards)
   → Genie fetches name + price         │            ├── "View in shop"
   → reorder, remove                    │            └── "Grant this wish"
   → you never see grants               │                 → others see it's taken
                                        │                 → you don't
 after the event date:  ◄───────────────┘
   "Your wishes were granted" reveal
```

**The metaphor runs through everything:** you *make wishes*, visitors *grant* them, granted items say *Granted*. Your top three wishes get pinned (the genie's three wishes).

---

## 2. How it works

### Accounts for list owners, nothing for visitors
- **Owners sign up and log in** to make and edit lists. All their lists live under **My lists** on any device, and nothing is lost if a browser is cleared.
- **Visitors never need an account.** Family open the share link and grant straight away. A login wall there would lose half of them.
- **Sign-in uses Millennium Arena's tested setup, ported over:**
  - email + password;
  - an emailed 6-digit code at sign-up, on a new device (then trusted for 30 days) and for password reset;
  - mail sent through Resend, which is already set up for the domain.
- **Genie has its own accounts, separate from Arena/DeckForge.** Your nan making a birthday list shouldn't end up in a Yu-Gi-Oh app's user table, and a problem in one app can't spread to the other.
- Settings: change your name, email and password, log out everywhere, delete your account (which deletes your lists).

Each list has one **share link**, `/genie/w/<code>`: a random, unguessable code. The owner can **regenerate** it if it ends up somewhere it shouldn't, which kills the old link.

### Adding a wish
1. Paste a shop link.
2. The server fetches the page and reads its preview data (Open Graph tags plus the product data shops embed for Google) to get the **name, price and shop**. No pictures: the link opens the shop's own page, which always has the current photo (decided 2026-10-20: no copied shop photos, no image decoding, nothing to clean up).
3. A preview card fills in ("the genie is fetching…"). You can fix the name or price (put details like "black, M" in the name).
4. If the shop blocks it, you type the details yourself. **Amazon often blocks this kind of fetch**, so manual entry is a normal path rather than an error. As a fallback, Genie guesses a title from the URL.

Extras: tracking junk is stripped from links (`utm_*`, `fbclid`…), and prices show as "£24.99 when added" because they change.

### Granting a wish (the anonymous claim)
- A visitor presses **Grant this wish**, then confirms: "You're getting this? Others will see it's taken. Daniyal won't."
- The card becomes **Granted** for every visitor and moves to the bottom. Nobody's name is shown.
- Only the person who granted it can undo it. Their browser holds a private undo token; nobody else's does.
- If two people press it at the same moment, one wins and the other sees "Someone just granted this one."

**Keeping it secret from the owner:**
- The editor never shows grants.
- If you're logged in and open your own share link, Genie knows it's your list and hides grants with a note ("Your list: grants are hidden so it stays a surprise"). Because it uses your account, this works on any device where you're logged in.
- **Honest limit:** the share link is the same for everyone, so you *could* peek from someone else's phone or a logged-out browser. Visitors don't have accounts, so that can't be prevented; it's on the honour system.

**The reveal:** after the event date, the editor shows **"Your wishes were granted"** with which ones were taken. It's fun, and it tells you what to remove or mark as received. There are still no names.

### Other owner tools
- **Got it already**: mark a wish as received, which hides it from visitors.
- **Delete**: if someone had already granted it, their device shows "removed from the list" so they're not left confused.
- **Reset after the event**: clears all grants, so a birthday list can become next year's list.

---

## 3. Pages

| Page | Who | What's on it |
|---|---|---|
| **Home** `/genie` | Everyone | What Genie is, "Make a wish list" (→ sign up), log in |
| **Sign up / Log in / Code / Reset** | Owner | Email + password, 6-digit code screen, forgot password |
| **My lists** | Owner | All your lists as cards (title, date, countdown, number of wishes), "New list" |
| **Create** | Owner | Title, occasion (birthday / Christmas / other), date → then the "here's your share link" screen |
| **Settings** | Owner | Name, email, password, log out everywhere, delete account |
| **Editor** | Owner | Share link + Copy, paste a link + Add, the list with Edit and Remove, reorder; the reveal after the date |
| **Wishlist** `/genie/w/<code>` | Visitors | Name, date and countdown, one plain list, Grant (with one confirm) and Undo |
| **Not found** | Anyone | One generic page for any bad code, so nobody can probe which codes exist |

**Mobile first:** family will mostly open the link on their phones from WhatsApp.

**When you send the share link** in WhatsApp or iMessage, the preview shows the list's title, whose list it is and how many wishes it has ("Daniyal's wishlist on Genie · 12 wishes"). No preview image.

---

## 4. Look and feel (decided in Claude Design, 2026-10-20)

Design canvas: https://claude.ai/artifact/BqdXftPXnLdZTFudu5PNwQ (private).

- **Light and simple.** Daniyal's call: it's for gifting and all ages, and the first pass was "overcomplicated for what it is". **Rule: cut before adding.**
- **The style:**
  - pale lavender ground `#f4f5ff`, white cards, deep indigo text `#1d2150`;
  - one action colour, indigo `#3b3fc4`;
  - teal `#0b7468` for "Granted";
  - gold `#f2b01e` only in the Home illustration;
  - fonts: Bricolage Grotesque (headings) and DM Sans (body).
- **Wishlist page = one plain list,** like PCPartPicker's list pages (his original inspiration):
  - each row: name, shop · price (or "Open the link for the price"), one **Grant** button;
  - visitors can sort by price, high to low or low to high (granted wishes stay at the bottom);
  - tapping a row opens the shop;
  - granted rows sink to the bottom;
  - one "Getting this?" confirm;
  - no filters, no top-wish sections and no separate notes (put details like "black, M" in the name).
- **The magic lives in one place:** the Home illustration (a lamp whose smoke carries wish cards up, with gentle motion that respects reduced motion).
- **Screens on the canvas:** Wishlist (phone + desktop), New list → share link, Sign up + code, My lists, Reveal, Not found, Home, Editor.
- **Cut for now:** occasion picker (the list name covers it), top wishes, filters, "move to Christmas", copy-as-text, share sheet.

## 5. Tech

| Part | Choice | Why |
|---|---|---|
| Server | Node 22 + TypeScript on plain `node:http` (no framework), run with tsx | Small, few dependencies; matches Millennium Arena's Node setup |
| Frontend | Vite + React | Claude Design hands off cleanly into it; builds to static files that work under a strict CSP |
| Database | Postgres 14 already on the apps LXC: `genie` (live) and `genie_dev` (dev, over the SSH socket tunnel like `arena_dev`) | Never a database on the Mac |
| Link fetching | Genie's own guarded fetcher (`server/src/unfurl/safefetch.ts`) | Blocks private and LAN addresses (see Security) |
| Hosting | apps LXC, systemd service as its own `genie` user with a hardening drop-in (like Cipher), nginx `location /genie/`, Cloudflare in front | Same pattern as Cipher |
| Deploy | `deploy genie` recipe in `~/Claude/bin/deploy.sh` | His usual flow |
| Preview | `~/Developer/Previews/Genie.command` + VSCode task + launch.json `genie` | His usual flow |
| Monitoring | Add to Umbros's outside-in site checks | Same as the other live sites |

### Data
What the code actually stores (all in the `genie` schema; `server/src/db/index.ts` has the migrations):
```
users     id, email (unique), name, password (bcrypt), session_version,     ┐
          created_at, last_seen_at, warned_at                               │ ported from
codes     email, purpose, code_hash, payload, attempts, expires_at          │ Arena's auth
sessions  token_hash, user_id, session_version, created_at, last_seen,      │
          expires_at, user_agent                                            │
devices   token_hash, user_id, label ("Chrome on Mac"), created_at, expires_at ┘

lists   id, user_id, title, event_date, share_code (unique), created_at, updated_at
items   id, list_id, position, title, url, shop, price (pence), currency, created_at
grants  item_id (one grant per item), undo_hash, created_at
```
Clean-up (`server/src/auth/inactive.ts`, daily): an account unused for 23 months gets one warning email (`warned_at`), and it's deleted, with everything in it, once it's 24 months unused and the warning is at least 30 days old. Using the account clears the warning. An account with a list whose day is coming up (or was in the last 30 days) is neither warned nor deleted. An address Resend refuses for good counts as warned, once another warning in the same run has gone out, so a few dead addresses can't hold up the queue. Deleting an account deletes everything at once. Expired codes, sessions and devices are swept every 6 hours (codes as soon as they expire). The privacy page says all of this.

---

## 6. Security (Cipher-level, because it takes links from strangers)

- **Link fetching is the big risk.** The server fetches any URL someone pastes, so it must refuse anything pointing inside the network. A stranger could otherwise use Genie to poke at the homelab (10.68.x, Proxmox, the router).
  - Block private, loopback, link-local and IPv6-local addresses.
  - Re-check after every redirect (max 3).
  - Pin the resolved IP, which stops DNS rebinding.
  - http/https on ports 80/443 only, 5 s to answer and 8 s in all, 2 MB page cap.
  - Honest and polite (the Terms' "For shops and site owners" part): GenieBot names itself in its user agent with a link to that part, fetches only a pasted link (once per paste), never crawls, **never re-fetches prices on a schedule**, and never uses headless browsers, proxies or a faked browser user agent to get past bot walls (a blocked shop just means typing the details). Sites that ask by email are excluded with `GENIE_NO_FETCH` (comma-separated domains, set on the server).
- **Phishing on your domain:** anyone can make a list, so someone could fill one with dodgy links under `daniyalzia.co.uk`. To reduce this:
  - every card shows the real shop domain;
  - list creation and adding items are rate-limited;
  - share pages are `noindex`;
  - every share page has a "Report this list" email link with the address shown next to it, and `server/scripts/remove-list.ts` deletes a list (or with `--account` the whole account), an account by email (`--email`) or one wish (`--wish`) after a report. See `docs/compliance/handling-reports.md`.
- **Strict CSP** (`'self'` only, no inline JS), the same as Cipher.
- **Rate limits** key on `CF-Connecting-IP`, not nginx's 127.0.0.1.
- Item links must be http(s), never `javascript:`. Every text field has a length cap, and all input is checked on the server.
- `Referrer-Policy: no-referrer`, so shops never see a list's URL.
- Outbound links use `noopener noreferrer`.
- No request logging, with `access_log off` on `/genie` (a launch gate: see Legal below).
- **Accounts, done like Arena:**
  - passwords hashed with bcrypt (cost 12);
  - login and device tokens and email codes stored only as hashes;
  - codes expire in 10 minutes and allow 5 tries;
  - rate limits on login, sign-up and code sending (which also protects the Resend quota);
  - the same response whether or not an email is registered, so nobody can check who has an account.
- **Two cookies, both strictly necessary, so no banner:** the login session (`genie_session`) and a trusted device (`genie_device`, 30 days, set at sign-up or at login when "Trust this device" is left ticked, as it is by default). Both HttpOnly, Secure, SameSite=Strict, Path=/genie. Visitors get no cookie; their grant undo token lives in their browser's localStorage.
- Every edit request checks that the logged-in user owns the list.
- The Postgres role `genie` only has rights on its own database.
- A Sweeper pass before Genie is shared publicly.

### Legal and online safety (reviewed 20 October 2026, fact-checked 21 October 2026)

- **Privacy page** (`/privacy`): a full UK GDPR notice in plain English: Daniyal as controller; what's kept for owners and visitors; lawful bases (contract; legitimate interests for security, rate limits, reading links, grants, backups, reports; legal obligation for NCA reports); Resend, Cloudflare and Microsoft, which hosts Daniyal's inbox (US companies, UK-US data bridge); retention (accounts until deleted or 2 years unused, logins 30 days, codes 10 minutes, backups 14 days, report emails 6 months, NCA report copies 1 year); cookies and storage (strictly necessary, so no banner; grant keys cleared after the day); rights, complaints (DPA 2018 s.164A: acknowledge within 30 days) and the ICO; 13+. **If the code changes what's stored, change the page.**
- **Terms** (`/terms`): 13+ (under-18s check with a parent), cover visitors too, what's not allowed (including all of the Online Safety Act's primary priority content, s.12(5)), "Keeping children safe" (s.12(9) and (11)), your content stays yours, Genie isn't a shop, no warranty (but nothing that can't be limited is), ending accounts, England and Wales law, "Reporting content and complaints" (Online Safety Act ss.10, 20, 21; CSAM to the NCA under s.66; no automated scanning; appeals answered within 14 days), rights-holders, and "For shops and site owners" (GenieBot).
- **Share pages** have "Report this list" (a mailto with the link filled in, and the address written out next to it) and Privacy · Terms. Home, My lists and Settings have the Privacy · Terms footer. **Sign-up** says "By signing up you agree to the Terms and confirm you're 13 or older. If you're under 18, check with a parent or guardian first."
- **Online Safety Act records** (ss.9, 23, 35) in `docs/compliance/`: the illegal content risk assessment, the children's access and risk assessment, a one-page DPIA, and the report-handling steps. Daniyal is the accountable person. Review them every October, and before any big change (pictures, comments, group gifts, names on grants, public lists, visitor accounts, affiliate links). The report log itself lives outside the repo.
- **Affiliate links:** only with an "Ad" label on each one and a note on the privacy and terms pages; never rewrite owners' links silently; Amazon only through Associates. Earning money also means redoing the ICO fee check.
- **Launch gates (phase 3). Genie doesn't go live until both are done and checked**, because the privacy page already says them:
  1. **No visit logs.** `access_log off;` in nginx's `location /genie/` (and `/genie` itself), then `nginx -t`, load a share page, and check no access-log line was written. Check cloudflared isn't logging requests either. (Privacy: "Genie's server doesn't keep a log of visits.")
  2. **Nightly backup.** Add `genie` to the database list in the pg-nightly-backup script on the apps LXC (same 14-copy pruning), then check a genie dump is in `/var/backups/postgres` the next morning. Add it to RESTORE.md if the script's database list is recorded there. (Privacy: "backed up every night and each backup is kept for 14 days"; handling-reports.md restores wrongly removed lists from it.)

  If either can't be done in time, change the privacy page's sentence (and handling-reports.md's restore step) before going live, never after.
- **NCA reporting portal:** not registered in advance. Registration happens only if a report is ever needed (handling-reports.md, under the 2026 Regulations, SI 2026/268).
- **At launch (phase 4):** add Genie to daniyalzia.co.uk/privacy (and its Resend sentence, noting that Genie is the exception to its server-logs sentence) and /terms; add a LICENSE before the repo goes public; a quick UK IPO search for "Genie" in classes 35 and 42.

---

## 7. Build order

| Phase | What | Done when |
|---|---|---|
| **0. Design** | Claude Design mock-ups of the screens in §4 | He likes the Wishlist page on a phone |
| **1. Core** | Accounts (port Arena's auth; mail printed locally in dev), My lists, create list, add by URL (with fetching + SSRF guard), share page, grant and undo, against `genie_dev` | He can sign up, make a real list locally and grant from a second browser |
| **2. Magic** | Reorder, countdown, link previews (title and wish count), Home illustration, post-event reveal, reuse list | It feels finished on a phone |
| **3. Ship** | Postgres `genie` db and role, systemd + hardening, nginx, deploy recipe, Umbros check, Sweeper pass. **Launch gates (§6):** `genie` in the nightly 14-day backup, and `access_log off` for `/genie` | Both launch gates checked, then live at `/genie` and survives Sweeper |
| **4. Show off** | LICENSE, Genie on the site-wide privacy and terms pages, repo public, then the portfolio, GitHub and LinkedIn sweep | All three updated |

Server setup (phase 3) needs his go-ahead. Auto mode blocks SSH writes from chats, so it may run from the Proxmox deployment chat like Cipher's did.

---

## 8. Later, maybe
- Quantities ("socks ×3", partly granted)
- Optional visitor login, so your grants follow you across devices (it still wouldn't close the peek loophole)
- Passkeys as a login option
- Optional first names on grants, visible only to other visitors
- Group gifts (several people chip in on one big wish)
- Browser "Add to Genie" share button
