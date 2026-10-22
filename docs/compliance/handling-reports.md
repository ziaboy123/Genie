# Handling reports, complaints and takedowns

For Daniyal, who is the person accountable for Genie's online safety. Written 20 October 2026, updated 22 October 2026. It turns what the Terms and Privacy page promise into steps.

## What arrives, and where

Everything comes to mail@daniyalzia.co.uk:

| Subject | From | Promise made |
|---|---|---|
| "Report a Genie list" (from the share page's link; the body has the list's link) | Anyone | Read by a person, dealt with promptly, reporter told what was done |
| "Complaint" | Owners whose list was removed, or reporters | Looked at again, answer explaining the decision |
| "Data protection complaint" | Anyone | Acknowledged within 30 days, kept informed, outcome given (DPA 2018 s.164A) |
| Rights requests (copy, correct, delete, object) | Owners | Reply within a month |
| "GenieBot" | Shops and site owners | Their domain excluded |

Aim to deal with a report within 48 hours, and the same day for anything involving a child or a threat.

## A report about a list

1. **Read it.** If it mentions child sexual abuse, or a child at risk, go straight to the next section.
2. **Look at the list** by opening its share link in a private window (logged out). That tells the owner nothing. Don't click wish links unless you need to: for a suspected scam, check the domain shown on the wish, or look the link up with Google's Safe Browsing site status page instead of opening it.
3. **Decide** against the Terms ("What's not allowed"). Illegal, or breaks the rules: remove it. Serious (scams, hate, threats, sexual content) or a repeat: delete the whole account. Neither: no action. If it's not clearly against the rules, leave it up: people's lists are their own speech (OSA s.22 asks for free expression and privacy to be weighed).
4. **Remove it** with the script (below).
5. **Tell the owner** by email what was removed, which rule it broke, and that they can reply with "Complaint" to appeal. Skip this only for child sexual abuse cases, or if telling them would put someone at risk.
6. **Reply to the reporter**: removed, or looked at and left up (and why, briefly).
7. **Log it** (see the end).

### The removal script

On the server, in Genie's `server` folder (wherever `deploy genie` puts it):

```sh
sudo -u genie env PGHOST=/var/run/postgresql PGUSER=genie PGDATABASE=genie ../node_modules/.bin/tsx scripts/remove-list.ts <share code, list id or share link>
```

It prints the list's name, link, date, its wishes (each with its id) and the owner's name and email, then waits for you to type `yes`. Anything else stops it with nothing changed, so it's also a safe way to look a list up. Add `--account` to delete the owner's whole account (every list, wish, grant, login and trusted device). Nothing is cached, so the link shows "not found" at once. It prints a line to copy into the log.

Other ways to use it (same `sudo -u genie env ...` start):

