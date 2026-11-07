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

**Nov 2026 reconciliation. Read this before planning anything.** Four plans
were drafted in one session and three were killed, every time by something
that was either written here and untrue, or true and not written here. Both
CLAUDE.mds were then checked against the code, the live Supabase and the live
Render account. Three habits come out of it, and they are cheap:

1. **Query activity, not just schema.** The schema says what is possible; only
   the row counts say what is real. A close-out feature was fully designed
   against a correct reading of the schema, for a marketplace that has had
   **zero applications, ever**. See **Live Supabase schema** for the counts.
2. **Check the live Render account, not `render.yaml`.** They disagree, and the
   dashboard is what runs. `render.yaml` has no `DB_PATH` and no disk, so the
   backend's SQLite file is on ephemeral disk — though it holds only Shield
   capture v1 tables, not the marketplace's data. See the backend CLAUDE.md's
   **Data layer**, which claimed the opposite until now.
4. **Derive a doc from the code, never from the previous version of the doc.**
   The backend CLAUDE.md spent months describing an auth system, a leads
   aggregator and a chat proxy that had been deleted, because each rewrite
   trusted the last. A first pass at fixing it re-committed some of those
   claims as "corrected" — verifying the infrastructure carefully while taking
   the application description on faith. Read `app.py`.
3. **Check the other repo's CLAUDE.md before designing across the boundary.**
   A session was spent designing Shield-to-TradeDeck integration that the
   backend doc had already ruled out in writing.

## Working rules (set by the owner)

Standing instructions from the owner. They apply to every session in this repo, so don't wait to be told again.

- **Fix the root cause, once.** No workarounds or "for now" patches. If the real fix is bigger than asked, say so and propose it.
- **Always fix the cause; don't append.** If a change would add to a shared list, file or section that other work also edits, give it its own file instead. When the same conflict or error comes back, fix what makes it repeat, not just this instance.
- **Say what was verified and what wasn't.** Never overstate. If something couldn't be run or checked (a device, a live server, a dashboard), say that plainly.
- **The owner merges.** Open PRs as drafts and leave them. Don't merge, and don't start TestFlight or store builds or change live settings (Render env vars, DNS, Stripe, Apple) without the owner's go.
- **Don't watch PRs.** Opening a PR subscribes the session automatically; unsubscribe right away. Check CI only when asked.
- **Decide before building** anything that changes who can see data, what leaves the phone, or what costs money: ask first, with a recommendation.
- **Never print or repeat a password, key or token.** If one has been exposed (in chat, a screenshot, a log), say so plainly so it gets rotated.
- **Say early which steps only the owner can do** (DNS at GoDaddy, the Render shell, the Apple portal, rolling the Stripe key, merging).
- **Render: read freely, change only with permission.** Reading is allowed without asking: services, deploy history, logs, metrics, and the *names* of environment variables (never print a value). Anything that changes Render (environment variables, deploys or restarts, creating, suspending or deleting a service, disk or database) needs the owner's go each time, and says first exactly what it will change.
- **Keep status updates short.** Long reports only when asked.

## Shield app (`shield-app/`) decisions already made

- Live native camera only: no gallery, file picking or web camera.
- Close-out is solo (one person signs it), not multi-party.
- Administrator access is turned off for good at launch (`lock-admin`). After that, new people join by single-use invite code, made before the lock.
- Photos are stored on the Shield server disk and are readable only by the account that took them. No administrator route reads them.
- Honest labels: never say a photo is "attested" unless a server verified Apple's assertion. Say what was actually checked; a valid signature alone does not show the image matches.
- Construction content uses Utah building codes only.

### Shield is phone-only, and the two products are standalone (owner, Nov 2026)

- **Shield and TradeDeck are completely standalone.** They share the
  `tradedeckapp.com` domain and nothing else. This matches the backend
  CLAUDE.md verbatim — *"No integration with jobs."*
- **Nothing of Shield belongs in a web browser.** Shield is `shield-app/`, the
  Capacitor phone app, which signs in to its own server
  (`tradedeck-shield.onrender.com`) and never calls `tradedeck-api`.
