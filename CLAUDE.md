# CLAUDE.md — tradedeck (frontend, repo: Wood1974/Tradeneck)

Guidance for Claude Code (or any agent) working in this repo. This is the
**frontend** of TradeDeck — a marketplace app connecting homeowners,
general contractors, and workers, built around full transparency, a
verified trust/tier system, and milestone-based escrow.

This file was **rewritten Sep 2026 against the live code and the live
Supabase database** (both were verified directly). The previous version
had drifted badly — it described a schema that "had not been run against
real Supabase" and a backend that "has no escrow code," both of which are
now false. **Verify against the code and the live DB, not against history
or notes, before building on top of a feature.**

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

- `index.html` — **the single mobile-first SPA** and the whole app. Uses
  Supabase directly (`@supabase/supabase-js@2` from jsDelivr, project
  `jlaajejpqjldpbinktln`) for auth and all data. Email+password sign-in and
  sign-up; on success it shows the in-page app shell. Screens: **Home,
  Find Work, Post Job (with an optional draw-schedule builder), Draw
  Manager, Profile, Admin**. The old `app.html` desktop shell has been
  **deleted** — there is one frontend now, not two.
- `_headers` — Netlify response headers; sets the site-wide
  Content-Security-Policy.
- `wrangler.jsonc` — Cloudflare (Wrangler) static-assets config
  (`directory: "."`). The site is wired for **both** Netlify and Cloudflare
  static hosting; confirm with the owner which is actually serving
  production before assuming.
- **No backend copy lives here anymore.** The stale `app.py` that used to
  sit in this repo "for reference" has been removed — the real, current
  backend is the `tradedeck-api` repo. Don't re-add a backend file here.

### The frontend does NOT call the backend API yet

`index.html` contains **zero** references to `tradedeck-api.onrender.com`.
It talks only to Supabase directly. That means everything the Flask API
does — Stripe Connect onboarding, escrow create/release/refund, AI photo
review, and the entire TradeDeck Shield product — has **no UI wired to it**
here. Wiring the Draw Manager to the escrow endpoints (fund / approve /
release) and adding photo upload is the biggest single piece of remaining
frontend work. When you add any call to the API or to Stripe.js, you must
add the new host (e.g. `js.stripe.com`, `api.stripe.com`) to the CSP in
**both** `_headers` and any CSP `<meta>` tag, or Netlify's CSP header will
silently block it in production (a local `file://` test won't catch this —
test over http(s)).

### Admin tab is cosmetic only

The Admin nav button is shown only when `profiles.is_admin` is true, and
that check is **cosmetic** — it just shows/hides the tab. Real enforcement
is the "Admins have full access" RLS policies (from an `admin-setup.sql`
that may or may not have been run against the live DB). The code tolerates
`profiles.is_admin` not existing yet. Never treat the hidden tab as a
security boundary.

## Live Supabase schema (verified against production, Sep 2026)

The schema is **live and far larger than old notes claimed — 25 tables,
all with RLS enabled.** Highlights:

- `jobs` uses **`owner_id`**, **`trade`**, **`rate`** (not `posted_by`,
  `trade_type`, `pay`). Also has a `source` column: **1,777 rows are
  `source='ksl'`** (the KSL scraper has run) plus a handful of native
  `source='tradedeck'` postings. Find Work has real content already.
- Draw milestones live in **`draws`** (`milestone_order`, `milestone_name`,
  `percentage`, `amount_cents`, `verifier_type`, `status`, and now
  **`payee_id`** — added Sep 2026). **`draws.job_id` is a FK to
  `draw_schedules.id`, not `jobs.id`** — `draw_schedules` is the layer
  between a job and its draws and carries its own `owner_id`. `index.html`
  already handles this correctly (`draws_schedule_id_fkey`); don't
  "fix" it to point at `jobs.id`.
- Escrow: `stripe_escrow`, `escrow_ledger`, `draw_events`,
  `draw_photos`, and `stripe_webhook_events` (webhook idempotency —
  created Sep 2026).
- Messaging: `conversations`, `conversation_members`, `messages`.
- Trust/social: `profiles` (tier + rating columns, rating recalculated by
  DB functions), `reviews`, `worker_profiles`, `contact_requests`,
  `connection_requests`, `applications`.
