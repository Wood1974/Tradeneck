# Shield Standalone Architecture

## Overview

Shield is a **100% standalone web application** independent from TradeDeck. It's a self-contained SPA (Single Page Application) that handles:
- User authentication
- Job management
- Photo evidence capture and sealing
- Cryptographic verification
- Stripe payments

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SHIELD FRONTEND                             │
│                      /shield/index.html (SPA)                        │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Auth Module              │ Jobs Module                          │ │
│  │ • Supabase JWT           │ • Create job                         │ │
│  │ • Sign in/up             │ • List jobs                          │ │
│  │ • Session management     │ • View job details                   │ │
│  ├─────────────────────────────────────────────────────────────────┤ │
│  │ Photos Module            │ Verification Module                  │ │
│  │ • Camera access          │ • Run integrity checks               │ │
│  │ • Photo upload           │ • Verify nonce single-use            │ │
│  │ • Offline storage        │ • Check GPS spoofing                 │ │
│  │ • Sync when online       │ • Validate device binding            │ │
│  ├─────────────────────────────────────────────────────────────────┤ │
│  │ Export Module            │ Settings Module                      │ │
│  │ • PDF generation         │ • Stripe subscription                │ │
│  │ • Checkpoint templates   │ • Account settings                   │ │
│  │ • Trade-specific flows   │ • Admin tools                        │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────┬──────────────────┬──────────────────┬────────────────────┘
           │                  │                  │
      ┌────▼────┐    ┌────────▼────────┐  ┌─────▼──────┐
      │ Supabase │    │  Stripe API     │  │ Backend API│
      │ (Auth)   │    │  /v1/charges    │  │ /api/shields
      │ (Data)   │    │  /v1/customers  │  │ /admin/...
      │ (Storage)│    │  /v1/coupons    │  │
      └────┬────┘    └────────┬────────┘  └─────┬──────┘
           │                  │                  │
       ┌───▼──────────────────▼──────────────────▼────────┐
       │         TradeDeck Backend / Supabase             │
       │                                                   │
       │  ┌─────────────────┐    ┌─────────────────────┐ │
       │  │  Supabase DB    │    │  Shield Storage     │ │
       │  │                 │    │                     │ │
       │  │ • shield_jobs   │    │ • shield-photos     │ │
       │  │ • shield_photos │    │   (file uploads)    │ │
       │  │ • profiles      │    │                     │ │
       │  │ • subscriptions │    │                     │ │
       │  └────────┬────────┘    └──────────┬──────────┘ │
       │           │                        │            │
       │  ┌────────▼─────────────────────────▼──────────┐ │
       │  │    RLS Policies (Row-Level Security)       │ │
       │  │  • Users see only their jobs/photos        │ │
       │  │  • Admins see all data                     │ │
       │  │  • Contractors can only upload to own jobs │ │
       │  └──────────────────────────────────────────────┘ │
       │                                                    │
       │  ┌─────────────────────────────────────────────┐  │
       │  │     Flask Backend (tradedeck-api)          │  │
       │  │  • Nonce generation & validation           │  │
       │  │  • Cryptographic sealing (SHA256)          │  │
       │  │  • GPS spoofing detection                  │  │
       │  │  • Device binding verification             │  │
       │  │  • PDF export with embedded hashes         │  │
       │  │  • Admin verification workflow             │  │
       │  └─────────────────────────────────────────────┘  │
       └───────────────────────────────────────────────────┘
```

## Data Flow

### Scenario 1: User Creates Job

```
User (Frontend)
    │
    ├─ [1] Enter job name, trade, description
    │
    ├─ [2] Click "Create Job"
    │
    └─► POST /api/shields
        │
        ├─ Validates trade is in allowed list
        ├─ Creates record in shield_jobs table
        ├─ Sets owner_id = current user
        ├─ Sets status = 'active'
        │
        └─► Returns { job_id, name, trade, status, created_at }
            │
            └─ [3] Frontend receives job_id
                  Loads job in modal
                  Updates jobs list
                  Shows job ID for sharing
