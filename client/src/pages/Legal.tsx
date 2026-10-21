// Privacy and Terms: short, honest, plain English. Plus the footers that link to them (Home's, My lists' and Settings',
// and the share page's, which also has "Report this list"). Everything here must stay true to the code: change one,
// change the other.
import { useEffect, type ReactNode } from 'react';
import { BASE, Link, navigate } from '../lib/router.tsx';
import { Page, TopBar, useTitle } from '../components/ui.tsx';

const EMAIL = 'mail@daniyalzia.co.uk';
const UPDATED = '21 October 2026';
const mailto = (subject: string, body?: string) =>
  `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
const Mail = ({ subject, children = EMAIL }: { subject?: string; children?: ReactNode }) =>
  <a href={subject ? mailto(subject) : `mailto:${EMAIL}`}>{children}</a>;
const Out = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

/** The site footer. `narrow` lines it up with an ordinary page's column (My lists, Settings); Home's is wider. */
export function Foot({ narrow = false }: { narrow?: boolean }) {
  return (
    <footer className="foot">
      <div className={`foot-in ${narrow ? 'narrow' : ''}`}>
        <span>Genie by Daniyal Zia</span>
        <div className="foot-links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div>
      </div>
    </footer>
  );
}

/** The bottom of a share page: a way to report the list (an email with its link filled in, plus the address written
 *  out, for computers where a mailto link does nothing), then Privacy and Terms. */
export function ShareFoot({ code, isOwner }: { code: string; isOwner: boolean }) {
  const link = `${location.origin}${BASE}/w/${code}`;
  return (
    <footer className="share-foot">
      {!isOwner && <span className="share-report">
        <a href={mailto('Report a Genie list', `List: ${link}\n\nWhat's wrong with it:\n\n`)}>Report this list</a>
        <span>(or email {EMAIL} with its link)</span>
      </span>}
      <span className="share-foot-links"><Link to="/privacy">Privacy</Link><span aria-hidden="true">·</span><Link to="/terms">Terms</Link></span>
    </footer>
  );
}