- **TradeDeck Shield** suite: `shield_jobs`, `shield_pivotal_points`,
  `shield_photos` (write-once, integrity columns trigger-locked),
  `shield_subscriptions`, `shield_completion_reports`,
  `shield_photo_custody_log`, `shield_custody_log` (append-only),
  `site_photos`. Backed by the `tradedeck-api` `shield_api.py` blueprint.
- Storage buckets: `draw-photos`, `shield-photos`, `site-photos`,
  `verifications` (all private — serve via signed URLs).
- A legacy `milestones` table still exists but the app uses `draws`.

Real-data counts as of this writing are tiny (2 profiles, 1 draw, 0
applications, 0 photos) — nothing below the jobs table has been exercised
end-to-end yet.

## Backend & data

- Auth + data: **Supabase** project `jlaajejpqjldpbinktln` ("Tradedeck").
  The anon key is hardcoded in `index.html` (safe — public, protected by
  RLS — **never** put the service role key here).
- **The dual-auth problem is resolved.** The backend was rewritten onto
  Supabase Auth; there is now one user system (Supabase JWT) end to end.
- Separate Flask API backend lives in the sibling repo **tradedeck-api**
  (tradedeck-api.onrender.com), Supabase-native, with real Stripe escrow
  and the Shield module. See that repo's CLAUDE.md.

## Trust / tier / verification (partially built)

- Five-tier ranking (Verified → Active → Proven → Trusted → TradeDeck Pro):
  `profiles` has the tier + rating columns and the DB has
  rating-recalculation functions, but the inputs (completed jobs, timeline
  adherence, cost variance, cleanliness) are not being written yet.
- Verification stack (identity → background → license → COI → quarterly
  monitoring): a `verifications` storage bucket exists; the flow is not
  built in the frontend.

## Deployment

- Netlify: `calm-cupcake-a213bb.netlify.app`, custom domain
  `tradedeckapp.com`. Cloudflare Wrangler config also present (see above).
- DNS via GoDaddy: `A @ → 75.2.60.5` (Netlify), `CNAME www →
  calm-cupcake-a213bb.netlify.app`.

## Conventions / working notes

- Solo-founder project (Joshua), iterating fast across many chat sessions
  — expect drift between what's described as "done" and what's committed.
  **Verify against the code and the live DB.**
- Hero copy (approved, don't rewrite without asking): *"Twenty years. Every
  nail. Every pour. Every roof. From foundation to ridge cap, I've built
  it, fixed it, and stood behind it — with hands that know the difference
  between a shortcut and a standard."*
- Keep secrets (Supabase service role key, Stripe secret key, Anthropic API
  key) out of this repo — those belong in the backend's environment config.

## Accept-application → payee flow (built Sep 2026)

The homeowner hires a contractor from the Find Work tab: their own job cards
show a **Manage applicants** button (`openApplicants`) that opens an overlay
listing everyone who applied (name, trade, tier, bid, message), each with a
**Hire** button. Hiring calls the `accept_application(p_application_id)`
Supabase RPC (`acceptApplicant`), which atomically marks that application
accepted, rejects the others on the job (single-hire model), and sets
`payee_id` on the job's `draw_schedules` **and** every `draw` under them —
the value the API's `require_draw_payee` reads. The Draw Manager then shows
the hired contractor on each schedule. The RPC is `SECURITY DEFINER`,
authorization-checked against `auth.uid()` (only the job owner can accept),
and granted to `authenticated` only. It was verified end-to-end (happy path
+ non-owner denial) against the live DB. Its migration lives in the
`tradedeck-api` repo (`supabase/migrations/`).

## Known-good next steps (Sep 2026)

1. Wire the Draw Manager to the escrow endpoints (fund via Stripe.js →
   approve → release) and add draw photo upload. Add Stripe hosts to the
   CSP when you do. **This is now the biggest remaining piece** — the payee
   is set, so escrow create/release has everything it needs server-side.
2. Move the Shield UI into this repo (it currently sits stranded in the API
   repo as `tradedeck-newest.html` / `shield_merged.js`).
3. Start writing the tier inputs so `profiles` ratings mean something.
4. Consider transitioning `jobs.status` to `filled` on hire (deliberately
   left `open` for now so the owner's Manage-applicants card stays visible;
   `loadData` only loads `status='open'` jobs, so changing it interacts with
   job visibility — decide that together).