- `scripts/remove-list.ts --email <address>`: the whole account with that email, found without a list. It shows the account and its lists first.
- `scripts/remove-list.ts --wish <wish id>`: **one wish** rather than the whole list (for example a rights-holder's request). Look the list up first to get the wish's id.

A list whose link was changed after the report has a new code, and the old code isn't kept anywhere. Ask the reporter, or find it by the owner's email (`--email <address>` lists their lists; type anything but `yes` to stop there), or by title:

```sh
sudo -u genie psql genie -c "select share_code, title, event_date from genie.lists where title ilike '%birthday%'"
```

## Child sexual abuse material or exploitation (CSEA)

The law: UK providers must report CSEA content they find to the National Crime Agency (OSA s.66). The Online Safety (CSEA Content Reporting by Regulated User-to-User Service Providers) Regulations 2026 (SI 2026/268) apply from 7 April 2026. Section 66(1) came into force on 7 April 2026 (SI 2026/262). The 2025 regulations (SI 2025/368) were revoked and never applied. Check Ofcom's guidance page at each review. Reporting to the IWF instead doesn't count.

**Registering:** Genie isn't registered on the NCA's CSEA Industry Reporting Portal (https://www.uk-child-sexual-abuse-industry-reporting.gov.uk/home) in advance (decided 20 October 2026). Registration happens only if a report is ever needed, as the first part of step 4. It asks for the provider's name, address and country, and names, emails and phone numbers for an organisation administrator (you), an emergency contact and anyone else allowed to report. Once registered, keep these up to date.

**When it happens:**

1. **A child in immediate danger: call 999 first.**
2. **Never open a link reported as child sexual abuse material.** Judge it from the report, the wish names and the domains (the share page is only text, and the removal script prints them too). Don't download, screenshot, copy or forward anything, and never send it to anyone except through the portal. If it plausibly is CSAM, remove it and report the URL to the NCA as reported (and optionally to the IWF, whose analysts are the right people to look).
3. **Keep what the rules require, then remove it**, in one go:
   ```sh
   sudo -u genie env PGHOST=/var/run/postgresql PGUSER=genie PGDATABASE=genie ../node_modules/.bin/tsx scripts/remove-list.ts <code> --account --keep /var/lib/genie-csea/<YYYY-MM-DD>-<code>.json
   ```
   (Make `/var/lib/genie-csea` first, owned by `genie`, mode 700.) `--keep` writes the list or lists, the wish names and links, and the owner's account details, readable only by its owner, before deleting anything. Genie keeps no IP addresses, so there are none to give.
4. **Report it on the portal** (registering Genie first if it isn't yet), with a priority level:
   - **1**, an immediate threat to a child's life or of serious harm: report **immediately**;
   - **2**, a risk of serious harm soon, or urgent safeguarding may be needed: **as soon as reasonably practicable**;
   - **3**, anything else: **without undue delay**.
   Include what you have from the kept file: your contact details, the content (wish names and links), how it was found (a user report), the platform (Genie), when each wish was added, the list's link, and the account's email and name. Then the declaration. If something comes to light later, send a supplementary report.
5. **Keep records:** the report reference number for **5 years**; the kept file and a copy of what you sent for **1 year** from the report. Then delete them securely. Move the kept file somewhere encrypted rather than leaving it on the server. Answer any NCA request for more information within **7 days**.
6. **Don't tell the owner why** the account went. The Regulations don't require it, and it could warn someone under investigation.
7. **Reply to the reporter** briefly: removed and reported to the authorities.
8. **Optionally** also report the links to the Internet Watch Foundation (https://report.iwf.org.uk/) so they're blocked elsewhere. This doesn't replace the NCA report.
9. **Log it**, without any copy of the content.

## Complaints and appeals

- **"My list or account was removed and that's wrong":** look at it again with fresh eyes against the Terms, and answer within 14 days explaining the decision. If it was a mistake, say so. A deleted list can only come back from a nightly backup (kept 14 days), so act quickly if restoring is right.
- **"My report wasn't handled properly":** reply explaining what was done and why, and fix the process if it was wrong.
- **Data protection complaints (DPA 2018 s.164A, added by the Data (Use and Access) Act 2025):** acknowledge within 30 days, look into it, and tell them the outcome without undue delay. If it will take more than a few weeks, tell them how it's going. Mention they can go to the ICO.

## Rights requests

- **Delete:** they can do it themselves in Settings. If they've lost access, confirm it's them (reply from the account's email) and use `remove-list.ts --email <their address>`. It works whether or not the account has any lists.
- **A child under 13 with an account** (the Privacy page promises deletion): delete it with `remove-list.ts --email <address>`, and reply to whoever told you.
- **A copy of their data** (access and portability): run this and send them the JSON. It leaves out grants on purpose: they're about visitors, not the owner, and would spoil the surprise.
  ```sh
  sudo -u genie psql genie -At -v email='person@example.com' <<'SQL'
  select json_build_object(
    'account', json_build_object('email', u.email, 'name', u.name, 'created_at', u.created_at, 'last_used', u.last_seen_at),
    'lists', coalesce((select json_agg(json_build_object('title', l.title, 'date', l.event_date, 'share_code', l.share_code, 'created_at', l.created_at,
      'wishes', coalesce((select json_agg(json_build_object('title', i.title, 'url', i.url, 'shop', i.shop, 'price_pence', i.price, 'currency', i.currency) order by i.position)
        from genie.items i where i.list_id = l.id), '[]'::json)) order by l.created_at) from genie.lists l where l.user_id = u.id), '[]'::json),
    'logins', coalesce((select json_agg(json_build_object('browser', s.user_agent, 'started', s.created_at, 'last_used', s.last_seen)) from genie.sessions s where s.user_id = u.id), '[]'::json),
    'trusted_devices', coalesce((select json_agg(json_build_object('label', d.label, 'trusted', d.created_at, 'until', d.expires_at)) from genie.devices d where d.user_id = u.id), '[]'::json))
  from genie.users u where u.email = lower(:'email');
  SQL
  ```
- **Correct:** name and email can be changed in Settings; anything else by hand.
- **Object or restrict:** reply explaining what's used and why (Privacy, "Why Genie can use your data"), and stop if there's no overriding reason.

## GenieBot exclusion requests

Add the domain to `GENIE_NO_FETCH` in the service's environment (comma-separated; a domain covers its subdomains, and it can be pasted as `https://shop.example/`, `shop.example:443` or `*.shop.example`), restart Genie, check that `journalctl -u genie -n 20` has a `GenieBot stays away from:` line that includes the domain (anything that isn't a domain stops Genie starting, so `systemctl is-active genie` must say `active`), and reply. Wishes from that site can still be added; they're just named from the link.

## The log

Keep a short log, privately and outside the Genie repo (it's evidence for Ofcom if ever asked, s.23). One line per report, with no names, email addresses or copies of content, so it can be kept for as long as Genie runs:

| Received | Type | List | What was reported | Decision and action | Owner told | Reporter told | NCA ref | Closed |
|---|---|---|---|---|---|---|---|---|
| 2026-11-02 | Report | AbCd1234 | Phishing links | Removed, account deleted | Yes | Yes | | 2026-11-02 |

Delete the report emails themselves 6 months after closing, unless a CSEA report means they must be kept for the year.