- Therefore the **old web Shield is to be removed**, not extended: `shield.js`
  (95.8 KB), the `#screen-shield` screen, the Quick Actions and `#nav-shield`
  buttons, the `/shield` route and `loadShield()` in `assets/app.js`. On the
  backend, `shield_api.py` (60.8 KB) then has no caller left; retiring it is a
  separate decision and a separate PR.
- Removing it also kills a recurring bug class at the root rather than
  documenting its next instance: the `API_BASE` and `STRIPE_PK` global-scope
  collisions noted elsewhere in this file exist **only** because `shield.js`
  shares one classic-`defer` global scope with `assets/app.js`.
- **Do not propose feeding Shield evidence into TradeDeck profiles, tiers or
  jobs.** A full session was spent designing exactly that — a verifier for
  signed Shield close-out packets on the worker profile — before noticing it
  contradicted the standalone decision already written down. It was scrapped.
  If this ever gets revisited it is a product decision for the owner first, not
  an engineering plan.

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
  Post Job, Draws (hidden until escrow launches), Workers, Profile, Shield,
  Admin. **`app.html` does not
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
- `shield.js` — the **old web Shield UI**, 95.8 KB. **Slated for removal — see
  "Shield is phone-only" below. Do not build on it, do not extend it.**
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
- `shield-app/` — the **standalone Shield mobile app** (Capacitor 8 + Vite +
  TypeScript, no framework). It is not the Shield nav tab / `shield.js` above
  (that is the older web Shield, backed by `tradedeck-api`); the app signs in
  to its own server, `Wood1974/tradedeck-shield`. Sign-on needs a network once;
  after that capture, sealing and verifying work offline (SHA-256 + hash chain +
  ECDSA device signature per photo, IndexedDB vault, bundle verify), and sealed
  photos upload to the Shield server when there is signal. It has a **Build**
  tab (construction brief → locking questions → 5 checkpoints with IRC code
  references, Utah only → signed close-out packet). Pure logic lives in `shield-app/src/construction/` with vitest
  tests; see `shield-app/README.md`. `npm run build` there must stay green.
- **No backend copy belongs here.** `tradedeck-api` is the real, current
  backend — don't re-add a Flask file to this repo "for reference."

### Profile reads are locked down — use `profiles_public`, not `profiles`

`profiles` RLS now only lets a user read their **own** full row (plus
admins, via the existing "Admins have full access" policy). Any screen that
needs to show *someone else's* profile — Worker Directory, the Manage
Applicants overlay — must read the `profiles_public` **view** instead:
`id, full_name, company, trade, role, tier, jobs_completed, rating,
repeat_hire_rate, is_pro, tradedeck_verified, created_at,
background_verified` (a derived boolean, not the raw `checkr_status`). No
`email`, `phone`, `is_admin`, license/insurance/ID-upload flags, or raw
background-check fields are in it, on purpose. If you need a PostgREST
embed (`.select('...,profiles:applicant_id(...)')`), it will silently come
back empty for rows that aren't the caller's own — the view has no FK
PostgREST can embed through, so fetch it as a separate query and merge
client-side (see `openApplicants` in `assets/app.js` for the pattern).
Don't widen `profiles_public` or re-loosen `profiles_select` without
checking why they were narrowed — see the privacy fix noted in the backend
repo's migrations.

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
  cron and the table grows every day (289 rows on Sep 18, 659 on Sep 28,
  **1,814 on Nov 6**); query it live instead of trusting a number in this file.
- **Query activity, not just schema, before designing anything.** Verified live
  on **Nov 6 2026**: `applications` **0 — zero, ever**; `reviews` 0; `messages`
  0; `conversations` 0; `worker_profiles` 0; `contact_requests` 0; `profiles` 8,
  **none above tier 1**; `jobs` at `status='filled'` 0; `source='tradedeck'`
  jobs **6**, against **1,814** `source='ksl'`. Shield's own tables are the
  same story: `shield_jobs` 1, `shield_photos` 2, `shield_completion_reports` 0.
  A whole session was spent designing a job close-out feature that credits the
  payee on an *accepted application* before anyone checked that no application
  has ever existed — the code was correct and could never have fired. Reading
  the schema tells you what is *possible*; only the row counts tell you what is
  *real*. Do both.
