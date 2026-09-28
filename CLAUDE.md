# CLAUDE.md — tradedeck (frontend, repo: Wood1974/Tradeneck)

Guidance for Claude Code (or any agent) working in this repo. This is the
**frontend** of TradeDeck — a marketplace app connecting homeowners,
general contractors, and workers, built around full transparency, a
verified trust/tier system, and milestone-based escrow.

This file was rewritten Sep 2026 by reconciling two branches that had each
drifted from the other and, in places, from their own repo's code. **Verify
against the code and the live DB, not against history or notes, before
building on top of a feature** — this file has been wrong before and will
be again the moment something changes without an update here.

## Product context

TradeDeck lets subs and contractors hire and be hired directly, benchmarked
against heypros.com with the goal of doing it better. Principles baked into
every feature decision:

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

- `index.html` — a static, crawlable marketing landing page (`#landing`)
  that swaps for the app shell (`#app`) on login. Uses Supabase Auth
  directly, project `jlaajejpqjldpbinktln`. App screens: Home, Find Work,
  Post Job, Draws, Workers, Profile, Shield, Admin. **`app.html` does not
  exist** on any branch, despite older notes describing it.
- `assets/app.js` — the SPA's JavaScript, extracted out of `index.html` so
  it can be deferred and cached. Loaded `defer`, *after* the deferred
  Supabase tag; deferred scripts run in document order, so `supabase` is
  defined by the time this runs. **Do not remove `defer` from one without
  the other.**
- `assets/analytics.js` — GA4 loader + `td.*` event wrapper. No-ops until a
  `GA_MEASUREMENT_ID` is filled in.
- `assets/site.css` — marketing/landing styles, namespaced `mk-`. Linked
  *before* `index.html`'s inline `<style>` so the app's own rules win on
  collisions.
- Static marketing pages: `how-it-works.html`, `for-homeowners.html`,
  `for-contractors.html`, `for-workers.html`, `escrow.html`, `pricing.html`,
  `404.html`. Netlify serves these at extensionless URLs (`/pricing`).
- SEO/infra: `robots.txt`, `sitemap.xml`, `_redirects`, `site.webmanifest`
  (doubles as the PWA manifest — see below), `og-image.png`, `favicon.ico`,
  `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.
- `shield.js` — the **TradeDeck Shield UI** (mountable module, ~95KB).
  Loaded `defer`, after `assets/app.js`, so it can read the shared top-level
  `sb` Supabase client (both are classic `defer` scripts, which execute in
  document order and share one global lexical scope — no `window.sb`
  needed). Its functions attach to `window` (`renderShieldDashboard`,
  `renderShieldBrief`, `purchaseShieldPerJob`, `renderContractorUploadFlow`,
  `subscribeContractorToShield`, `renderShieldBadge`,
  `renderShieldCloseOutModal`). Calls the `/shield` backend endpoints and
  lazy-loads Stripe.js. Wired into `index.html` as a **Shield nav tab** →
  `renderShieldDashboard` on first open (`loadShield()` in `assets/app.js`).
  The deeper hooks (per-job brief in Post Job, contractor upload flow) exist
  but aren't mounted into those screens yet.
- `sw.js` + `site.webmanifest` — PWA support. `site.webmanifest` already
  had everything needed for installability (`display: standalone`, icons,
  theme/background color); `sw.js` adds the service worker (network-first
  for same-origin GETs, so a new deploy is picked up automatically when
  online, cache only as an offline fallback) plus an update banner wired up
  in `index.html`'s inline registration script. `_headers` forces
  `Cache-Control: no-cache`-equivalent revalidation on `/sw.js` itself —
  without that, browsers can get stuck running a stale worker and never see
  updates.
- `_headers` — Netlify response headers: the site-wide CSP, plus nosniff,
  Referrer-Policy, Permissions-Policy, X-Frame-Options and cache rules.
  **This is the only place the CSP lives** — `index.html` has no CSP
  `<meta>` tag. It allows `cdn.jsdelivr.net`, `js.stripe.com` (script +
  `frame-src`, plus `hooks.stripe.com`), `api.stripe.com`, `*.supabase.co`,
  `tradedeck-api.onrender.com`, and `googletagmanager.com`/
  `google-analytics.com`. Any new external call needs its host added here
  or Netlify silently blocks it in production — a local `file://` test will
  **not** catch this, serve over http(s) to test. (Before this was fixed
  once, `js.stripe.com` was missing and escrow funding was broken in
  production.)
