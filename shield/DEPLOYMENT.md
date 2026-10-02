# Shield Standalone Deployment Guide

## What Changed

Shield is now a **completely independent application**:
- Own entry point: `/shield/index.html`
- Own authentication (Supabase JWT)
- Own database tables (`shield_jobs`, `shield_photos`, etc.)
- Zero dependencies on TradeDeck main app
- Can be deployed as separate sub-domain or path

## Current Setup: Path-Based Deployment

Shield is deployed alongside TradeDeck at `https://tradedeckapp.com/shield`

### Netlify Configuration

In Netlify site settings, Shield uses the default publish directory `shields/` but is accessible at the `/shield` path via the Netlify routing configuration (configured in `_redirects` file).

**File structure:**
```
Tradeneck/
├── index.html                 (TradeDeck main app)
├── assets/                    (shared assets)
├── shield/
│   ├── index.html            (Shield standalone app)
│   ├── README.md
│   ├── DEPLOYMENT.md
│   └── BACKEND_INTEGRATION.md
├── capture/                  (Shield Capture, separate)
│   └── index.html
└── _redirects                (Netlify routing)
```

### Routing Configuration

Add to `_redirects` (if not already present):
```
/shield           /shield/index.html   200
/shield/*         /shield/index.html   200
```

This ensures:
- `/shield` → serves `shield/index.html`
- `/shield/` → serves `shield/index.html`
- `/shield/any/path` → serves `shield/index.html` (SPA fallback)

### CSP Headers

Verify `_headers` includes Shield's backend endpoints in CSP `connect-src`:

```
content-security-policy: default-src 'self' https:; script-src 'self' https://cdn.jsdelivr.net https://js.stripe.com 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://jlaajejpqjldpbinktln.supabase.co https://tradedeck-api.onrender.com https://api.stripe.com;
```

Key allows:
- `jlaajejpqjldpbinktln.supabase.co` (Supabase)
- `tradedeck-api.onrender.com` (Backend API)
- `api.stripe.com` (Stripe)

## Alternative: Sub-Domain Deployment

To deploy Shield as `shield.tradedeckapp.com`:

1. **Create new Netlify site:**
   - Connect to `wood1974/Tradeneck` repo
   - Set publish directory: `shield`
   - Build command: (none, static files only)

2. **Update DNS:**
   ```
   CNAME shield.tradedeckapp.com → your-netlify-site.netlify.app
   ```

3. **Update configuration:**
   Edit `shield/index.html`:
   ```javascript
   // Change API base if needed
   const API_BASE = 'https://tradedeck-api.onrender.com';
   ```

## Continuous Deployment

Both deployment methods use Netlify's auto-deploy:
- Push to `main` branch → auto-deployed to production
- Push to feature branch → preview build
- Shield redeploys with TradeDeck (shared deploy)

### Deployment Status

Check Netlify Deploys tab:
- Main deploy (TradeDeck + Shield) lives at `calm-cupcake-a213bb.netlify.app`
- Custom domain maps to `tradedeckapp.com`

## Backend Integration

Shield calls these API endpoints:

### Authentication (Supabase)
- `POST /auth/v1/signup` → Create account
- `POST /auth/v1/token?grant_type=password` → Sign in
- `POST /auth/v1/logout` → Sign out

### Shield-Specific Routes
All routes require Supabase JWT in `Authorization: Bearer <token>` header.

```
POST   /api/shields/{job_id}/issue-nonce
       → Returns: { nonce, ttl_seconds }

POST   /api/shields/{job_id}/seal-photo
       → Body: FormData { photo, note, nonce, gps_lat, gps_lon, device_bind_hash }
       → Returns: { bind_hash, bind_ok }

GET    /api/shields/{job_id}/photos
       → Returns: [{ id, file_path, notes, bind_hash, created_at }, ...]

POST   /api/shields/{job_id}/verify-batch
       → Body: { photo_ids }
       → Returns: { verified_count, errors }

GET    /api/shields/{job_id}/export-pdf
       → Returns: PDF as application/pdf (Content-Disposition: attachment)
```

## Troubleshooting

### Shield app not loading
1. Check Netlify deploy log for build errors
2. Verify `_redirects` routing is working: `curl -L https://tradedeckapp.com/shield | head -20`
3. Check browser console for CSP violations
4. Verify Supabase credentials in `shield/index.html`

### Auth not working
1. Check Supabase status: `https://jlaajejpqjldpbinktln.supabase.co/auth/v1/health`
2. Verify JWT is being returned: check Network tab in DevTools
3. Check RLS policies in Supabase dashboard — should allow authenticated users to read/write their own data

### Photos not uploading
1. Check storage bucket exists: `shield-photos` in Supabase Storage
2. Verify RLS policies allow signed URL uploads
3. Check backend API is reachable: `curl https://tradedeck-api.onrender.com/health`
4. Check file size limits (default 5MB, configurable in backend)

### CORS issues
Add Shield backend URL to Supabase CORS whitelist (should already be `tradedeckapp.com`):
- Supabase dashboard → API Settings → CORS Allowed Origins
- Add: `https://tradedeckapp.com`

## Monitoring

### Error Tracking
- Netlify Analytics dashboard (automatic)
- Supabase logs: Dashboard → Logs
- Backend logs: Render dashboard → `tradedeck-api` → Logs

### Performance
- Netlify Speed Insights (automatic)
- Supabase database metrics (Dashboard → Logs → Database)
- Backend response times (Render dashboard)

## Rollback

If deployment breaks:

1. **Via Netlify:**
   - Netlify Deploys tab → Previous deploy → Publish

2. **Via Git:**
   - Git revert last commit: `git revert HEAD`
   - Push: `git push origin main`
   - Netlify auto-deploys

3. **Quick Fix:**
   - Edit `shield/index.html` directly in GitHub
   - Commit → auto-redeploy (2–5 minutes)

## Next Steps

- [ ] Deploy to production (`tradedeckapp.com/shield`)
- [ ] Run end-to-end test: auth → create job → upload photo → verify
- [ ] Monitor Netlify Deploy Logs for errors
- [ ] Verify CSP allows all external calls
- [ ] Test on mobile browsers (iPhone Safari, Android Chrome)
- [ ] Collect user feedback for Phase 2 features