- Every table *below* `jobs` (`applications`, `draw_schedules`, `draws`,
  `stripe_escrow`, `draw_photos`) is at **zero rows**, so no schema decision
  here has a migration cost or a customer to break.
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
  environment only. **Escrow is not launched ("coming soon")** — the code
  is in the app but switched off behind `ESCROW_ENABLED` (see below).
- **The dual-auth problem is resolved.** One user system (Supabase JWT) end
  to end, frontend and backend.
- Stripe Connect / escrow / draw code exists in `assets/app.js`
  (`openEscrowFunding`, `confirmEscrowPayment`, `connectStripe`,
  `submitDrawPhotos`, `drawAction`) talking to the Flask API, gated by
  `const ESCROW_ENABLED = false` at the top of the file. While it is
  false the Draws tab, `/draws` route, Post Job milestone builder and
  Profile Payouts card are hidden, draw data is not loaded, and each of
  those functions (plus `loadStripeJs`) returns before any request. The
  public pages (`escrow.html`, landing) say escrow is coming soon; keep
  that copy until the owner turns the flag on. The flag is client-side
  only — the backend is what actually has to refuse payments. As of Oct
  2026 `tradedeck-api` main has no `/stripe/escrow/create` or
  `/draws/<id>/approve` routes (removed with `escrow.py`); it still has
  `/stripe/connect/onboard`. Turning escrow on needs those back first.
  The escrow publishable key is `ESCROW_STRIPE_PK`, not `STRIPE_PK` —
  `shield.js` declares its own top-level `STRIPE_PK`, and two classic
  scripts declaring the same `const` stops `shield.js` from loading.
- Separate Flask API backend lives in the sibling repo **tradedeck-api**
  (tradedeck-api.onrender.com). See that repo's CLAUDE.md, which was rebuilt
  from `app.py` in Nov 2026 after being obsolete for a while. Verified there:
  it **is** Supabase-backed (`app.py` imports `create_client`; `auth.py`
  validates Supabase JWTs; `/api/jobs` reads `supabase_admin.table("jobs")`),
  so **the dual-auth problem is resolved — there is one user system**, exactly
  as this file says above. It **no longer holds the escrow state machine**
  (`escrow.py` deleted, no escrow or draw routes), so turning `ESCROW_ENABLED`
  on needs them restored there first — `assets/app.js`'s
  `/draws/<id>/approve` call currently has no server side. Its
  `shield_api.py` serves only the **old web Shield**, not the phone app. Its
  SQLite file is on ephemeral disk but holds only two tables (`custom_packs`,
  `manifests` — Shield capture v1), **not** auth, jobs or applications; those
  are all in Supabase.

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
- **The tier ladder is structurally frozen, and the cause is not escrow.**
  Verified live: `compute_profile_tier()` gates every tier above 1 behind
  `jobs_completed >= 1` (thresholds 25/10/3/1 with ratings 4.8/4.5/4.0), and the
  *only* thing that increments `jobs_completed` is the
  `bump_jobs_completed_on_release` trigger, which needs every `draw` on a
  `draw_schedule` at `released`. Escrow is off and the backend escrow routes are
  gone, so it can never fire. But even restoring escrow would not unfreeze it:
  there are **0 applications**, so nobody has ever been hired. A worker with a
  5.0 average from ten reviews still reads "Verified", tier 1. Reviews do work
  without escrow; the ladder they feed does not.
- **Tier 1 is labelled "Verified" and nothing is verified.** All 8 accounts sit
  there, including ones created seconds ago with no ID check, licence or COI,
  while `for-homeowners.html` tells homeowners the tier means something. This is
  the same failure the Shield rule already forbids — never claim "attested"
  unless something actually verified it. Rename tier 1 to "New", or gate the
  badge on a real check. Unfixed as of Nov 2026.
