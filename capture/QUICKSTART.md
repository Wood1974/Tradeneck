# Shield Capture App - Quick Start Guide

## Setup (60 seconds)

### 1. Open the App
```bash
# Local testing
open /home/user/Tradeneck/capture/app.html

# Or via server (if hosted)
https://tradedeckapp.com/capture/app.html
```

### 2. Check Browser Console
- Open DevTools (F12)
- Check Console tab for initialization logs
- Verify IndexedDB created: DevTools → Storage → IndexedDB → ShieldCaptureDB

### 3. Start Capturing
1. Select a pack (e.g., "Remodel Package")
2. Click "Start Capture"
3. Wait for challenge (nonce) from backend
4. Capture first checkpoint

## Testing Scenarios

### Scenario 1: Full Capture Flow (No Backend)

**Setup:**
```javascript
// In DevTools Console
window.shieldApp.config.API_BASE_URL = 'http://localhost:3000'
```

**Mock Backend Response** (if no real backend):
1. When challenge requested:
   ```javascript
   // Intercept in APIClient
   async requestChallenge(packId) {
     return {
       nonce: 'test-nonce-' + Date.now(),
       issued_at: new Date().toISOString(),
       expires_at: new Date(Date.now() + 30*60000).toISOString()
     }
   }
   ```

2. When sealing:
   ```javascript
   async sealCheckpoint(...) {
     return {
       ok: true,
       photo_hash: 'sha256-mock-hash',
       signed_at: new Date().toISOString()
     }
   }
   ```

### Scenario 2: Camera Testing

**Mobile (Real Camera):**
1. Open app on phone
2. Select pack → Start
3. Click "Start Camera"
4. Allow permissions
5. Tap "Capture Photo"

**Desktop (Simulated):**
1. DevTools → Device Emulation (iPhone 12)
2. Reload page
3. Will fallback to file upload

### Scenario 3: Offline Mode

**Capture offline:**
1. Disable network (DevTools → Network → Offline)
2. Select pack, capture checkpoints
3. Photos stored in IndexedDB
4. Manifest stored locally
5. Enable network
6. Verify/submit flows

### Scenario 4: GPS Testing

**With mock GPS (enabled by default):**
1. Capture checkpoint
2. Click "Get GPS Location"
3. See coordinates: 40.7128, -74.0060 (Times Square)

**With real GPS:**
1. Set `ENABLE_MOCK_GPS: false` in config.js
2. App prompts for location permission
3. Uses browser geolocation API

### Scenario 5: Photo Upload

**Using file input:**
1. Click "Upload Photo" instead of camera
2. Select image from device
3. Preview displays before sealing

## Common Tasks

### Clear All Data
```javascript
// In Console
await window.shieldApp.storage.clear()
```

### Check IndexedDB Contents
```javascript
// Captures
const captures = await window.shieldApp.storage.getCapturesByPack('remodel')
console.log(captures)

// All packs
const packs = await window.shieldApp.storage.getPacks()
console.log(packs)
```

### Debug State
```javascript
// View current state
console.log(window.shieldApp.state)

// Check camera
console.log(await window.shieldApp.camera.isAvailable())
```

### Change Backend URL
```javascript
// Before pack selection
window.shieldApp.apiClient.baseURL = 'http://localhost:5000'
```

### Modify Config
```javascript
// Before starting app
CONFIG.ENABLE_MOCK_GPS = false
CONFIG.MAX_PHOTO_SIZE_MB = 5
CONFIG.MAX_NOTE_LENGTH = 500
```

## File Upload Testing

### Create Test Images
```bash
# 10px PNG
echo 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > /tmp/test.png

# Use in file input
document.getElementById('file-input').files = new FileList([new File(['...'], 'test.jpg')])
```

### Test File Size Limit
```javascript
// Try 15MB file (should fail)
const blob = new Blob([new ArrayBuffer(15 * 1024 * 1024)])
window.shieldApp.state.photoData = blob
window.shieldApp.sealCheckpoint() // Will error
```

## Performance Testing

### Measure Photo Upload
```javascript
console.time('upload')
await window.shieldApp.apiClient.sealCheckpoint(...)
console.timeEnd('upload')
```

### Check IndexedDB Size
```javascript
navigator.storage.estimate().then(est => {
  console.log('Used:', (est.usage / 1024 / 1024).toFixed(2), 'MB')
  console.log('Quota:', (est.quota / 1024 / 1024).toFixed(2), 'MB')
})
```

### Memory Usage
```javascript
performance.memory // Chrome only
```

## Backend Integration Checklist

