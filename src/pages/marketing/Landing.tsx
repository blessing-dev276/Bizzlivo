import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'
import BrandLogo from '../../components/BrandLogo'

/* Bizzlivo marketing landing — shown at the root of the main domain to
   logged-out visitors, before Create an office / Log in. Pure CSS + inline
   SVG (no external assets), theme-aware, responsive. */

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

const FEATURES = [
  {
    title: 'Branded offices',
    body: 'Every organization gets an isolated workspace with its own subdomain, branding, people, and subscription. Row-level security keeps offices fully separate.',
    icon: 'M3 21h18M4 21V7l8-4 8 4v14M9 21v-6h6v6',
  },
  {
    title: 'Learning Center',
    body: 'Onboarding, Personal Development, Skill Development, Income Development and Network Marketing — structured classes, PDFs, videos and podcasts in one place.',
    icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  },
  {
    title: 'Business Path',
    body: 'Build your own rank ladder. Each rank carries a learning path and business tasks that read real activity — members are promoted automatically or on approval.',
    icon: 'M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.4 17.6l4.2-4.2M13.4 10.6l4.2-4.2',
  },
  {
    title: 'AI assessments',
    body: 'Upload a document, let AI draft the questions, review, publish and assign. Members take timed quizzes online with rosters, attempts and analytics.',
    icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4',
  },
  {
    title: 'Wallet & payouts',
    body: 'A transparent, ledger-backed earnings system: verified orders, platform settlement, currency conversion at the real rate, itemized charges and audited withdrawals.',
    icon: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z',
  },
  {
    title: 'Reports & insights',
    body: 'Office-wide intelligence on growth, learning completion, network activity, teams and income — every metric derived from real data, never hardcoded.',
    icon: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  },
]

const STEPS = [
  { n: '01', title: 'Create your office', body: 'Register in under a minute. You get a branded workspace and a login page on your own subdomain.' },
  { n: '02', title: 'Bring your people in', body: 'Invite members, approve join requests, assign roles and organize teams under team leaders.' },
  { n: '03', title: 'Run the whole operation', body: 'Publish learning, define your rank path, assign assessments, track income and read the numbers.' },
]

const PLANS = [
  {
    name: 'Free',
    price: '₦0',
    per: '',
    note: 'For small offices getting started.',
    features: [
      'Up to 5 members',
      '1 admin seat',
      'Dashboard, Learning Center & Business Path',
      'Goals, My Network, Finance & Wallet',
      'Events & assessments',
      'Basic reports & insights',
    ],
    cta: 'Start free',
  },
  {
    name: 'Growth',
    price: '₦15,000',
    per: '/mo',
    note: 'For growing offices building consistent teams.',
    features: [
      'Up to 25 members',
      '2 admin seats',
      'Everything in Free',
      'Full reports & insights',
      'AI question generation',
      'No “Powered by Bizzlivo” badge',
      'Priority support',
    ],
    cta: 'Start Growth',
    popular: true,
  },
  {
    name: 'Business',
    price: '₦35,000',
    per: '/mo',
    note: 'For established offices managing larger teams.',
    features: [
      'Up to 100 members',
      '5 admin seats',
      'Everything in Growth',
      'Advanced reports — custom ranges + CSV export',
      'Wallet & payouts',
      'Custom logo & brand colour',
      'Priority support',
    ],
    cta: 'Choose Business',
  },
]

const FAQS = [
  { q: 'What is Bizzlivo for?', a: 'Bizzlivo is an operating system for network-marketing and training organizations — onboarding, learning, ranks, assessments, events, income and reporting in one multi-tenant platform.' },
  { q: 'Is my office data isolated from others?', a: 'Yes. Every office is a separate organization enforced by Postgres row-level security. No one from another office can ever see your people, learning or finances.' },
  { q: 'Do I need to install anything?', a: 'No. Bizzlivo runs in the browser. Create an office and share your login link — members just sign in.' },
  { q: 'Can I use my own branding?', a: 'Each office has its own name, colors, logo and a branded login page on its own subdomain.' },
]

