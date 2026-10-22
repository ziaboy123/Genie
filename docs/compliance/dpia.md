# Genie: data protection impact assessment

Controller: Daniyal Zia, an individual in the UK (mail@daniyalzia.co.uk). Date: 20 October 2026, before launch (updated 22 October 2026). Next review: 20 October 2027, or before a significant change.

**Why a DPIA:** Genie is likely to be used by under-18s, and the ICO lists online services offered to children as likely to be high risk (UK GDPR Art 35). It's a new service open to the public.

## The processing

| Data | Whose | Why (lawful basis) | How long |
|---|---|---|---|
| Email, name, password hash, account dates | Owners | Running the account (contract) | Until deleted; 2 years unused, after a warning |
| Lists and wishes (names, links, shops, prices) | Owners | Running the lists (contract) | Until deleted |
| Logins (hashed token, user agent, dates), trusted devices (hashed token, "Chrome on Mac") | Owners | Security (legitimate interests) | 30 days |
| Email codes (hashed), with name and password hash during sign-up | Owners | Security (legitimate interests) | 10 minutes, cleared within a day |
| Grants (that a wish is granted, when, hash of the undo key) | Visitors, pseudonymous | Making grants work (legitimate interests) | Until undone, deleted or the list is reused. The undo key in the visitor's browser (kept with the list's share code and date) is cleared when they next open that list after its day, or, for a list they don't open again, the next time they open any Genie list 30 days after its day (its date may have been moved later), even if that list has been deleted |
| IP addresses and emails in rate limits (memory only) | Everyone | Stopping abuse (legitimate interests) | About an hour (per-list grant counts, and each address's count of emails asked for, at most 8 a day: a day); forgotten on restart |
| Nightly database backups | Everyone above | Recovery (legitimate interests) | 14 days |
| Copies kept for a CSEA report to the NCA | The account reported | Legal obligation (OSA s.66 and its Regulations). Art 10 condition: DPA 2018 Sch 1 para 10(2), disclosure to the NCA | 1 year (report number 5 years) |
| Emails to mail@ (reports, complaints, rights requests) | Reporters, complainants, owners reported on | Dealing with them (legitimate interests; legal obligation for complaints and rights requests) | 6 months after closing; a log without names |

Processors and recipients: Resend (email; US company, sends from the EU; UK Extension to the EU-US Data Privacy Framework), Cloudflare (all traffic, so everything sent to and from Genie, and email routing; US company; same, or UK-approved contract terms) and Microsoft (hosts Daniyal's inbox, where emails to mail@ land; US company; same). Hosting is Daniyal's own server in the UK. No analytics, ads, profiling, location or third-party scripts.

## Necessity and proportionality

Only what's needed to run lists is kept. Visitors give nothing. Secrets are stored only as hashes. The privacy page explains everything above in plain English, with rights, complaints (DPA 2018 s.164A) and the ICO. People can delete their own account in Settings, and other rights requests are handled by email (see handling-reports.md).

## Risks and measures

| Risk to people | Likelihood | Severity | Measures | Left over |
|---|---|---|---|---|
| A teenager's name and wishes seen by people beyond their family (a forwarded link) | Possible | Minimal | "A first name is enough" at sign-up; unguessable links; noindex; no search; a new link kills the old one | Low |
| Account taken over (a reused password) | Remote | Some | bcrypt; a code on new devices; rate limits; email when the address changes | Low |
| Server breach | Remote | Some | Little data; hashed passwords and tokens; the service runs as its own user with systemd hardening (set up at deploy); 14-day backups only | Low |
| Owner, or anyone else, learns who granted what | Remote | Minimal | Grants hold no identity, so nobody ever sees names. A logged-in owner sees no grants until the day after the list's date; logged out, the link is the same for everyone, so that part works on trust | Low |
| Shops learn about the owner or visitors | Remote | Minimal | Links read by Genie's server; no shop content loaded on list pages; no-referrer | Low |
| Scam links or harmful content shown to children | Remote | Some | See the online safety assessments | Low |
| Unused accounts kept forever | Possible | Minimal | Warning at 23 months, deletion at 24 (daily job), not while a list's day is coming up or was in the last 30 days; an address that refuses the warning can't hold up the rest | Low |
| Data in the US | Possible | Minimal | Data bridge or approved contract terms; minimal data sent | Low |

## Children's code

Genie already meets the relevant standards by design: best interests (no engagement tricks or ads), high-privacy defaults (lists aren't public or searchable), data minimisation, no profiling, no nudges, no location, no sharing of data, clear privacy information, and easy deletion.

## Outcome

Residual risk is low. There's no need to consult the ICO (Art 36). Approved by Daniyal Zia, 20 October 2026.
