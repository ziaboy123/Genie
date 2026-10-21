// Home: what Genie is, in one picture and three steps. Logged-in visitors never see it (they go to My lists).
import { Link } from '../lib/router.tsx';
import { useTitle } from '../components/ui.tsx';
import { Foot } from './Legal.tsx';

export function Home() {
  useTitle('');
  return (
    <div className="page home">
      <div className="home-col">
        <nav aria-label="Main" className="topbar home-nav">
          <Link to="/" className="brand big">Genie</Link>
          <Link to="/login" className="navlink">Log in</Link>
        </nav>

        <main className="home-main">
          <section className="hero">
            <div className="hero-text">
              <h1>Wish for it.<br />They'll grant it.</h1>
              <p>A wishlist with one link. Send it to family and friends, and they pick what to get you without doubling up.</p>
              <Link to="/signup" className="btn hero-cta">Make your wishlist</Link>
            </div>
            <div className="hero-art"><Lamp /></div>
          </section>

          <section aria-label="How it works" className="steps">
            <Step n={1} title="Add links">Paste a link from any shop. Genie fills in the name and price.</Step>
            <Step n={2} title="Send one link">It opens on any phone. Nobody needs an account to see it.</Step>
            <Step n={3} title="Wishes get granted">People mark what they're getting. You don't see what until after the day.</Step>
          </section>
        </main>
      </div>
      <Foot />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: string }) {
  return <div className="step"><span className="step-n">{n}</span><h2>{title}</h2><p>{children}</p></div>;
}

/** The lamp: its smoke carries wish cards up, one already granted. The cards bob and the stars twinkle (not with reduced motion). */
function Lamp() {
  return (
    <svg className="lamp" role="img" aria-label="A genie lamp with wishes floating up out of its smoke" viewBox="0 0 540 470">
      <circle cx="300" cy="245" r="215" fill="#e8eaff" />

      <path className="waft" d="M338 318C380 290 358 250 394 224S410 158 446 132 462 82 488 56" fill="none" stroke="#c3c7f7" strokeWidth="16" strokeLinecap="round" />
      <path d="M334 322C362 300 344 262 371 238S388 178 414 152" fill="none" stroke="#a6e3da" strokeWidth="8" strokeLinecap="round" />

      <ellipse cx="170" cy="447" rx="112" ry="10" fill="#d9dcf7" />
      <path d="M140 418L200 418L214 438L126 438Z" fill="#2f33a8" />
      <path d="M84 368C50 368 44 330 70 326C82 324 90 336 86 346" fill="none" stroke="#3b3fc4" strokeWidth="12" strokeLinecap="round" />
      <path d="M250 370C292 370 312 348 334 316L346 323C324 362 302 392 252 392Z" fill="#3b3fc4" />
      <path d="M80 360C80 400 120 422 170 422S260 400 260 360Z" fill="#3b3fc4" />
      <path d="M96 382C132 400 208 400 244 382" fill="none" stroke="#f2b01e" strokeWidth="4" strokeLinecap="round" />
      <path d="M124 360C124 330 145 314 170 314S216 330 216 360Z" fill="#4c51dc" />
      <rect x="76" y="351" width="188" height="13" rx="6.5" fill="#2f33a8" />
      <circle cx="170" cy="306" r="10" fill="#f2b01e" />
      <path d="M150 336C156 326 166 322 176 322" fill="none" stroke="#7d82f0" strokeWidth="4" strokeLinecap="round" />

      <g transform="translate(352 238) rotate(-5)"><g className="bob1">
        <rect x="3" y="5" width="170" height="64" rx="14" fill="#d5d8f2" />
        <rect width="170" height="64" rx="14" fill="#ffffff" />
        <rect x="10" y="10" width="44" height="44" rx="10" fill="#ffe9c7" />
        <rect x="64" y="17" width="84" height="10" rx="5" fill="#1d2150" />
        <rect x="64" y="36" width="52" height="9" rx="4.5" fill="#c9cdee" />
      </g></g>

      <g transform="translate(250 128) rotate(4)"><g className="bob2">
        <rect x="3" y="5" width="176" height="64" rx="14" fill="#d5d8f2" />
        <rect width="176" height="64" rx="14" fill="#ffffff" />
        <rect x="10" y="10" width="44" height="44" rx="10" fill="#dfe3ff" />
        <rect x="64" y="14" width="94" height="10" rx="5" fill="#1d2150" />
        <rect x="64" y="32" width="70" height="20" rx="10" fill="#e3f7f3" />
        <text x="99" y="46" textAnchor="middle" fontFamily="'DM Sans Variable', system-ui, sans-serif" fontSize="12" fontWeight="800" fill="#0b7468">Granted</text>
      </g></g>

      <g transform="translate(340 18) rotate(-3)"><g className="bob3">
        <rect x="3" y="5" width="160" height="60" rx="14" fill="#d5d8f2" />
        <rect width="160" height="60" rx="14" fill="#ffffff" />
        <rect x="10" y="10" width="40" height="40" rx="10" fill="#d9f3ee" />
        <rect x="60" y="16" width="76" height="10" rx="5" fill="#1d2150" />
        <rect x="60" y="34" width="46" height="9" rx="4.5" fill="#c9cdee" />
      </g></g>

      <g fill="#f2b01e">
        <path className="twinkle" d="M120 240L122.8 247.2 130 250 122.8 252.8 120 260 117.2 252.8 110 250 117.2 247.2Z" />
        <path d="M470 196L472.5 202.5 479 205 472.5 207.5 470 214 467.5 207.5 461 205 467.5 202.5Z" />
        <path className="twinkle" d="M225 98L227 103 232 105 227 107 225 112 223 107 218 105 223 103Z" />
        <path d="M512 323L514 328 519 330 514 332 512 337 510 332 505 330 510 328Z" />
        <path className="twinkle" d="M80 164L81.7 168.3 86 170 81.7 171.7 80 176 78.3 171.7 74 170 78.3 168.3Z" />
      </g>
    </svg>
  );
}