function Doc({ title, children }: { title: string; children: ReactNode }) {
  useTitle(title);
  // a link straight to a section (GenieBot's user agent points at #geniebot): the page only exists once React has drawn it
  useEffect(() => { if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); }, []);
  return (
    <Page className="doc">
      <TopBar left={<button type="button" className="back linkbtn" onClick={() => (history.length > 1 ? history.back() : navigate('/'))}>← Back</button>} />
      <header className="head">
        <h1 className="title">{title}</h1>
        <span className="sub">Last updated {UPDATED}</span>
      </header>
      <div className="doc-body">{children}</div>
    </Page>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy">
      <p>Genie is a free wishlist site run by Daniyal Zia. There are no ads, no tracking and no analytics, and your data is never sold. This page says what Genie keeps, why, and what you can do about it.</p>

      <h2>Who's responsible</h2>
      <p>Daniyal Zia, an individual in the UK, runs Genie and is responsible for your data (the "controller", in data protection terms). For anything on this page, email <Mail />.</p>

      <h2>If you have an account</h2>
      <ul>
        <li><strong>Your account:</strong> your email address, your name, and your password stored only as a secure hash (never the password itself). Also when you made the account and when you last used it.</li>
        <li><strong>Your lists:</strong> each list's name, date and share link, and the wishes on it: name, link, shop and price.</li>
        <li><strong>Logins:</strong> each login is kept as a scrambled key, with the description your browser gives of itself (its "user agent": browser, version and system) and when it was last used. Trusted devices are kept the same way, with a short label like "Chrome on Mac".</li>
        <li><strong>Email codes:</strong> kept only as a scrambled hash. While you're signing up, your name and password hash wait with the code until you enter it.</li>
        <li><strong>Reports:</strong> if someone reports one of your lists, Daniyal gets their email about it, which may say things about you or the list. It's kept as set out under How long things are kept.</li>
      </ul>

      <h2>If you open someone's list</h2>
      <p>You don't need an account, and Genie doesn't know who you are. If you grant a wish, Genie keeps only that it was granted and when, plus a scrambled copy of a key. The key itself stays in your browser, so only you can undo the grant. Your browser sends it back when you open the list, just to show which wishes are yours. Nobody, the list's owner included, can see who granted what.</p>

      <h2>What Genie doesn't do</h2>
      <p>No tracking, no ads, no analytics, no profiling and no location. Nothing about you is passed to shops, and Genie doesn't copy product pictures.</p>

      <h2>Who can see your list</h2>
      <p>Anyone with your list's share link can see your name, the list's name and date, and its wishes. When the link is sent in WhatsApp, iMessage and similar apps, the preview shows the list's name, your name and how many wishes it has.</p>
      <p>Lists can't be found any other way: there's no search or public directory, and they're hidden from search engines. If a link ends up somewhere it shouldn't, make a new one in the editor and the old one stops working. You never see who granted a wish. While you're logged in, Genie hides what's been granted until the day after the list's date (the link is the same for everyone, so it works on trust).</p>

      <h2>Reading the links you paste</h2>
      <p>When you add a link, Genie's server visits that page once to read the product's name and price. The shop sees one visit from Genie's server, which says it's "GenieBot", not from you or the people you share with. When people open your list, nothing is loaded from shops. If they tap a wish, the shop's page opens in their browser like any other link, and Genie doesn't tell the shop where they came from.</p>

      <h2>Spam and security</h2>
      <p>To slow down password guessing and spam, Genie counts recent attempts by IP address (and, for sign-ups, logins and password resets, by email address). These counts are kept only in the server's memory and are forgotten within about an hour. Genie's server doesn't keep a log of visits.</p>

      <h2>Emails</h2>
      <p>Genie only emails you codes (for signing up, logging in on a new device, changing your email and resetting your password), notices about your account (like your email being changed) and, if you stop using Genie, one warning before your account is deleted. No newsletters and no marketing. Emails are sent through Resend from its servers in the EU.</p>
      <p>If you email <Mail />, Cloudflare passes it on to Daniyal's own inbox, which Microsoft hosts. It's used only to deal with what you asked, and kept only as long as that needs (reports and complaints: see How long things are kept).</p>

      <h2>Why Genie can use your data</h2>
      <ul>
        <li><strong>To run the service you asked for</strong> (a contract): your account, your lists, showing them to people with the link, and the emails that go with them.</li>
        <li><strong>Legitimate interests</strong> (keeping Genie safe and working): login security and trusted devices, spam limits, reading the links you paste, keeping track of grants so nobody doubles up and you can undo yours, backups, warning you before an unused account is deleted, and dealing with reports. You can object to these (see Your rights).</li>
        <li><strong>The law:</strong> for example, reporting child sexual abuse material to the National Crime Agency, which UK law requires.</li>
      </ul>
      <p>You need an email address and a password to have an account. Visitors don't need to give anything. Genie makes no automated decisions about you.</p>

      <h2>Who else handles data</h2>
      <ul>
        <li><strong>Cloudflare</strong> carries all of Genie's traffic between your browser and the server, so it handles your IP address and everything sent between your browser and Genie. It also passes on emails sent to {EMAIL}. See <Out href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</Out>.</li>
        <li><strong>Resend</strong> delivers Genie's emails, so it handles your email address and what's in the email. See <Out href="https://resend.com/legal/privacy-policy">Resend's privacy policy</Out>.</li>
        <li><strong>Microsoft</strong> hosts Daniyal's inbox, so it stores the emails you send him, including reports. See <Out href="https://privacy.microsoft.com/privacystatement">Microsoft's privacy statement</Out>.</li>
      </ul>
      <p>Genie itself runs on Daniyal's own server in the UK. Nothing else is involved: no analytics, no ad networks, and no fonts or scripts from other sites. Data is only shared beyond this if the law requires it.</p>

      <h2>Data outside the UK</h2>
      <p>Cloudflare, Microsoft (Daniyal's inbox) and Resend are US companies, so some data may be handled in the US. Transfers to them are covered by the UK-US "data bridge" (the UK Extension to the EU-US Data Privacy Framework) or by contract terms the UK approves.</p>

      <h2>How long things are kept</h2>
      <ul>
        <li><strong>Your account and lists:</strong> until you delete them. Accounts that haven't been used for 2 years are deleted with their lists (not while one of your lists' days is coming up or has just passed), after a warning email that gives you at least 30 days.</li>
        <li><strong>Logins:</strong> 30 days after you last use them. <strong>Trusted devices:</strong> 30 days.</li>
        <li><strong>Email codes:</strong> they work for 10 minutes and are cleared out within a day.</li>
        <li><strong>Grants:</strong> until they're undone, the wish or list is deleted, or the owner reuses the list after the day.</li>
        <li><strong>Spam counts:</strong> forgotten within about an hour.</li>
        <li><strong>Backups:</strong> the database is backed up every night and each backup is kept for 14 days, so anything deleted is gone from backups within 14 days.</li>
        <li><strong>Reports and complaints:</strong> the emails are kept for 6 months after they're dealt with (a year if the next point applies). A short log without names is kept.</li>
        <li><strong>Reports to the National Crime Agency:</strong> if content has to be reported, the law says a copy of it and the account details that go with it must be kept, securely, for a year.</li>
      </ul>

      <h2>Cookies and browser storage</h2>
      <ul>
        <li><strong>genie_session</strong> keeps you logged in, for up to 30 days.</li>
        <li><strong>genie_device</strong> remembers a device you trust for 30 days, so it doesn't need an emailed code. It's set when you sign up, or when you log in with "Trust this device" left ticked.</li>
        <li><strong>Your browser's storage</strong> keeps the keys for wishes you've granted, so you can undo them. After the list's day they can't be undone, so the keys are cleared the next time you open the list. While you log in, the tab also remembers which page to take you back to.</li>
      </ul>
      <p>Both cookies are only sent to Genie, over a secure connection, and can't be read by scripts on the page. All of this is strictly necessary for things you ask for (staying logged in, undoing a grant), so the law doesn't require asking for your consent, and that's why there's no cookie banner. There are no analytics or advertising cookies, and if you've never logged in on a browser, Genie sets no cookies in it.</p>

      <h2>Your rights</h2>
      <p>Under UK data protection law you can ask to see the data Genie holds about you (including a copy of your lists), have it corrected or deleted, limit how it's used, object to it being used, and get it in a format you can take elsewhere. You can change your name, email and password, and delete your account, yourself in Settings. For anything else, email <Mail /> and you'll get a reply within a month.</p>
      <p>Grants aren't linked to anyone, so Genie usually can't tell which ones are yours.</p>

      <h2>Complaints</h2>
      <p>Unhappy with how your data has been handled? Email <Mail subject="Data protection complaint" /> with the subject "Data protection complaint". You'll get a reply confirming it within 30 days, and you'll be told what's been done about it. You can also complain to the <Out href="https://ico.org.uk/make-a-complaint/">Information Commissioner's Office (ICO)</Out>.</p>

      <h2>Children</h2>
      <p>You need to be 13 or older to make an account, and if you're under 18, check with a parent or guardian first. Anyone can open a list that's been sent to them, whatever their age. If you think a child under 13 has an account, email <Mail /> and it will be deleted.</p>

      <h2>Changes</h2>
      <p>If this page changes, the date at the top changes too. The <Link to="/terms">Terms</Link> say what's allowed on Genie and how to report a list.</p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms">
      <p>These are the rules for using Genie. By using it, whether you make a list or open one someone sent you, you agree to them. They're short on purpose.</p>

      <h2>About Genie</h2>
      <p>Genie is a free wishlist site run by Daniyal Zia, an individual in the UK. There's nothing to pay, and no ads.</p>

      <h2>Who can use it</h2>
      <ul>
        <li>You need to be 13 or older to make an account. If you're under 18, check with a parent or guardian first.</li>
        <li>Anyone can open a list that's been shared with them, and these terms apply to them too.</li>
        <li>Keep your password to yourself. You're responsible for what's done with your account.</li>
      </ul>

      <h2>What's not allowed</h2>
      <p>Lists are for things you'd genuinely like. Don't use Genie for:</p>
      <ul>
        <li>anything illegal, or links to illegal content;</li>
        <li>scams, phishing, fake shops, malware, or links meant to trick people;</li>
        <li>hate, harassment, threats or bullying, including in a list's name or your name;</li>
        <li>anything sexual involving children, ever, and any sexual or pornographic content or links;</li>
        <li>content that encourages, promotes or gives instructions for suicide, self-harm or eating disorders;</li>
        <li>content that encourages serious violence, dangerous stunts or taking harmful substances;</li>
        <li>pretending to be someone else;</li>
        <li>spam, or trying to overload, break into or misuse Genie.</li>
      </ul>

      <h2 id="children">Keeping children safe</h2>
      <p>Genie is for all ages. Content harmful to children (pornography, suicide, self-harm or eating-disorder content, bullying, hate, violence, dangerous stunts and harmful substances) isn't allowed for anyone, adult or child. Harmful content that's reported is removed. There's no search and there are no messages, so people only see lists sent to them. There's no age check: you confirm you're 13 or older when you sign up, and accounts found to belong to under-13s are deleted.</p>

      <h2>Your content</h2>
      <p>What you put on Genie stays yours. You let Genie store it and show it to anyone you share the link with (and in link previews in message apps), only so that Genie works. That ends when you delete it (copies in backups go within 14 days; see <Link to="/privacy">Privacy</Link>). Only add things you're allowed to share.</p>

      <h2>Shops and prices</h2>
      <p>Genie doesn't sell anything, and it isn't linked to, endorsed by or paid by any shop. Shop and product names belong to their owners. Names and prices are read from the shop's page when a wish is added, and shops change them, so check the shop before you buy. Anything you buy is between you and the shop.</p>

      <h2>Keeping it a surprise</h2>
      <p>Genie hides grants from you until after the day. The link is the same for everyone, though, so it works on trust: please don't peek from someone else's phone.</p>

      <h2 id="report">Reporting content and complaints</h2>
      <p>If something on a list breaks these rules or the law, please report it. You don't need an account.</p>
      <ul>
        <li><strong>How to report:</strong> use "Report this list" at the bottom of the list, which opens an email with the list's link filled in, or email <Mail subject="Report a Genie list" /> with the list's link and what's wrong.</li>
        <li><strong>What happens:</strong> every report is read by a person, Daniyal, and dealt with promptly. Lists that are illegal or break these rules are removed, and for serious or repeated problems the whole account is deleted. The owner is told by email what was removed and why, unless the law or someone's safety means they can't be. You'll get a reply saying what was done.</li>
        <li><strong>Child sexual abuse:</strong> anything like this is removed and reported to the National Crime Agency, as the law requires. Please don't send copies of it: the list's link is enough. If a child is in danger right now, call 999. You can also report child sexual abuse images found anywhere online to the <Out href="https://report.iwf.org.uk/">Internet Watch Foundation</Out>.</li>
        <li><strong>No automated scanning:</strong> Genie doesn't use automated tools to scan, filter or rank lists. It relies on reports.</li>
        <li><strong>Complaints and appeals:</strong> if your list or account was removed and you think that was wrong, or you're unhappy with how a report was handled, email <Mail subject="Complaint" /> with the subject "Complaint" (and the list's link if you have it). It will be looked at again, and you'll get an answer explaining the decision within 14 days. If it was a mistake, it will be put right where that's still possible.</li>
        <li><strong>Who's responsible:</strong> Daniyal Zia is responsible for keeping Genie safe and for handling reports and complaints.</li>
      </ul>

      <h2>If something uses your rights</h2>
      <p>If something on Genie uses your work, brand or name without permission, or says something untrue about you, email <Mail /> with the link and what's wrong. It will be looked at and removed if needed.</p>

      <h2 id="geniebot">For shops and site owners</h2>
      <p>Genie's link reader is called GenieBot. It visits a page only when someone pastes that page's link into Genie, once each time, to read the product's name and price. It says who it is (its user agent includes "GenieBot" and a link to this section), follows at most 3 redirects, sends no cookies, never crawls other pages, never comes back to check prices, never copies pictures, and never tries to get round bot checks.</p>
      <p>To stop GenieBot visiting your site, email <Mail subject="GenieBot" /> with your domain and it will be excluded. People can still add your products by typing in the details.</p>

      <h2>Ending things</h2>
      <ul>
        <li>You can delete your account at any time in Settings, and its lists go with it.</li>
        <li>Accounts that haven't been used for 2 years are deleted, after a warning email.</li>
        <li>Lists and accounts that break these rules can be removed (see Reporting content and complaints).</li>
        <li>Genie may change, or close one day. If it's closing, account holders will be told by email first where possible.</li>
      </ul>

      <h2>No guarantees</h2>
      <p>Genie is free and provided as it is, without warranties. It may change, and it may sometimes be offline. As far as the law allows, Daniyal Zia isn't responsible for losses from using it, such as a lost list or a gift that doubles up. Nothing in these terms limits anything the law doesn't allow to be limited, like responsibility for death or injury caused by negligence, or for fraud.</p>

      <h2>Changes to these terms</h2>
      <p>If these terms change, the date at the top changes. If you keep using Genie after that, the new terms apply. If you don't agree with them, you can delete your account.</p>

      <h2>The law</h2>
      <p>These terms are governed by the law of England and Wales. If you live in Scotland or Northern Ireland, you can also bring a claim in your local courts.</p>

      <h2>Contact</h2>
      <p>Questions, reports or security problems: <Mail />. If you find a security problem, please report it privately before telling anyone else. How your data is handled is on the <Link to="/privacy">Privacy</Link> page.</p>
    </Doc>
  );
}