- **`update_profile_rating()` is an orphaned landmine — drop it.** It sits in
  the live database with no trigger attached, so it is inert *today*. It reads
  `j.posted_by`, a column that does not exist on `jobs` (it is `owner_id`), so
  it throws the moment anything wires it up; it carries contradictory
  thresholds (30/15/5/2 vs the live 25/10/3/1); and it sets `jobs_completed`
  from a **review count on jobs the user posted**, crediting the homeowner for
  hiring rather than the worker for working. Inverted and broken. One-line
  migration to remove.
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
- **Programmatic `/jobs/{trade}` pages: refused, do not revive without new
  inventory.** The idea was `/jobs/{trade}` and `/jobs/{trade}/{county}` pages
  with `JobPosting` schema generated from Supabase. It was investigated and
  rejected in Oct 2026 on the numbers: **1,814 of 1,820 jobs are scraped KSL
  listings.** Publishing them would breach Google's `JobPosting` guidelines
  (you may only mark up jobs you are authorised to list), count as scraped
  content under Google's spam policies — which is a **site-wide** risk, not a
  per-page one — and likely breach KSL's ToS. A "≥3 real listings" gate does
  not help when the listings themselves are someone else's. This becomes
  viable only once TradeDeck has its own job inventory; it is blocked on the
  KSL decision (next-steps item 5), not on engineering.

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

## Next steps, in priority order (Nov 2026)

The previous version of this list recommended wiring Shield's hooks into Post
Job and the draw view — which **contradicts the standalone decision above** —
and programmatic SEO job pages, which were refused because 1,814 of 1,820 jobs
are scraped KSL listings (Google scraped-content policy, `JobPosting`
guidelines, and KSL's ToS). Both are struck.

**Infrastructure first. None of the product items below matter while the
backend's data is not durable.**

1. **Decide whether Shield capture v1 is still in use.** `Tradedeck-api`'s
   SQLite file is on ephemeral disk and is lost on every deploy. It holds only
   `custom_packs` and `manifests` — Shield capture v1 — so the question is not
   "attach a disk" but "does this subsystem still have a job?" If
   `tradedeck-shield.onrender.com` superseded it, retire the store and the
   `/api/captures/*` and `/api/manifests/*` routes. If it is still live, sealed
   manifests are being destroyed on every deploy, which is severe. Attaching a
   disk before answering would be a patch on a possibly-vestigial subsystem.
   **Owner's call.** (Nothing else is at risk: jobs, profiles and applications
   are all in Supabase.)
2. **The standalone Shield server is deployed three times over**, two with
   separate 10 GB photo disks — a custody problem for an evidence product.
   Confirm which disk holds real photos, then suspend the rest. **Owner-only.**
3. **Decide which copy of the Shield server source is authoritative.** A full
   vendored copy lives in `Tradedeck-api/shield/` while the Render services
   deploy `Wood1974/tradedeck-shield`. Two copies of an evidence system's
   source is a silent correctness risk.
4. **GA4 Measurement ID** — `assets/analytics.js` is wired and inert without
   it. Two minutes, owner-only, and until it is set every product decision
   here is made blind. With 0 applications there is no way to tell whether
   nobody arrives, nobody signs up, or everyone bounces off Find Work.
5. **Decide what the KSL feed is for.** One decision that unblocks three
   things at once: SEO (doorway-page risk), Find Work UX (1,814 unactionable
   listings against 6 real ones, which is the likeliest reason the apply rate
   is zero), and ToS exposure. Either drop it, or split it out behind an honest
   "posted elsewhere" label with real TradeDeck jobs as the default view.
6. Remove the web Shield (see "Shield is phone-only" above).
7. Drop the orphaned `update_profile_rating()`; fix tier 1 claiming
   "Verified". Both described under **Trust / tier**.
8. **Product features last** — job close-out, and anything tier-related — once
   something above has produced a single real application. A close-out
   migration is already written, reviewed and **unapplied** on
   `claude/tradeckapp-seo-analysis-2meuw7` in `Tradedeck-api`; it credits the
   payee from an accepted application, so it cannot fire until one exists.
9. If escrow is ever switched on: restore the backend routes **first** (they
   are gone, `escrow.py` deleted — verified Nov 2026), then flip
   `ESCROW_ENABLED`, update the "coming soon" copy, and run a full cycle in
   Stripe live mode confirming `bump_jobs_completed_on_release` fires. It never
   has.
10. Calibrate the KSL scraper so `jobs.trade` is populated at ingest, if the
    feed survives decision 5. Most rows arrive untagged and fall into "Other",
    which the trade tabs hide by default — the UI filter is a workaround, the
    fix is upstream.
