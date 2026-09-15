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

The complete file list is `CLAUDE.md`, `_headers`, `app.py`, `index.html`,
`wrangler.jsonc`. That is all of it — run `ls` before believing any note,
this one included.

- `index.html` — **the only frontend.** Mobile-first SPA. Uses Supabase Auth
  directly (`@supabase/supabase-js@2` from jsDelivr), project
  `jlaajejpqjldpbinktln`. Handles email+password sign-in and sign-up. On
  success it shows the in-page app shell (Home, Find Work, Post Job, Draws,
  Profile, Admin). Queries `owner_id`/`trade`/`rate` and the `draws` table,
  which matches production.
- `_headers` — Netlify response headers, sets a Content-Security-Policy for
  the whole site.
- `app.py` — Flask API (Stripe Connect, escrow, AI photo review). Belongs in
  the `tradedeck-api` repo for deployment; included here for reference. All
  routes except `/` and `/stripe/webhook` require a Supabase JWT.
- `wrangler.jsonc` — a Cloudflare Workers config, sitting alongside the
  Netlify `_headers`. Nothing in these notes explains why both exist; find
  out which one actually serves the site before trusting either.
- **`app.html` was deleted on 2026-09-02 (commit `b8e8ecf`)** and is not
  coming back by accident. Earlier versions of this file described it as a
  current desktop shell with its own CSP meta tag — it is gone, so `_headers`
  is now the *only* place a CSP is set.
- CSP note: `_headers` allows `fonts.googleapis.com`/`fonts.gstatic.com`
  (Google Fonts) and `tradedeck-api.onrender.com` in addition to Supabase.
  Add the host there for any new external call, or Netlify's CSP header will
  silently block it in production (a local `file://` test won't catch this —
  CSP host-matching behaves differently there; test over http(s)).

## Live Supabase schema (verified against production, Sep 2026)

The live `jobs` table uses **`owner_id`**, **`trade`**, **`rate`** (not
`posted_by`, `trade_type`, or `pay`). Draw milestones live in the **`draws`**
table with columns `milestone_order`, `milestone_name`, `percentage`,
`amount_cents`, `verifier_type`, `status`. Note: `draws.job_id` is a FK to
`draw_schedules.id`, not `jobs.id`. A legacy `milestones` table also exists
but the frontends should use `draws`.

## What's described elsewhere but NOT in this repo (verified absent)

- No `draw_manager_frontend.html`, no `tradedeck-pitch.html` marketing page.
  Draw Manager and Profile **are** built into `index.html`.
- No Stripe Connect / escrow / draw code anywhere in the frontend.
- A file named **`tradeneck-app.html` does exist outside this repo** — it was
  handed over on 2026-09-15 and is almost certainly a descendant of the
  deleted `app.html`. Do not merge it blind: it carries a wired
  `milestone-photos` storage upload that `index.html` lacks, but it queries
  **`posted_by`/`pay`/`trade_type` and the legacy `milestones` table**, none
  of which match production, and it contains **no sign-in at all** (zero
  password inputs, zero `signInWithPassword` — it only reads a session it
  assumes already exists). The photo path is worth porting; the schema and
  auth are not.

## Backend & data

- Auth + data: **Supabase** project `jlaajejpqjldpbinktln` ("Tradedeck").
  The anon key is hardcoded in `index.html` (safe — it's meant to be public,
  protected by RLS — never put the service role key here).
- **The schema IS live.** Verified by reading the project directly on
  2026-09-15. Earlier versions of this file said it "has not yet been run
  against the real Supabase project" — that is wrong. 27 tables exist with
  RLS enabled, including `profiles`, `jobs`, `applications`, `draws`,
  `draw_schedules`, `draw_events`, `draw_photos`, `escrow_ledger`,
  `stripe_escrow`, and the full `shield_*` set. `shield_photos` carries the
  comment *"Write-once. Integrity columns locked by trigger. No UPDATE or
  DELETE permitted"*, so Shield's append-only guarantees are enforced in
  production, not just in the migration files.
- `tradedeck_schema.sql` is **not in this repo** — do not go looking for it.
- **Row counts, 2026-09-15 — read these before planning any migration.**
  `jobs` 138 — of which **137 are `source='ksl'` and exactly one is not**;
  that single row is the only job in the system not produced by the scraper.
  `profiles` 4, `shield_jobs` 1, `shield_pivotal_points` 5, `shield_photos` 2.
  (Counts are exact `count(*)`, not the `reltuples` estimate the table
  listing returns — those two can disagree badly, so check with a real
  count before quoting a number in a document.)
  **Every other table is empty**: zero applications, conversations, messages,
  reviews, connection requests, draw schedules, draws, milestones, escrow
  rows, contact requests, worker profiles or verification docs.
  The app has no users yet. Nothing here has a migration cost, a
  compatibility constraint, or a customer to break — which means schema
  arguments are cheap and should be settled by looking, not debating.
- Both `draws` and `milestones` exist live and both are empty. Use **`draws`**:
  it has the supporting cast (`draw_schedules`, `draw_events`, `draw_photos`,
  `escrow_ledger`) and `index.html` already uses it. `milestones` is a bare
  leftover with nothing pointing at it.
- Separate Flask API backend lives in the sibling repo **tradedeck-api**
  (tradedeck-api.onrender.com) — uses its **own independent SQLite-backed
  auth system**, completely disconnected from Supabase Auth. See that
  repo's CLAUDE.md — this dual-auth situation is a real architectural
  problem to resolve before going further, not a documentation gap.

## Key features described in the product plan (not yet implemented in code)

These are real, well-specified plans — worth preserving — but confirmed
**not yet built** in either repo as of this writing:

- Verification stack (identity → background check → license cross-check →
  COI upload/parse → quarterly monitoring).
- Five-tier ranking (Verified → Active → Proven → Trusted → TradeDeck Pro)
  computed from jobs completed, timeline adherence, cost variance, and
  cleanliness sign-offs. The `tradedeck_schema.sql` `profiles` table has
  columns for this, but nothing writes to them yet.
- Draw/escrow system with milestone schedule, dual verification
  (owner/inspector), and Stripe Connect payouts. Schema exists (`draws`
  table); no application code exists yet in either repo.
- KSL Jobs scraper writing external listings into the `jobs` table
  (`source='ksl'`) — built as a separate standalone project (not part of
  either repo), delivered this session, not yet calibrated against live
  KSL markup or run.

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