```

### Scenario 2: Photographer Seals Evidence

```
Photographer (Frontend)
    │
    ├─ [1] Take photo with camera (getUserMedia)
    │
    ├─ [2] Click "Submit Photo"
    │        → Request nonce
    │
    ├─ [3] POST /api/shields/{job_id}/issue-nonce
    │        Supabase generates nonce: 32-byte random hex
    │        Stores in challenges table with 120s TTL
    │        Returns { nonce, expires_at }
    │
    ├─ [4] User enters checkpoint description and notes
    │
    ├─ [5] POST /api/shields/{job_id}/seal-photo (multipart)
    │        ├─ photo: image blob
    │        ├─ note: "Framing inspection complete"
    │        ├─ nonce: a1b2c3d4...
    │        ├─ gps_lat: 40.7580
    │        ├─ gps_lon: -111.8761
    │        ├─ device_bind_hash: sha256(IMEI+model) or null
    │
    │        Backend receives request:
    │        ├─ Reads photo_bytes into memory
    │        ├─ Gets nonce from DB (verifies exists & !expired)
    │        ├─ Marks nonce as consumed (single-use)
    │        ├─ Computes SHA256(photo + note + nonce + gps + timestamp + device_bind_hash)
    │        ├─ Stores in shield_photos table:
    │        │  • bind_hash: 64-char hex
    │        │  • bind_ok: true/false/null (device binding verdict)
    │        │  • location_verdict: consistent/spoofed/flag
    │        ├─ Uploads photo to shield-photos storage bucket
    │        │  (encrypted, private, served via signed URLs only)
    │
    │        Returns { photo_id, bind_hash, bind_ok, location_verdict }
    │
    └─ [6] Frontend displays: ✓ Photo sealed & verified
           Refreshes photos list
           Shows nonce consumed (can't reuse)
```

### Scenario 3: Owner Exports Verified PDF

```
Homeowner (Frontend)
    │
    ├─ [1] Click "Export as PDF" in job view
    │
    ├─ [2] GET /api/shields/{job_id}/export-pdf
    │        Backend queries all shield_photos for this job
    │        Sorts by timestamp
    │        Renders PDF layout:
    │        ├─ Header: job name, owner, trade, timestamp
    │        ├─ Grid: 2-column layout, photos at 4" width
    │        ├─ Per photo: image + checkpoint + notes + bind_hash (8 chars)
    │        ├─ Footer: manifest SHA256, chain head hash
    │        └─ Computes manifest_hash = sha256(all_bind_hashes)
    │
    └─ [3] Frontend receives PDF blob
           Downloads as Shield_JobName_Date.pdf
           Immutable evidence of work, can't be edited
```

### Scenario 4: Admin Verifies Job Offline

```
Admin (Backend or Frontend)
    │
    ├─ [1] Accesses admin dashboard
    │
    ├─ [2] GET /api/admin/shields (list all jobs)
    │
    ├─ [3] Selects a job to verify
    │
    ├─ [4] POST /api/admin/shields/{job_id}/verify
    │        Backend runs 9 invariant checks:
    │        ├─ assert_manifest_structure: Check all fields present
    │        ├─ assert_pack_checkpoint_correspondence: Checkpoints match trade
    │        ├─ assert_nonce_single_use: Nonce consumed only once
    │        ├─ assert_location_consistent: No impossible speeds (>250 mph)
    │        ├─ assert_device_consistency: Device hash stable (if provided)
    │        ├─ assert_capture_sequence_integrity: Photos in correct order
    │        ├─ assert_timestamp_monotonic: Timestamps increasing
    │        ├─ assert_no_manifest_tampering: Hashes unchanged
    │        └─ assert_bind_hash_validity: Each bind_hash is valid
    │        
    │        If all pass:
    │        ├─ Sets job status = 'verified'
    │        ├─ Records verdict in audit trail
    │        └─ Returns { verified_at, verdict: 'approved' }
    │
    └─ [5] Frontend displays: ✓ Job verified by admin
           Shows verification date and notes
           Evidence is now locked (immutable)
```

## Key Architecture Decisions

### 1. **Fully Standalone**
- No shared state with TradeDeck app
- Own entry point (`/shield/index.html`)
- Own auth session (Supabase JWT)
- Separate CSS/JS/HTML bundle

### 2. **Supabase for Auth & Data**
- Single source of truth for users
- RLS policies enforce access control
- No duplicate user databases
- Scales with platform

### 3. **Cryptographic Sealing on Backend**
- Frontend captures photo + metadata
- Backend seals with SHA256 hash
- Nonce ensures single-use (prevents replay)
- Device binding optional (adds tamper detection)

### 4. **Offline-First Photo Storage**
- Photos stored in IndexedDB during capture
- Syncs to backend when connection returns
- Metadata (timestamp, GPS, nonce) cached locally
- Immutable once sealed

### 5. **PDF Export with Embedded Verification**
- PDF contains all photos + metadata
- Manifest hash embedded in footer
- Can be verified offline using audit.invariants
- Shareable evidence (no backend call needed to view)

### 6. **Admin Verification System**
- 9 automated invariant checks
- Offline verification (no network required)
- Audit trail of every change
- Clear pass/fail verdict

## Security Model

### Authentication
- Supabase JWT tokens (HTTPs only)
- Session expires after 24 hours
- Refresh token auto-refreshes on page load

### Authorization (Data Access)
- RLS policies on all tables
- User sees only their jobs/photos
- Admins see all data
- Service role key never exposed to frontend

### Evidence Integrity
- Cryptographic sealing prevents tampering
- SHA256 hash can't be reversed
- Device binding detects phone theft
- GPS spoofing detection via Haversine formula
- Nonce ensures photo can only be submitted once

### Payment Security
- Stripe PCI compliance
- Never handle credit card data in frontend
- Stripe Elements for secure input
- Webhook signature verification on backend

## Scalability

### Current Capacity
- Supabase free tier: ~100 concurrent users
- Storage: 1GB free, paid tiers to 1TB
- Database: 500MB free, paid tiers to 256GB

### Upgrade Path
1. Move to Supabase Pro ($25/month)
2. Add custom Shield API (Flask routes)
3. Implement caching layer (Redis)
4. Add CDN for photo delivery (Cloudflare)
5. Scale to millions of photos with S3 + Lambda

## Monitoring & Logging

### Supabase Logs
- Access via Dashboard → Logs
- Query analytics, errors, RLS violations
- Real-time monitoring of auth/data issues

### Backend Logs
- Render dashboard → tradedeck-api → Logs
- Flask error logs, database queries
- Stripe webhook delivery logs

### Frontend Monitoring (Optional)
- Add Sentry or Rollbar for client errors
- Monitor CSP violations
- Track user interactions (Mixpanel/Amplitude)

## Deployment Topology

```
┌─────────────────────────────────────┐
│   Netlify (Static Hosting)          │
│                                      │
│  ├─ TradeDeck SPA (index.html)      │
│  ├─ Shield SPA (/shield/index.html) │
│  ├─ Capture SPA (/capture/index.html)
│  ├─ Marketing pages                 │
│  └─ CSP headers (_headers)          │
└──────────┬──────────────────────────┘
           │
           ├─ Domain: tradedeckapp.com
           ├─ CDN: Netlify (automatic)
           └─ SSL: Let's Encrypt (auto-renewed)
           
┌──────────────────────────────────────────┐
│  Supabase (Database & Auth)             │
│  jlaajejpqjldpbinktln.supabase.co       │
│                                          │
│  ├─ PostgreSQL 15                       │
│  ├─ Real-time subscriptions             │
│  ├─ Storage buckets (S3)                │
│  ├─ Auth (email+password)               │
│  └─ Backups (automatic daily)           │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  Render (Backend API)                   │
│  tradedeck-api.onrender.com             │
│                                          │
│  ├─ Python 3.11 + Flask                 │
│  ├─ Gunicorn (4 workers)                │
│  ├─ PostgreSQL connection pool          │
│  ├─ Stripe webhook receiver             │
│  └─ Persistent disk (/var/data)         │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  Stripe (Payment Processing)            │
│  api.stripe.com                         │
│                                          │
│  ├─ Card tokenization (js.stripe.com)   │
│  ├─ Charge creation                     │
│  ├─ Subscription billing                │
│  └─ Webhook notifications               │
└──────────────────────────────────────────┘
```

## Migration Path (TradeDeck → Shield-First)

1. **Today:** Shield standalone at `/shield`, TradeDeck at `/`
2. **Phase 1:** Move job marketplace features into Shield
3. **Phase 2:** Deprecate TradeDeck, migrate users to Shield
4. **Phase 3:** Shield becomes primary, TradeDeck archived

## Files & Directories

```
Tradeneck/
├── shield/                       # Standalone Shield app
│   ├── index.html               # Main SPA entry point
│   ├── README.md                # User guide
│   ├── ARCHITECTURE.md          # This file
│   ├── DEPLOYMENT.md            # Deployment guide
│   └── BACKEND_INTEGRATION.md   # API reference
│
├── capture/                     # Shield Capture sub-app
│   └── ...
│
├── index.html                   # TradeDeck main app (legacy)
├── assets/app.js               # TradeDeck SPA logic
└── _redirects                  # Netlify routing
```
