# Shield Standalone — Quick Start Guide

## What is Shield?

Shield is a **completely independent web application** for construction professionals to capture, verify, and cryptographically seal evidence of work performed on job sites.

**Key fact:** Shield has **zero dependencies** on TradeDeck. It's a self-contained app that runs at `https://tradedeckapp.com/shield`.

## For Users: Getting Started

### 1. Sign Up

1. Go to `https://tradedeckapp.com/shield`
2. Click **Sign up**
3. Enter email and password
4. Check email for confirmation link
5. Click the link to confirm
6. Sign in with your email and password

### 2. Create a Shield Job

1. Navigate to **My Jobs** tab
2. Click **+ New Shield Job**
3. Fill in:
   - **Job Name** (e.g., "Kitchen Renovation")
   - **Trade Category** (Framing, Roofing, Electrical, etc.)
   - **Description** (optional but recommended)
4. Click **Create Job**

Shield generates a job ID automatically. Share this with contractors who will upload evidence.

### 3. Share Job with Contractors

Share the job ID or link with contractors:
```
https://tradedeckapp.com/shield?job={job_id}
```

They sign in with their own Shield account and can start uploading photos.

### 4. Upload Evidence Photos

**On Mobile (with camera):**
1. Click **+ Upload Evidence**
2. Select your Shield Job
3. Take a photo (or choose from photos)
4. Add notes (optional, e.g., "Foundation complete")
5. Click **Upload**

**On Desktop:**
1. Click **+ Upload Evidence**
2. Select your Shield Job
3. Choose a photo from your computer
4. Add checkpoint description
5. Click **Upload**

Each photo is cryptographically **sealed** with:
- Photo content (SHA256 hash)
- Timestamp
- GPS location (if available)
- Your device fingerprint (optional)

This seal prevents tampering—any edit to the photo after sealing is detectable.

### 5. View Progress

In the **Dashboard** tab, you'll see:
- **Active Jobs** — jobs in progress
- **Completed Verifications** — sealed and verified evidence
- **Total Photos** — all uploaded evidence
- **Recent Activity** — timeline of uploads and verifications

### 6. Export as PDF

When you're done collecting evidence:
1. Go to **My Jobs**
2. Select a completed job
3. Click **Export PDF**

The PDF includes:
- All photos in a 2-column layout
- Checkpoint descriptions
- Timestamps and cryptographic hashes
- Footer with integrity verification info

Share the PDF with inspectors, lenders, or insurers. They can verify it's genuine without contacting us.

### 7. Subscribe to Pro (Optional)

Shield Pro ($49/month) includes:
- ✅ Unlimited jobs and photos
- ✅ Priority verification (2-hour turnaround)
- ✅ Advanced analytics dashboard
- ✅ Contractor scoring
- ✅ Team access (up to 5 users)

Go to **Settings** and click **Subscribe Now** to enable.

---

## For Developers: Integration

### Prerequisites
- Node.js 16+ (optional, for local testing)
- Supabase account (free tier)
- Basic HTML/JavaScript knowledge

### Running Locally

```bash
# Clone the repo
git clone https://github.com/wood1974/Tradeneck.git
cd Tradeneck/shield

# Option 1: Simple HTTP server
python3 -m http.server 8000
# Visit http://localhost:8000

# Option 2: Node.js
npx http-server
# Visit http://localhost:8080

# Option 3: VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

### Configuration

Edit `shield/index.html`, search for `CONFIG`:

```javascript
const SUPABASE_URL = '...';           // Your Supabase project URL
const SUPABASE_ANON_KEY = '...';      // Your Supabase anon key
const STRIPE_PK = '...';              // Your Stripe publishable key
const API_BASE = 'https://tradedeck-api.onrender.com';  // Backend URL
```

### API Examples

**Create a Shield job:**
```javascript
const response = await fetch('https://tradedeck-api.onrender.com/api/shields', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Roof Installation',
    trade: 'roofing',
    description: 'New architectural shingles'
  })
});
const job = await response.json();
console.log(job.id);  // Use this to reference the job
```

**Upload photo evidence:**
```javascript
// Step 1: Request a nonce (single-use challenge)
const nonce = await fetch(`/api/shields/${job_id}/issue-nonce`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// Step 2: Seal the photo with the nonce
const formData = new FormData();
formData.append('photo', photoBlob);
formData.append('note', 'Ridge cap complete');
formData.append('nonce', nonce.nonce);
formData.append('gps_lat', 40.7580);
formData.append('gps_lon', -111.8761);

const sealed = await fetch(`/api/shields/${job_id}/seal-photo`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
}).then(r => r.json());

