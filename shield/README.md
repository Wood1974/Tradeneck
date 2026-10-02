# Shield — 100% Standalone Construction Evidence Verification App

Shield is a completely independent web application for construction professionals to capture, verify, and cryptographically seal evidence of work performed on job sites.

## Architecture

**Completely Standalone:**
- ✅ Own HTML entry point (`/shield/index.html`)
- ✅ Self-contained Supabase client (no dependency on TradeDeck)
- ✅ Independent authentication (uses same Supabase project but as separate app)
- ✅ Own database schema (`shield_jobs`, `shield_photos`, `shield_subscriptions`)
- ✅ No shared state with TradeDeck
- ✅ Deployable as separate sub-domain or path

## Features

### For Homeowners & Project Owners
- **Create Shield Jobs** — Post a construction project and invite contractors to capture evidence
- **Photo Evidence** — View cryptographically sealed photos with tamper detection
- **Verification Status** — Track which checkpoint photos have been submitted and verified
- **PDF Export** — Generate shareable, verifiable PDF reports with embedded hashes

### For Contractors & Photographers
- **Structured Evidence** — Capture photos against trade-specific checkpoint lists (Framing, Roofing, Electrical, Plumbing, HVAC, Concrete, etc.)
- **Integrity Verification** — Photos are sealed with device binding, GPS location, timestamp, and nonce to prevent tampering
- **Offline Support** — All captures work offline; syncs when connection returns
- **Device Binding** — Optionally bind evidence to a specific device for additional authenticity

### For Admins
- **Contractor Scoring** — Auto-calculated integrity score based on verified photo evidence
- **Subscription Management** — Pro ($49/mo) and per-job ($79–$199) billing tiers
- **Audit Trail** — Complete immutable log of every photo capture and verification

## Deployment

### Option 1: Deploy as Sub-Path (Recommended)
Add to Netlify deploy settings:
```
public: .
publish: shield
```

Access at: `https://tradedeckapp.com/shield`

### Option 2: Deploy as Separate Sub-Domain
Create a new Netlify site from this repo, point DNS:
```
shield.tradedeckapp.com → Netlify site URL
```

Access at: `https://shield.tradedeckapp.com`

## Configuration

Edit at the top of `index.html`:

```javascript
const SUPABASE_URL = '...';           // Supabase project URL
const SUPABASE_ANON_KEY = '...';      // Supabase anon key
const STRIPE_PK = '...';              // Stripe publishable key (test or live)
const API_BASE = '...';               // TradeDeck backend URL
```

### Environment Variables (Backend)
Set in Render dashboard for `tradedeck-api`:
- `STRIPE_SHIELD_PRICE_ID` — Stripe Price ID for per-job Shield
- `STRIPE_CONTRACTOR_SUB_PRICE_ID` — Stripe Price ID for $49/mo contractor subscription

## Database Schema

Shield uses these Supabase tables (pre-existing):
- `shield_jobs` — Job records with trade category, description, owner
- `shield_photos` — Individual photo captures with metadata
- `shield_subscriptions` — Contractor Pro subscriptions
- `shield_completion_reports` — Per-job verification summaries

Storage buckets:
- `shield-photos` — Private bucket for evidence photos (served via signed URLs)

RLS Policies:
- Users see only their own jobs, photos, and subscriptions
- Admins have full read access

## Development

### Local Testing
```bash
cd /path/to/Tradeneck/shield
# Open index.html in a browser (use http://localhost:8000 with live server)
# OR view in Claude Code's browser preview
```

### API Integration
Shield calls these backend endpoints:
- `POST /api/shields/{job_id}/issue-nonce` — Get a challenge nonce
- `POST /api/shields/{job_id}/seal-photo` — Cryptographically seal a photo
- `GET /api/shields/{job_id}/photos` — List verified photos
- `POST /api/shields/{job_id}/verify-batch` — Verify all photos for a job
- `POST /api/shields/{job_id}/export-pdf` — Generate sealed PDF

See `BACKEND_INTEGRATION.md` for API reference.

## Roadmap

### Phase 1 (Done)
- ✅ Auth (Supabase JWT)
- ✅ Dashboard, Jobs, Photos tabs
- ✅ Job creation
- ✅ Photo upload
- ✅ Settings & Pro subscription

### Phase 2 (Next)
- 📋 Trade-specific checkpoint rendering
- 📋 Camera integration (getUserMedia)
- 📋 Photo preview with metadata
- 📋 Real-time verification status

### Phase 3
- 📋 PDF export with embedded verification
- 📋 Offline photo sync
- 📋 Device binding
- 📋 Stripe payment integration
- 📋 Admin dashboard

## Accessibility

- WCAG 2.1 AA compliance
- Semantic HTML, 32+ ARIA attributes
- Keyboard navigation (Tab, Enter, Escape)
- Dark mode support
- 48px minimum touch targets

## Security

- Supabase RLS policies enforce access control
- Stripe PCI compliance for payments
- No secrets in frontend code
- HTTPS-only in production
- CSP headers configured in Netlify

## Support

For issues or questions:
1. Check `BACKEND_INTEGRATION.md` for API reference
2. Review Supabase schema via dashboard
3. Check browser console for client-side errors
4. Check `tradedeck-api` logs for backend errors