- [ ] Backend ready at `https://tradedeck-api.onrender.com`
- [ ] `/api/challenges/issue` returns nonce with 30min expiry
- [ ] `/api/captures/:pack_id/seal` accepts multipart form data
- [ ] `/api/captures/:pack_id/verify` returns 9 checks
- [ ] `/api/manifests/:pack_id/submit` stores manifest
- [ ] `/api/manifests/:manifest_id/pdf` returns PDF blob
- [ ] CORS headers allow origin
- [ ] Rate limiting configured (if needed)

### Expected Backend Errors

```javascript
// 400: Missing required field
{ error: 'checkpoint_name required' }

// 400: Nonce expired
{ error: 'Challenge expired' }

// 400: Photo too large
{ error: 'Photo exceeds 10MB' }

// 409: Duplicate checkpoint
{ error: 'Checkpoint already captured' }

// 422: Verification failed
{ error: 'Verification failed', checks: [...] }
```

## Mobile Testing Checklist

- [ ] Viewport: iPhone SE (375×667)
- [ ] Viewport: iPad (768×1024)
- [ ] Viewport: Android (411×731)
- [ ] Camera permission flow
- [ ] Geolocation permission flow
- [ ] Safari (iOS) support
- [ ] Chrome (Android) support
- [ ] Keyboard doesn't cover inputs
- [ ] Modal slides up smoothly
- [ ] Touch targets >= 44×44px
- [ ] Dark mode rendering

## Browser DevTools Tips

### Simulate Conditions
1. Network tab → Throttling (Slow 3G, Offline)
2. Sensors → GPS coordinates (mock)
3. Console → Errors (tap camera toggle)

### IndexedDB Inspector
1. Storage → IndexedDB → ShieldCaptureDB
2. Click stores to view records
3. Expand captures to see photo data (binary)

### Performance
1. Performance tab → Record
2. Capture a photo
3. View timeline (camera, canvas, storage)

### Network
1. Network tab → XHR/Fetch filter
2. POST requests show seal/verify/submit
3. GET requests show PDF download

## Troubleshooting

### "Challenge request failed"
- Backend not running
- Wrong API URL (check config.js)
- CORS blocked (check backend headers)

### "Camera not available"
- HTTPS required (or localhost)
- Permissions denied (check Settings)
- Device has no camera

### "Failed to seal checkpoint"
- Backend `/seal` endpoint error
- Photo too large (> 10MB)
- Nonce expired (> 30 min)

### "IndexedDB open error"
- Storage quota exceeded
- Private browsing mode (limited IndexedDB)
- Browser plugin blocking

### Empty checkpoint grid
- Backend challenge request failed
- Check browser console for errors
- Verify pack ID is valid

## Quick Reference

### Command Shortcuts
```javascript
// Get app instance
app = window.shieldApp

// Full state
app.state

// Current captures
app.state.captures

// Storage
app.storage

// UI manager
app.ui

// API client
app.apiClient

// Show toast
app.ui.showToast('Message', 'success')

// Switch tab
app.ui.switchTab('manifest-review')

// Clear IndexedDB
app.storage.clear()
```

### URLs
- **App:** `https://tradedeckapp.com/capture/app.html`
- **Backend:** `https://tradedeck-api.onrender.com`
- **Challenge:** `POST /api/challenges/issue`
- **Seal:** `POST /api/captures/:pack_id/seal`
- **Verify:** `POST /api/captures/:pack_id/verify`
- **Submit:** `POST /api/manifests/:pack_id/submit`
- **PDF:** `GET /api/manifests/:manifest_id/pdf`

### Feature Flags (config.js)
```javascript
ENABLE_MOCK_GPS: true        // Always use mock coordinates
ENABLE_OFFLINE_MODE: true    // Store in IndexedDB
ENABLE_DEVICE_BINDING: false // Skip device validation
```

## Next Steps

1. **Deploy to Netlify:**
   ```bash
   cd /home/user/Tradeneck
   git add capture/
   git commit -m "Add Shield capture app"
   git push
   ```

2. **Verify Backend Endpoints:**
   - Implement 6 API endpoints (see README.md)
   - Test with curl or Postman
   - Check error handling

3. **Test Full Flow:**
   1. Select pack
   2. Capture 3 checkpoints
   3. Verify offline (should pass 9 checks)
   4. Submit manifest
   5. Download PDF

4. **Mobile Testing:**
   - Test on actual iPhone/Android device
   - Check camera and GPS flows
   - Verify responsive layout

5. **Performance Optimization:**
   - Measure photo upload time
   - Check IndexedDB query performance
   - Monitor memory usage

## Support

For issues or questions:
1. Check browser console (F12 → Console)
2. Review README.md for architecture
3. Check CLAUDE.md for project context
4. Run troubleshooting steps above