console.log(sealed.bind_hash);  // 64-char cryptographic seal
```

See **BACKEND_INTEGRATION.md** for complete API reference.

---

## Architecture

Shield is structured as a **single-file SPA** (1000+ lines of HTML/CSS/JavaScript):

```
index.html
├── <head>
│   ├── Supabase SDK (from CDN)
│   ├── Styles (embedded)
│   └── GA4 (optional)
├── <body>
│   ├── Auth modal
│   ├── Main app
│   │   ├── Header (logo, logout)
│   │   ├── Tabs (Dashboard, Jobs, Photos, Settings)
│   │   └── Modals (New Job, Upload, etc.)
│   └── JavaScript (all app logic)
└── <script>
    ├── Supabase client init
    ├── Auth functions
    ├── Job management
    ├── Photo upload
    ├── Dashboard stats
    └── UI helpers
```

**No build step required** — the whole app is a single `.html` file. Open it in any browser.

---

## Troubleshooting

### "Auth failed" or "Invalid token"
- Clear browser cache and cookies (Ctrl+Shift+Delete)
- Check Supabase project is accessible: `https://jlaajejpqjldpbinktln.supabase.co/auth/v1/health`
- Verify Supabase credentials in `index.html`

### Photos not uploading
- Check backend is online: `curl https://tradedeck-api.onrender.com/health`
- Verify backend logs in Render dashboard
- Check file size < 5MB
- Verify `shield-photos` storage bucket exists in Supabase

### "Location speed exceeded threshold"
- This is actually a security feature! It means the GPS data detected impossible speeds (e.g., traveling 1000 miles in 10 seconds), which indicates GPS spoofing.
- If this is a false positive, disable GPS by not sending `gps_lat`/`gps_lon` parameters.

### "Nonce expired or already used"
- Each nonce is valid for 120 seconds only
- Once a photo is sealed, the nonce is consumed (single-use)
- Request a new nonce for the next photo: `POST /api/shields/{job_id}/issue-nonce`

### App not loading
- Check browser console for errors (F12 → Console tab)
- Verify Netlify deploy succeeded: `https://app.netlify.com/sites/calm-cupcake-a213bb`
- Try accessing `/shield/index.html` directly
- Clear browser cache

---

## Deployment Checklist

- [ ] Clone repo: `git clone https://github.com/wood1974/Tradeneck.git`
- [ ] Verify Supabase credentials in `shield/index.html`
- [ ] Test locally: `python3 -m http.server 8000`
- [ ] Test sign-up flow (email confirmation)
- [ ] Test job creation
- [ ] Test photo upload (use test Stripe key first)
- [ ] Export PDF and verify integrity
- [ ] Push to main: `git push origin main`
- [ ] Monitor Netlify deploy: https://app.netlify.com/sites/calm-cupcake-a213bb
- [ ] Verify live at `https://tradedeckapp.com/shield`
- [ ] Swap Stripe test key to live key (pk_live_...) in production
- [ ] Monitor error logs (Sentry, Netlify, Supabase)

---

## Next Steps

1. **Users:** Start capturing evidence in your Shield jobs
2. **Developers:** Extend Shield with new features (see ROADMAP in README.md)
3. **Admins:** Set up contractor scoring and verification workflow
4. **Product:** Collect user feedback for Phase 2 enhancements

---

## Support

**Documentation:**
- `README.md` — Feature overview
- `ARCHITECTURE.md` — System design
- `DEPLOYMENT.md` — Deployment guide
- `BACKEND_INTEGRATION.md` — API reference

**Help:**
1. Check browser console (F12) for errors
2. Check Netlify Deploys for build failures
3. Check Supabase Logs for database/auth errors
4. Check Render logs for backend API errors
5. Ask in GitHub Issues (if available)

---

## Glossary

**Shield Job** — A single construction project with a unique ID. Jobs contain multiple photos.

**Evidence Photo** — A JPEG/PNG image sealed with metadata (timestamp, GPS, nonce, device hash).

**Nonce** — A 32-byte random challenge issued once, used once, then consumed. Prevents replay attacks.

**Bind Hash** — SHA256 hash of (photo + metadata). Acts as an immutable seal—any change to the photo breaks the hash.

**Device Binding** — Optional feature that detects if the same device is being used for all photos. Prevents device theft.

**GPS Spoofing Detection** — Checks if claimed GPS locations would require impossible speeds (>250 mph). Detects fake location claims.

**RLS (Row-Level Security)** — Supabase feature that enforces access control at the database level. Users see only their own data.

**Signed URL** — Time-limited HTTPS link to download a private storage file. Expires after 1 hour.
