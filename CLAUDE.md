# CLAUDE.md — tradedeck (frontend, repo: Wood1974/Tradeneck)

Guidance for Claude Code (or any agent) working in this repo. This is the
**frontend** of TradeDeck — a marketplace app connecting homeowners,
general contractors, and workers, built around full transparency, a
verified trust/tier system, and milestone-based escrow.

This file reflects the **actual repo contents as of Aug 2026**, verified by
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

- `index.html` — **mobile-first SPA** (primary app). Uses Supabase Auth directly
  (`@supabase/supabase-js@2` from jsDelivr), project `jlaajejpqjldpbinktln`.
  Handles email+password sign-in and sign-up. On success it shows the in-page
  app shell (Home, Find Work, Post Job, Draws, Profile, Admin). **Does not
  redirect to `app.html`.**
- `_headers` — Netlify response headers, sets a Content-Security-Policy for
  the whole site.
- `app.html` — **desktop marketing shell** with embedded sign-in, Find Work,
  Post Job wizard, Draw Manager, and Admin. Also uses Supabase directly.
  Both frontends must use the same live schema (see below).
- `app.py` — Flask API (Stripe Connect, escrow, AI photo review). Belongs in
  the `tradedeck-api` repo for deployment; included here for reference. All
  routes except `/` and `/stripe/webhook` require a Supabase JWT.
- Draw approve actions in both frontends call `POST /draws/:id/approve` on tradedeck-api (releases Stripe escrow when a record exists).
- Shared helpers live in `js/tradedeck-shared.js` (`escapeHtml`, `apiPost`).

## Live Supabase schema (verified against production, Sep 2026)

The live `jobs` table uses **`owner_id`**, **`trade`**, **`rate`** (not
`posted_by`, `trade_type`, or `pay`). Draw milestones live in the **`draws`**
table with columns `milestone_order`, `milestone_name`, `percentage`,
`amount_cents`, `verifier_type`, `status`. Note: `draws.job_id` is a FK to
`draw_schedules.id`, not `jobs.id`. A legacy `milestones` table also exists
but the frontends should use `draws`.

## Product gaps migration (Sep 2026)

Run `supabase_product_gaps.sql` in the Supabase SQL Editor before using:
- Hire / assign (`jobs.assigned_contractor_id`)
- Binary close-out columns on `reviews` (`on_time`, `clean`, `would_hire_again`)
- Tier recompute RPC `recompute_profile_tier(uuid)`

Frontend (`index.html`) wires: Hire on applicant rows, Fund escrow → Submit → Approve & release / Dispute refund, and binary close-out (written review optional).

## What's described elsewhere but NOT in this repo (verified absent)

- No `tradedeck-app.html` mobile rebuild, no `draw_manager_frontend.html`,
  no `tradedeck-pitch.html` marketing page. Draw Manager and Profile **are**
  built into `index.html` and `app.html`.
- No Stripe Connect / escrow UI was present historically; `index.html` Draw
  Manager now calls create / approve / refund on tradedeck-api. Full payment
  capture still requires Stripe keys on the API and a hired contractor.

## Backend & data

- Auth + data: **Supabase** project `jlaajejpqjldpbinktln` ("Tradedeck").
  The anon key is hardcoded in `index.html` and `app.html` (safe — it's
  meant to be public, protected by RLS — never put the service role key
  here).
- `tradedeck_schema.sql` (profiles, jobs, applications, draws, plus a
  `draw-photos` storage bucket) was reconstructed fresh this session — the
  originally-referenced file couldn't be found in either repo — and
  verified by actually running it against a local Postgres instance
  (idempotent, no errors). **It has not yet been run against the real
  Supabase project.** Until it is, none of these tables exist there, and
  none of `app.html`'s Supabase calls (once you wire them up) will work.
- Separate Flask API backend lives in the sibling repo **tradedeck-api**
  (tradedeck-api.onrender.com) — uses its **own independent SQLite-backed
  auth system**, completely disconnected from Supabase Auth. See that
  repo's CLAUDE.md — this dual-auth situation is a real architectural
  problem to resolve before going further, not a documentation gap.

## Key features described in the product plan (partially implemented)

- Verification stack (identity → background check → license cross-check →
  COI upload/parse → quarterly monitoring) — **not built**.
- Five-tier ranking — schema + `recompute_profile_tier` RPC ship in
  `supabase_product_gaps.sql`; frontend calls it after close-out. Still no
  automated job-completion / cost-variance pipeline.
- Draw/escrow — UI wired to create / approve / refund API routes; requires
  Stripe env on tradedeck-api and a hired contractor (`assigned_contractor_id`).
- Binary close-out — UI in `index.html`; needs SQL migration for boolean columns.
- Hire / assign — UI in `index.html`; needs `assigned_contractor_id` column.
- KSL Jobs scraper — separate project, not part of this repo.

## Deployment

- Hosted on Netlify: `calm-cupcake-a213bb.netlify.app`, custom domain
  `tradedeckapp.com`.
- DNS via GoDaddy: `A @ → 75.2.60.5` (Netlify), `CNAME www →
  calm-cupcake-a213bb.netlify.app`.

## Conventions / working notes

- Solo-founder project (Joshua), iterating fast across many chat sessions
  — expect drift between what's described as "done" in notes and what's
  actually committed. **Verify against the code, not the history, before
  building on top of a feature.**
- Hero copy (approved, don't rewrite without asking): *"Twenty years. Every
  nail. Every pour. Every roof. From foundation to ridge cap, I've built
  it, fixed it, and stood behind it — with hands that know the difference
  between a shortcut and a standard."*
- Keep secrets (Supabase service role key, Stripe secret key, Anthropic API
  key) out of this repo — those belong in the backend's environment
  config only.
