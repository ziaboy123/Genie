# Genie: illegal content risk assessment

| | |
|---|---|
| Service | Genie, https://daniyalzia.co.uk/genie (a user-to-user service under the Online Safety Act 2023, s.3) |
| Provider | Daniyal Zia, an individual in the UK |
| Accountable person | Daniyal Zia (illegal content safety, reporting and complaints) |
| Date | 20 October 2026, before launch |
| Next review | 20 October 2027, after any serious incident, or before a significant change (see the end) |
| Required by | OSA s.9 (the assessment) and s.23 (keeping a written record). For a new service it's due within 3 months of launch (Sch 3 para 3); it's done before launch. |

## How this was done

It follows Ofcom's four steps: (1) work out which kinds of illegal content could appear, (2) judge how likely and how harmful each is, using Ofcom's Risk Profile for user-to-user services, (3) decide on measures and record them, (4) review and update. There's no usage data yet, so the evidence is what the code can and can't do, Ofcom's risk factors, and a legal review in October 2026.

## 1. What Genie lets people do

- **What users can post:** list names and wish names (up to 120 characters each), their own display name (up to 40), web links (http or https only, up to 2,000 characters) and prices. That's all. There are no pictures (removed on 20 October 2026), no comments, no messages, no profiles and no file uploads.
- **Who sees it:** only people who have a list's share link. Each link has an 8-character random code (about 218 trillion possibilities). There's no search, no directory and no recommendations, and share pages are marked `noindex`. Link previews in message apps show the list's name, the owner's name and how many wishes it has.
- **Visitors:** need no account and can't post anything. They can only press Grant or Undo.
- **Accounts:** email address confirmed with a code. 13+ in the Terms, with no age checks.
- **Size and money:** small (family and friends, likely tens to a few hundred users). Free, no ads, no payments.
- **Each wish shows the real domain its link goes to**, in plain ASCII, so a look-alike domain can't pass as a known shop.

## 2. Risk factors (from Ofcom's Risk Profile)

| Factor | On Genie? | Note |
|---|---|---|
| Service type (social media, messaging, gaming, dating, file storage, marketplace, forum) | No | A small service where people share a list by link |
| Large user base | No | Small |
| Child users | Likely | See childrens-access-assessment.md |
| Anonymous or unverified users | Yes | Names aren't checked; visitors are anonymous |
| Users can connect, follow or message each other | No | |
| Comments, chat, live streaming | No | |
| Posting text | Yes | Short list and wish names, display names |
| Posting hyperlinks | Yes | Ofcom links this to fraud, CSAM URLs and terrorist content |
| Images, video, files | No | |
| Search, recommendations, feeds | No | |
| Sharing content by link | Yes | The whole service works this way |
| End-to-end encryption, disappearing content | No | |

## 3. The harms: how likely, how bad, overall risk

Risk levels are Ofcom's: negligible, low, medium, high.