- **No backend copy belongs here.** `tradedeck-api` is the real, current
  backend — don't re-add a Flask file to this repo "for reference."

### Admin tab is cosmetic only

The Admin nav button is shown only when `profiles.is_admin` is true, and
that check is **cosmetic** — it just shows/hides the tab. Real enforcement
is the "Admins have full access" RLS policies. The code tolerates
`profiles.is_admin` not existing yet. Never treat the hidden tab as a
security boundary.

## Live Supabase schema (verified against production, Sep 2026)

The schema is live, with 25+ tables, all RLS-enabled. Highlights:

- `jobs` uses **`owner_id`**, **`trade`**, **`rate`** (not `posted_by`,
  `trade_type`, `pay`), plus a `source` column (`'ksl'` vs `'tradedeck'`).
  **Don't hardcode a row count anywhere** — the KSL scraper runs on a daily
  cron and the table grows every day (289 rows on Sep 18, 659 on Sep 28, all
  but one of them `source='ksl'`); query it live instead of trusting a
  number in this file. Every table *below* `jobs` (`applications`,
  `draw_schedules`, `draws`, `stripe_escrow`, `draw_photos`) is still at
  **zero rows** as of this writing — the app has no real users yet, so no
  schema decision here has a migration cost or a customer to break.
- Draw milestones live in **`draws`** (`milestone_order`, `milestone_name`,
  `percentage`, `amount_cents`, `verifier_type`, `status`, `payee_id`).
  **`draws.job_id` is a FK to `draw_schedules.id`, not `jobs.id`** —
  `draw_schedules` is the layer between a job and its draws and carries its
  own `owner_id` and `payee_id`. `assets/app.js` already handles this
  correctly; don't "fix" it to point at `jobs.id`.
- Escrow: `stripe_escrow`, `escrow_ledger`, `draw_events`, `draw_photos`,
  `stripe_webhook_events` (webhook idempotency).
- Messaging: `conversations`, `conversation_members`, `messages`.
- Trust/social: `profiles` (tier + rating, rating recalculated by DB
  triggers), `reviews`, `worker_profiles`, `contact_requests`,
  `connection_requests`, `applications`.
- **TradeDeck Shield** suite: `shield_jobs`, `shield_pivotal_points`,
  `shield_photos` (write-once, integrity columns trigger-locked),
  `shield_subscriptions`, `shield_completion_reports`,
  `shield_photo_custody_log`, `shield_custody_log` (append-only),
  `site_photos`. Backed by the `tradedeck-api` `shield_api.py` blueprint.
- Storage buckets: `draw-photos`, `shield-photos`, `site-photos`,
  `verifications` (all private — serve via signed URLs).
- A legacy `milestones` table still exists but the app uses `draws`.

## Backend & data

- Auth + data: **Supabase** project `jlaajejpqjldpbinktln` ("Tradedeck").
  The anon key is hardcoded in `assets/app.js` (safe — public, protected by
  RLS — **never** put the service role key here). The Stripe **publishable**
  key (`pk_live_…`) is there too, which is also fine — publishable keys are
  meant to be client-visible; the secret key must stay in the backend's
  environment only. Escrow is live, not test mode.
- **The dual-auth problem is resolved.** One user system (Supabase JWT) end
  to end, frontend and backend.
- Stripe Connect / escrow / draw code exists in `assets/app.js`
  (`openEscrowFunding`, `confirmEscrowPayment`, `connectStripe`,
  `submitDrawPhotos`, `drawAction`) talking to the Flask API.
- Separate Flask API backend lives in the sibling repo **tradedeck-api**
  (tradedeck-api.onrender.com), Supabase-native, with the escrow state
  machine and the Shield module. See that repo's CLAUDE.md.

## Accept-application → payee flow

The homeowner hires an applicant from their own job card's **View
Applicants** overlay (`openApplicants` / `hireApplicant` in
`assets/app.js`). Hiring calls the `accept_application(p_application_id)`
Supabase RPC, which atomically marks that application accepted, rejects the
others on the job (single-hire model), and sets `payee_id` on the job's
`draw_schedules` row **and** every `draw` under it — the column the API's
`require_draw_payee` actually checks per-draw. The RPC is `SECURITY
DEFINER`, authorization-checked against `auth.uid()` (only the job owner
can accept), granted to `authenticated` only, and verified live against the
current DB (happy path + non-owner denial). `hireApplicant` then separately
sets `jobs.status = 'filled'` client-side. Its migration lives in the
`tradedeck-api` repo (`supabase/migrations/20260911140000_accept_application_rpc.sql`).

