# CLAUDE.md — tradedeck (frontend, repo: Wood1974/Tradeneck)

Guidance for Claude Code (or any agent) working in this repo. This is the
**frontend** of TradeDeck — a marketplace app connecting homeowners,
general contractors, and workers, built around full transparency, a
verified trust/tier system, and milestone-based escrow.

This file reflects the **actual repo contents as of Sep 2026**, verified by
reading the code directly — not carried over from planning notes, which
had drifted significantly from what's actually committed. If you're
picking this project back up, read this whole file before assuming
anything is built.

## Product context

TradeDeck lets subs and contractors hire and be hired directly — benchmarked
against heypros.com with the explicit goal of doing it better. Core
principles baked into every feature decision:

- **Full transparency**: homeowners see both contractor and worker tiers,
  contractors see worker tiers, workers see contractor tiers. Direct
  contact between parties, no platform gatekeeping of communication.
- **Trust is earned from objective on-platform data**, not popularity:
  jobs completed, timeline adherence, cost variance vs. bid, and site
  cleanliness sign-offs.
- **Reviews are optional and never prompted.** A three-question binary
  close-out (on time? clean? would hire again?) silently feeds the tier
  score; a written review is opt-in and carries elevated weight.

## What's actually in this repo (verified)

- `index.html` — **mobile-first SPA** (primary app), now fronted by a static,
  crawlable marketing landing page (`#landing`) that is swapped for the app
  shell (`#app`) on login. Uses Supabase Auth directly, project
  `jlaajejpqjldpbinktln`. Screens: Home, Find Work, Post Job, Draws, Workers,
  Profile, Admin. **`app.html` no longer exists** — it is not in this repo on
  any branch, despite older notes describing it.
- `assets/app.js` — the SPA's JavaScript, extracted out of `index.html` so it
  can be deferred and cached (it was ~50 KB of render-blocking inline script).
  Loaded with `defer`, *after* the deferred Supabase tag; deferred scripts run
  in document order, so `supabase` is defined by the time this runs. **Do not
  remove `defer` from one without the other.**
- `assets/analytics.js` — GA4 loader + `td.*` event wrapper. No-ops entirely
  until `GA_MEASUREMENT_ID` is filled in at the top of the file.
- `assets/site.css` — marketing/landing styles, all namespaced `mk-`. Linked
  *before* `index.html`'s inline `<style>` so the app's own rules win on
  collisions. Note `.mk a` is (0,1,1), so any `mk-` rule that sets a link
  colour needs `.mk ` in front of it to out-specify it.
- Static marketing pages: `how-it-works.html`, `for-homeowners.html`,
  `for-contractors.html`, `for-workers.html`, `escrow.html`, `pricing.html`,
  `404.html`. Generated originally from one shared shell; now edit directly.
  Netlify serves these at extensionless URLs (`/pricing`).
- SEO/infra: `robots.txt`, `sitemap.xml`, `_redirects`, `site.webmanifest`,
  `og-image.png`, `favicon.ico`, `icon.svg`, `icon-192.png`, `icon-512.png`,
  `apple-touch-icon.png`.
- `_headers` — Netlify response headers: CSP plus nosniff, Referrer-Policy,
  Permissions-Policy, X-Frame-Options and cache rules.
- `app.py` — Flask API (Stripe Connect, escrow, AI photo review). Belongs in
  the `tradedeck-api` repo for deployment; included here for reference. All
  routes except `/` and `/stripe/webhook` require a Supabase JWT.
- **CSP note (important):** `_headers` is the only place the CSP lives now.
  It allows `cdn.jsdelivr.net`, `js.stripe.com` (script + `frame-src`, plus
  `hooks.stripe.com`), `api.stripe.com`, `*.supabase.co`,
  `tradedeck-api.onrender.com` and `googletagmanager.com`/`google-analytics.com`.
  Any new external call needs its host added here or Netlify silently blocks
  it in production. A local `file://` test will NOT catch this — serve over
  http(s). Before this was fixed, `js.stripe.com` was missing entirely and
  **escrow funding was broken in production**.

## Live Supabase schema (verified against production, Sep 2026)

The live `jobs` table uses **`owner_id`**, **`trade`**, **`rate`** (not
`posted_by`, `trade_type`, or `pay`). Draw milestones live in the **`draws`**
table with columns `milestone_order`, `milestone_name`, `percentage`,
`amount_cents`, `verifier_type`, `status`. Note: `draws.job_id` is a FK to
`draw_schedules.id`, not `jobs.id`. A legacy `milestones` table also exists
but the frontends should use `draws`.

## What's described elsewhere but NOT in this repo (verified absent)