export default function Landing() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const revealRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const root = revealRef.current
    const els = root?.querySelectorAll('[data-reveal]')
    if (!root || !els?.length) return
    // Progressive enhancement: only hide-then-reveal once we know JS + IO
    // are available. Without this class the content is always visible.
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    root.classList.add('lp-js')
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('lp-in'); io.unobserve(e.target) }
      }),
      { threshold: 0.1, rootMargin: '0px 0px -32px 0px' },
    )
    els.forEach((el) => io.observe(el))
    // Safety net: nothing stays invisible even if the observer never fires
    // (no scroll, prerender, headless capture).
    const t = window.setTimeout(() => els.forEach((el) => el.classList.add('lp-in')), 1400)
    return () => { io.disconnect(); window.clearTimeout(t) }
  }, [])

  return (
    <div className="lp" ref={revealRef}>
      <div className="lp-aurora" aria-hidden />

      <header className={`lp-nav ${scrolled ? 'lp-nav-solid' : ''}`}>
        <div className="lp-shell lp-nav-inner">
          <a href="#top" className="lp-logo">
            <BrandLogo size={22} />
          </a>
          <nav className={`lp-links ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
            <a href="#product">Product</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lp-nav-actions">
            <ThemeToggle />
            <Link to="/login" className="lp-btn lp-btn-ghost">Log in</Link>
            <Link to="/signup" className="lp-btn lp-btn-primary">Create your office</Link>
            <button type="button" className="lp-burger" aria-label="Menu" onClick={() => setMenuOpen((v) => !v)}>
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ---------------- Hero ---------------- */}
        <section className="lp-hero lp-shell">
          <div className="lp-hero-copy" data-reveal>
            <span className="lp-eyebrow">The office OS for network-marketing & training organizations</span>
            <h1>
              Run your entire organization from <span className="lp-grad">one command center</span>.
            </h1>
            <p className="lp-lead">
              Onboarding, learning, ranks, assessments, income and reporting — for every office, every member,
              in one multi-tenant platform built on real data.
            </p>
            <div className="lp-hero-cta">
              <Link to="/signup" className="lp-btn lp-btn-primary lp-btn-lg">Create your office — free</Link>
              <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-lg">Log in</Link>
            </div>
            <div className="lp-trust">
              <span>●</span> No credit card &nbsp;·&nbsp; Branded subdomain &nbsp;·&nbsp; Set up in minutes
            </div>
          </div>

          <div className="lp-hero-visual" data-reveal>
            <ProductMock />
          </div>
        </section>

        {/* ---------------- Marquee ---------------- */}
        <section className="lp-strip lp-shell">
          <p>One platform replaces the spreadsheet, the group chat, the LMS and the payout ledger.</p>
        </section>

        {/* ---------------- Features ---------------- */}
        <section className="lp-section lp-shell" id="product">
          <div className="lp-section-head" data-reveal>
            <span className="lp-kicker">Everything in one place</span>
            <h2>Built for how your office actually runs</h2>
            <p>From a new member&rsquo;s first day to their first payout — every step lives in Bizzlivo.</p>
          </div>
          <div className="lp-grid">
            {FEATURES.map((f, i) => (
              <article className="lp-card" key={f.title} data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
                <div className="lp-card-ico"><Icon path={f.icon} /></div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- Metrics band ---------------- */}
        <section className="lp-metrics lp-shell" data-reveal>
          <div><strong>5</strong><span>learning stages</span></div>
          <div><strong>4</strong><span>workspace roles</span></div>
          <div><strong>1</strong><span>audited money ledger</span></div>
          <div><strong>100%</strong><span>office data isolation</span></div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section className="lp-section lp-shell" id="how">
          <div className="lp-section-head" data-reveal>
            <span className="lp-kicker">How it works</span>
            <h2>Live in three steps</h2>
          </div>
          <div className="lp-steps">
            {STEPS.map((s) => (
              <div className="lp-step" key={s.n} data-reveal>
                <span className="lp-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- Pricing ---------------- */}
        <section className="lp-section lp-shell" id="pricing">
          <div className="lp-section-head" data-reveal>
            <span className="lp-kicker">Pricing</span>
            <h2>Start free. Upgrade when you grow.</h2>
            <p>Every plan includes branded offices, secure isolation and unlimited learning content. Paid plans are billed monthly — pay yearly and get about two months free.</p>
          </div>
          <div className="lp-plans">
            {PLANS.map((p) => (
              <div className={`lp-plan ${p.popular ? 'lp-plan-pop' : ''}`} key={p.name} data-reveal>
                {p.popular && <span className="lp-plan-badge">Most popular</span>}
                <h3>{p.name}</h3>
                <div className="lp-plan-price">{p.price}<span>{p.per}</span></div>
                <p className="lp-plan-note">{p.note}</p>
                <ul>
                  {p.features.map((x) => (
                    <li key={x}><Icon path="M20 6 9 17l-5-5" />{x}</li>
                  ))}
                </ul>
                <Link to="/signup" className={`lp-btn ${p.popular ? 'lp-btn-primary' : 'lp-btn-ghost'} lp-btn-block`}>{p.cta}</Link>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section className="lp-section lp-shell" id="faq">
          <div className="lp-section-head" data-reveal>
            <span className="lp-kicker">FAQ</span>
            <h2>Good questions</h2>
          </div>
          <div className="lp-faq" data-reveal>
            {FAQS.map((f) => (
              <details key={f.q}>
                <summary>{f.q}<span className="lp-faq-plus" /></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------------- Final CTA ---------------- */}
        <section className="lp-shell">
          <div className="lp-cta" data-reveal>
            <h2>Your office, running itself by tonight.</h2>
            <p>Create your workspace, invite your first members and publish your first learning path today.</p>
            <div className="lp-hero-cta">
              <Link to="/signup" className="lp-btn lp-btn-invert lp-btn-lg">Create your office</Link>
              <Link to="/login" className="lp-btn lp-btn-ghost-invert lp-btn-lg">Log in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer lp-shell">
        <div className="lp-logo">
          <BrandLogo size={20} />
        </div>
        <p>© {new Date().getFullYear()} Bizzlivo. Multi-tenant office management, learning and member development.</p>
        <div className="lp-footer-links">
          <Link to="/login">Log in</Link>
          <Link to="/signup">Create office</Link>
          <a href="#product">Product</a>
          <a href="#pricing">Pricing</a>
        </div>
      </footer>
    </div>
  )
}

/* CSS-drawn product preview — a faux dashboard in a browser frame. */
function ProductMock() {
  const bars = [52, 74, 41, 88, 63, 96, 70]
  return (
    <div className="lp-mock">
      <div className="lp-mock-bar">
        <span /><span /><span />
        <div className="lp-mock-url">bizzlivo.com</div>
      </div>
      <div className="lp-mock-body">
        <aside className="lp-mock-side">
          <div className="lp-mock-logo" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div className={`lp-mock-navitem ${i === 0 ? 'on' : ''}`} key={i} />
          ))}
        </aside>
        <div className="lp-mock-main">
          <div className="lp-mock-kpis">
            {['Members', 'Completion', 'Available'].map((k) => (
              <div className="lp-mock-kpi" key={k}>
                <span>{k}</span>
                <strong />
              </div>
            ))}
          </div>
          <div className="lp-mock-chart">
            {bars.map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="lp-mock-rows">
            {Array.from({ length: 4 }).map((_, i) => (
              <div className="lp-mock-row" key={i}><span /><span /><span /></div>
            ))}
          </div>
        </div>
      </div>
      <div className="lp-mock-glow" aria-hidden />
    </div>
  )
}