## Find Work / KSL trade + county filtering

The KSL Jobs sub-tab has two independent filter rows: **county** (all 29 UT
counties, pre-filtered to `nearbyCounties` = Salt Lake, Wasatch, Utah,
Weber, Davis, Summit) and **trade category** (`TRADE_CATEGORIES` in
`assets/app.js` — Electrical, Plumbing, HVAC, Framing, etc., plus "Other").
`jobMatchesTrade()` treats the default "All Trades" view as excluding
`Other` (most of the untagged KSL feed is not construction at all — retail,
driving, warehouse work), so a homeowner doesn't have to scroll a wall of
irrelevant listings to find trades. Each trade tab shows a live count.

## Trust / tier / verification (partially built)

- Five-tier ranking (Verified → Active → Proven → Trusted → TradeDeck Pro)
  is derived automatically. `rating`/`repeat_hire_rate` recompute from
  `reviews`; `jobs_completed` increments for the payee when a job's draws
  are all `released`; `tier` is derived from `jobs_completed` + `rating` on
  every profile write. Thresholds are a documented **starter** formula —
  timeline adherence, cost variance, and cleanliness sign-offs aren't
  captured yet and should refine the formula when they are.
- Verification stack (identity → background → license → COI → quarterly
  monitoring): a `verifications` storage bucket exists; the flow is not
  built in the frontend.

## Deployment

- Netlify: `calm-cupcake-a213bb.netlify.app`, custom domain
  `tradedeckapp.com` (the canonical host — `_redirects` 301s the
  `.netlify.app` hostname and `www.` to it).
- DNS via GoDaddy: `A @ → 75.2.60.5` (Netlify), `CNAME www →
  calm-cupcake-a213bb.netlify.app`.
- **Netlify is the only host.** A Cloudflare Workers deploy
  (`hidden-meadow-a4db`) used to build from this repo and serve the same
  static files — a duplicate host splitting link equity — and was torn
  down. Do not re-add a second static host without a 301 story; if
  Cloudflare goes in front of this site, it should be a CDN/DNS layer in
  front of Netlify, not a second origin.

## SEO

- Every page needs a unique `<title>` (≤60 chars), `<meta
  name="description">` (≤160), `<link rel="canonical">`, OG/Twitter tags,
  and exactly one `<h1>`. New pages must also be added to `sitemap.xml`.
- **Not yet done:** Google Search Console + GA4 are not fully verified.
  `assets/analytics.js` is wired but inert until a Measurement ID is filled
  in.
- **Next SEO step:** programmatic `/jobs/{trade}` and `/jobs/{trade}/{county}`
  pages with `JobPosting` schema, generated from Supabase. Gate each combo
  page on ≥3 real listings — thin pages with nothing on them are a
  doorway-page risk.

## Conventions / working notes

- Solo-founder project (Joshua), iterating fast across many chat
  sessions/agents in parallel — expect drift between branches, not just
  between notes and code. **Verify against the code and the live DB before
  building on top of a feature, and check what the *other* open branch or
  PR already did before re-doing it.**
- Hero copy (approved, don't rewrite without asking): *"Twenty years. Every
  nail. Every pour. Every roof. From foundation to ridge cap, I've built
  it, fixed it, and stood behind it — with hands that know the difference
  between a shortcut and a standard."*
- Keep secrets (Supabase service role key, Stripe secret key, Anthropic API
  key) out of this repo — those belong in the backend's environment config.

## Known-good next steps (Sep 2026)

1. Run a full escrow cycle in Stripe **live** mode end-to-end and confirm
   `bump_jobs_completed_on_release` actually fires — nothing below `jobs`
   has real rows yet, so this has never happened for real.
2. Wire Shield's deeper hooks: the per-job brief (`renderShieldBrief` /
   `renderShieldToggle`) into the Post Job flow, and the contractor upload
   flow (`renderContractorUploadFlow`) into the draw view. The Shield tab +
   dashboard are live; these hooks exist in `shield.js` but aren't mounted
   into those screens yet.
3. Programmatic SEO job pages (see SEO section above).
4. Calibrate the KSL scraper itself so `jobs.trade` is populated at ingest
   time — most rows arrive without a recognized trade and fall into
   "Other," which the Find Work trade tabs then hide by default. That's a
   UI workaround, not a fix; the real fix is upstream in the scraper.