| Kind of illegal content | How it could happen on Genie | Likelihood | Impact | Risk |
|---|---|---|---|---|
| Fraud and financial offences | A list of phishing or fake-shop links, sent to someone to get their card details, borrowing daniyalzia.co.uk's good name | Low: nobody can find lists, so a scammer has to send the link themselves, and could use any site | Medium to high for a victim; could also get the whole domain flagged | Low |
| Child sexual exploitation and abuse: grooming | No way to contact anyone through Genie: no messages, comments or profiles | Negligible | Severe | Negligible |
| Child sexual exploitation and abuse: CSAM | No images or files are stored. A privately shared list could carry links to CSAM, or CSAM-related text | Low | Severe | Low |
| Hate | Hateful list or wish names, or display names, seen by anyone with the link and in link previews | Low | Medium | Low |
| Harassment, stalking, threats and abuse | A list made to target someone (an abusive or threatening title), sent to them or about them | Low | Medium | Low |
| Controlling or coercive behaviour | Hard to see how a wishlist does this | Negligible | Medium | Negligible |
| Intimate image abuse | No images; a link to images hosted elsewhere, maybe naming the person | Low | High | Low |
| Extreme pornography | Links only | Low | High | Low |
| Sexual exploitation of adults | Wishlists are used elsewhere for "tributes"; a list could advertise someone else's sexual services | Low | High | Low |
| Human trafficking, unlawful immigration | No adverts, messaging or payments | Negligible | Severe | Negligible |
| Proceeds of crime | Genie handles no money | Negligible | Medium | Negligible |
| Drugs and psychoactive substances | Links to sites selling illegal drugs | Low | Medium | Low |
| Firearms, knives and other weapons | Links to illegal weapon sales (ordinary shops selling legal items aren't illegal content) | Negligible | High | Negligible |
| Encouraging or assisting suicide | Text in a name; no conversations | Negligible | Severe | Negligible |
| Terrorism | Links to terrorist material, or a name supporting a banned group | Low | Severe | Low |
| Foreign interference, animal cruelty | No realistic route | Negligible | Medium | Negligible |
| Other illegal content (threatening or false communications, encouraging serious self-harm) | Text in a name, or a link | Low | Medium | Low |

Copyright, trade mark and product-safety problems aren't "illegal content" under the Act (s.59 leaves them out), but rights-holders can still ask for removal (see the Terms).

**Overall: low risk.** No kind of illegal content comes out as medium or high. The realistic ones are scam or phishing links, hateful or harassing names, and (rare but severe) links to child sexual abuse material.

## 4. Measures in place

Design:
- No search, discovery or public lists; share by unguessable link only; owners can replace a link, which kills the old one; `noindex` on share pages.
- Nothing to post but short text and links: no pictures, files, comments or messages. Visitors can't post at all.
- Limits: 50 lists per account, 100 wishes per list, 120-character names. Invisible and text-direction characters are stripped from names.
- Links must be http(s) (never `javascript:`); tracking parameters are removed; each wish shows its real domain.
- Rate limits: sign-ups (10 an hour per IP, 3 per 10 minutes per email), adding wishes (60 per 15 minutes per account), grants (30 per 15 minutes per IP, and 10 per list per day per visitor, so one person can't mark a whole list as granted; the owner can also clear all grants with a new link). Accounts need a confirmed email.
- The link reader (GenieBot) refuses private and LAN addresses, re-checks every redirect and pins DNS answers. That protects the network rather than users, but means Genie can't be used to reach anything internal.

Rules and processes:
- **Terms** say what's not allowed, how people are protected, how to report and complain, and that no automated scanning is used (s.10(5) and (7), s.21(3)).
- **Reporting** (s.20): a "Report this list" link at the bottom of every share page opens an email with the list's link filled in, and the email address is shown next to it (for computers where that link does nothing). The Terms also give the address. No account needed.
- **Takedown** (s.10(3)(b)): `server/scripts/remove-list.ts` deletes a list, one wish, or the whole account (found by one of its lists or by its email address), straight away. Share pages and the API are never served from a cache (`no-cache` / `no-store`, and Cloudflare doesn't cache pages by default), so a removed list is gone at once.
- **Complaints and appeals** (s.21): by email, looked at again by a person. See handling-reports.md.
- **Child sexual abuse material** is reported to the National Crime Agency (s.66). See handling-reports.md.
- **Accountable person:** Daniyal Zia.

Ofcom's codes ask every service, however small, for these. All are in place:

| Measure | How Genie meets it |
|---|---|
| A named person accountable for illegal content duties, reports and complaints | Daniyal Zia, named in the Terms and here |
| Content moderation that can review suspected illegal content and take it down swiftly | Reports read by Daniyal; removal script |
| Easy-to-find, easy-to-use reporting and complaints, with appropriate action | Report link on every share page; email; handling-reports.md |
| Terms that explain protections, complaints and any proactive technology, clearly | Terms, "Reporting content and complaints" |
| Removing accounts of proscribed organisations | The removal script's `--account` option |

## 5. Gaps and things to watch

- **No age checks.** See childrens-access-assessment.md.
- **A deleted account can sign up again** with the same email. Fine at this size. If it happens, add a blocked-email list.
- **No automatic link screening** (such as Google Safe Browsing's lists or the IWF's URL list). Not proportionate for a small, low-risk service. Revisit if scam or abuse reports start coming in.
- **Reports depend on email** being read promptly. mail@daniyalzia.co.uk reaches Daniyal's phone.
- **Shared domain.** Lists live on daniyalzia.co.uk with his other projects. If phishing ever gets the domain flagged, move Genie to its own subdomain.

## 6. Review

Review yearly, after any serious incident, and before any significant change (s.9), in particular: pictures coming back, comments or messages, group gifts, names on grants, public or searchable lists, visitor accounts, or affiliate links.

| Date | By | What changed |
|---|---|---|
| 20 October 2026 | Daniyal Zia | First assessment, before launch |
| 21 October 2026 | Daniyal Zia | Before launch: report address shown next to "Report this list"; the removal script can also remove one wish, or an account by its email address |

Signed: Daniyal Zia, 20 October 2026