- No `app.html`, no `tradedeck-app.html` mobile rebuild, no
  `draw_manager_frontend.html`, no `tradedeck-pitch.html`. Draw Manager and
  Profile **are** built into `index.html`.
- Stripe Connect / escrow / draw code **does** now exist in the frontend
  (`assets/app.js`: `openEscrowFunding`, `confirmEscrowPayment`,
  `connectStripe`, `submitDrawPhotos`, `drawAction`) talking to the Flask API.
  Earlier notes saying otherwise are out of date.

## Backend & data

- Auth + data: **Supabase** project `jlaajejpqjldpbinktln` ("Tradedeck").
  The anon key is hardcoded in `assets/app.js` (safe — it's meant to be
  public, protected by RLS — never put the service role key here). The
  Stripe **publishable** key (`pk_live_…`) is there too, which is also fine;
  the secret key must stay in the backend's environment only.
- `tradedeck_schema.sql` (profiles, jobs, applications, draws, plus a
  `draw-photos` storage bucket) was reconstructed fresh this session — the
  originally-referenced file couldn't be found in either repo — and
  verified by actually running it against a local Postgres instance
  (idempotent, no errors). **It has not yet been run against the real
  Supabase project.** Until it is, none of these tables exist there, and
  none of the frontend's Supabase calls will work against it.
- Separate Flask API backend lives in the sibling repo **tradedeck-api**
  (tradedeck-api.onrender.com) — uses its **own independent SQLite-backed
  auth system**, completely disconnected from Supabase Auth. See that
  repo's CLAUDE.md — this dual-auth situation is a real architectural
  problem to resolve before going further, not a documentation gap.

## Key features described in the product plan (not yet implemented in code)

These are real, well-specified plans — worth preserving — but confirmed
**not yet built** in either repo as of this writing:

- Verification stack (identity → license cross-check →
  COI upload/parse → quarterly monitoring).
- Five-tier ranking (Verified → Active → Proven → Trusted → TradeDeck Pro)
  computed from jobs completed, timeline adherence, cost variance, and
  cleanliness sign-offs. The `tradedeck_schema.sql` `profiles` table has
  columns for this, but nothing writes to them yet.
- ~~Draw/escrow system~~ — partially built now: milestone schedules, escrow
  funding via Stripe Payment Element, photo submission and approve/release
  through the Flask API all exist in `assets/app.js`. Dual verification
  (inspector as verifier) is still unbuilt.
- KSL Jobs scraper writing external listings into the `jobs` table
  (`source='ksl'`) — built as a separate standalone project (not part of
  either repo), delivered this session, not yet calibrated against live
  KSL markup or run.

## Deployment

- Hosted on Netlify: `calm-cupcake-a213bb.netlify.app`, custom domain
  `tradedeckapp.com`.
- DNS via GoDaddy: `A @ → 75.2.60.5` (Netlify), `CNAME www →
  calm-cupcake-a213bb.netlify.app`.
- `tradedeckapp.com` is the **canonical host**. `_redirects` 301s the
  `.netlify.app` hostname and `www.` to it so link equity does not split.
- **Netlify is the only host.** A Cloudflare Workers deploy
  (`hidden-meadow-a4db`, configured by a now-deleted `wrangler.jsonc`) used to
  build from this repo and serve the same static files — a duplicate host
  splitting link equity. It was torn down Sep 2026. Do not re-add a second
  static host without a 301 story; if you ever want Cloudflare in front of
  this site, put it in front of Netlify as a CDN/DNS layer rather than as a
  second origin.

## SEO

- Every page needs a unique `<title>` (≤60 chars), `<meta name="description">`
  (≤160), `<link rel="canonical">`, OG/Twitter tags and exactly one `<h1>`.
  New pages must also be added to `sitemap.xml`.
- **Not yet done:** Google Search Console + GA4 are not verified/created.
  `assets/analytics.js` is wired but inert until a Measurement ID is pasted in.
- **Next SEO step:** programmatic `/jobs/{trade}` and `/jobs/{trade}/{county}`
  pages with `JobPosting` schema, generated at build time from Supabase, to
  get listings into Google Jobs. Gate each combo page on having ≥3 real
  listings — thin location pages with nothing on them are a doorway-page risk.

## Conventions / working notes

- Solo-founder project (Joshua), iterating fast across many chat sessions
  — expect drift between what's described as "done" in notes and what's
  actually committed. **Verify against the code, not the history, before
  building on top of a feature.**
- Keep secrets (Supabase service role key, Stripe secret key, Anthropic API
  key) out of this repo — those belong in the backend's environment
  config only.
