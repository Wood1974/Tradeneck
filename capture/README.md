# Shield Evidence Capture App

A mobile-first web application for capturing, sealing, and verifying construction evidence across multiple checkpoint types. Supports offline operation with IndexedDB storage and syncs to backend when online.

## Architecture Overview

### File Structure

```
capture/
├── app.html              # Main SPA shell (HTML structure)
├── app.js               # Application logic, state management, API calls
├── camera.js            # Camera API wrapper (getUserMedia)
├── storage.js           # IndexedDB wrapper for offline storage
├── ui.js                # DOM manipulation and rendering
├── styles.css           # Mobile-first responsive styling
├── config.js            # Configuration constants and packs
└── README.md            # This file
```

### Core Components

#### 1. **ShieldCaptureApp** (app.js)
Main application class that coordinates all functionality:
- State management (current pack, nonce, captures)
- Event listener setup
- Tab switching logic
- Pack and checkpoint lifecycle

**Key Methods:**
- `init()` - Initialize storage, load packs, setup listeners
- `startPackCapture(packId)` - Request challenge and begin capture
- `sealCheckpoint()` - Submit photo/note to backend for sealing
- `verifyOffline()` - Verify all captures with backend
- `submitManifest()` - Finalize and submit captures
- `generatePDF()` - Download manifest PDF

#### 2. **StorageManager** (storage.js)
IndexedDB wrapper for offline-first storage:
- **Stores:**
  - `packs` - Pack definitions (fixed + custom)
  - `captures` - Individual checkpoint captures (photo + metadata)
  - `manifests` - Submitted manifests

**Key Methods:**
- `saveCapture()` - Store photo, note, GPS, nonce locally
- `getCapturesByPack()` - Retrieve all captures for a pack
- `updateCapture()` - Merge updates into existing capture
- `saveManifest()` - Store submitted manifest metadata

#### 3. **CameraManager** (camera.js)
Wrapper around getUserMedia API:
- Request camera permissions
- Stream video to `<video>` element
- Capture frame to canvas as JPEG blob
- Fallback to file input if camera unavailable

**Key Methods:**
- `isAvailable()` - Check if camera exists
- `start(videoElement)` - Open camera stream
- `capturePhoto()` - Freeze frame to blob
- `blobToBase64()` - Convert for transmission

#### 4. **UIManager** (ui.js)
DOM manipulation and rendering:
- Tab switching
- Pack/checkpoint rendering
- Form rendering (capture, manifest review, export)
- Toast notifications
- Modal dialogs
- Progress updates

**Key Methods:**
- `renderPackSelection()` - Render available packs
- `renderCheckpointGrid()` - Show checkpoints with status
- `renderCaptureForm()` - Build photo/note form in modal
- `renderManifestReview()` - Display all captures with photos
- `renderVerificationResults()` - Show 9-point verification checklist
- `showToast()` - Non-blocking notifications

#### 5. **APIClient** (app.js)
Backend communication:
- `requestChallenge()` - GET nonce from `/api/challenges/issue`
- `sealCheckpoint()` - POST to `/api/captures/:pack_id/seal`
- `verifyOffline()` - POST to `/api/captures/:pack_id/verify`
- `submitManifest()` - POST to `/api/manifests/:pack_id/submit`
- `getPDF()` - GET `/api/manifests/:manifest_id/pdf`

### State Model

```javascript
this.state = {
  currentPack: {
    id: 'remodel',
    name: 'Remodel Package',
    checkpoints: [{id, name}, ...]
  },
  currentNonce: 'challenge-abc123...',
  currentCheckpoint: {id: 'framing', name: 'Framing'},
  captures: [
    {
      pack_id: 'remodel',
      checkpoint_name: 'framing',
      photo_data: Blob,
      photo_data_url: 'data:image/jpeg;...',
      note: 'Wall studs installed',
      nonce: 'challenge-abc123...',
      gps_lat: 40.7128,
      gps_lon: -74.0060,
      gps_accuracy: 5,
      seal_ok: true,
      seal_response: {...},
      created_at: '2026-10-02T13:00:00Z'
    }
  ],
  manifestId: 'manifest-xyz789',
  cameraActive: false,
  photoData: Blob
}
```

## User Flow

### 1. Pack Selection
1. App loads fixed packs from config
2. Stores in IndexedDB for offline access
3. User selects a pack
4. Backend issues challenge (nonce) to `/api/challenges/issue`

### 2. Capture Session
1. For each checkpoint:
   - User taps "Capture" button
   - Modal opens with camera/file input
   - Optional: capture photo via camera or upload file
   - Optional: enter note (max 1000 chars)
   - Optional: capture GPS location (browser or mock)
   - Tap "Seal Checkpoint" → POST to `/api/captures/:pack_id/seal`
2. Backend returns seal result (ok/error)
3. Capture stored locally with seal status
4. Progress bar updates
5. Repeat for each checkpoint

### 3. Manifest Review
1. User reviews all captures with photos
2. Verifies notes, timestamps, GPS
3. Taps "Verify Offline" → POST to `/api/captures/:pack_id/verify`
4. Backend returns 9 invariant checks
5. If all pass, "Submit Manifest" enabled
6. Taps "Submit" → POST to `/api/manifests/:pack_id/submit`

### 4. Export
1. After submission, switch to Export tab
2. "Generate PDF" → GET `/api/manifests/:manifest_id/pdf`
3. Download or email PDF

## Configuration (config.js)

### Fixed Packs
```javascript
{
  id: 'remodel',
  name: 'Remodel Package',
  description: '...',
  pointCount: 8,
  checkpoints: [
    {id: 'before_exterior', name: 'Before - Exterior'},
    ...
  ]
}
```

### Environment Variables
- `API_BASE_URL`: Backend API endpoint (default: `https://tradedeck-api.onrender.com`)
- `DB_NAME`: IndexedDB name (default: `ShieldCaptureDB`)
- `ENABLE_MOCK_GPS`: Use mock coordinates in dev (default: true)
- `MAX_PHOTO_SIZE_MB`: File size limit (default: 10MB)
- `MAX_NOTE_LENGTH`: Character limit for notes (default: 1000)

## Camera & Media

### getUserMedia Constraints
```javascript
{
  video: {
    facingMode: 'environment',  // Back camera on mobile
    width: {ideal: 1920},
    height: {ideal: 1080}
  }
}
```

### Fallbacks
- **No camera:** File input enabled automatically
- **No geolocation:** Optional field, manual entry supported
- **No device binding:** Skipped if native app doesn't provide `device_bind_hash`

### Photo Handling
1. Captured frame drawn to `<canvas>`
2. Canvas converted to JPEG blob (90% quality)
3. Blob stored in IndexedDB
4. Also converted to data URL for preview
5. Blob sent to backend as multipart form data

## Offline Support

### Storage
- All packs cached in IndexedDB on first load
- Captures stored locally until sealing succeeds
- Metadata (nonce, GPS, timestamp) cached with photos
- Manifest metadata stored after submission

### Sync Strategy
- All API calls include fallback error handling
- On offline, captures stay in IndexedDB
- On online, captures can be resubmitted
- No automatic retry queue (manual for now)

## Verification (9 Checks)

Backend `/api/captures/:pack_id/verify` checks:
1. All checkpoints have photos
2. All photos < 10MB
3. GPS coordinates valid (if provided)
4. Timestamps in order
5. Nonce not expired
6. Device binding matches (if required)
7. Notes within length limit
8. Photo hashes match sealed values
9. No duplicate captures per checkpoint

## Responsive Design

### Breakpoints
- **320px-768px** (mobile): Single column, stacked buttons
- **768px-1440px** (tablet/desktop): Multi-column grid, side-by-side buttons
- **1440px+** (wide): Optimized spacing and max widths

### Mobile Features
- Native app viewport (safe area insets)
- Touch-optimized buttons (44px min height)
- Smooth scrolling on iOS
- Fixed header/tab bar
- Modal slides up from bottom
- Keyboard doesn't overlap inputs

## Accessibility

- ARIA labels on all interactive elements
- Keyboard navigation (Tab, Enter, Escape)
- High contrast colors (WCAG AA)
- Dark mode support via `prefers-color-scheme`
- Semantic HTML (buttons, labels, fieldsets)
- Status badges announce state to screen readers

## Development

### Local Testing
1. Open `/capture/app.html` in browser
2. DevTools console shows logs
3. IndexedDB visible in DevTools → Storage
4. Mock GPS enabled by default (config.js)

### Mock Backend
For testing without real backend:
- Modify `APIClient` methods to return mock data
- Preserve nonce validation logic
- Test seal/verify/submit flows

### Feature Flags
```javascript
ENABLE_MOCK_GPS: true        // Use mock coordinates
ENABLE_OFFLINE_MODE: true    // Store captures locally
ENABLE_DEVICE_BINDING: false // Skip bind_hash validation
```

## API Contract

### Request: Challenge
```
POST /api/challenges/issue
{
  pack_id: 'remodel'
}

Response:
{
  nonce: 'challenge-abc123...',
  issued_at: '2026-10-02T13:00:00Z',
  expires_at: '2026-10-02T13:30:00Z'
}
```

### Request: Seal Checkpoint
```
POST /api/captures/:pack_id/seal (multipart/form-data)
  photo: File
  checkpoint_name: 'framing'
  note: 'Wall studs installed'
  nonce: 'challenge-abc123...'
  gps_lat: 40.7128
  gps_lon: -74.0060
  gps_accuracy: 5

Response:
{
  ok: true,
  photo_hash: 'sha256-abc...',
  signed_at: '2026-10-02T13:05:00Z'
}
```

### Request: Verify Offline
```
POST /api/captures/:pack_id/verify
{
  captures: [
    {
      checkpoint_name: 'framing',
      nonce: 'challenge-abc123...',
      seal_response: {...}
    }
  ],
  nonce: 'challenge-abc123...'
}

Response:
{
  valid: true,
  checks: [
    {name: 'All photos present', passed: true},
    {name: 'Photo hashes match', passed: true},
    ...
  ]
}
```

### Request: Submit Manifest
```
POST /api/manifests/:pack_id/submit
{
  captures: [
    {
      checkpoint_name: 'framing',
      nonce: 'challenge-abc123...',
      seal_response: {...}
    }
  ],
  nonce: 'challenge-abc123...'
}

Response:
{
  manifest_id: 'manifest-xyz789',
  status: 'pending_review',
  created_at: '2026-10-02T13:15:00Z'
}
```

### Request: PDF Export
```
GET /api/manifests/:manifest_id/pdf

Response: Binary PDF blob
```

## Browser Support

- **Mobile:** iOS 13+, Android 8+ (camera via Chrome/Firefox)
- **Desktop:** Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Features:**
  - IndexedDB required (all modern browsers)
  - getUserMedia optional (fallback to file input)
  - Geolocation API optional (fallback to mock/manual)

## Performance

- Lazy load modules (each class is independent)
- IndexedDB async (non-blocking storage)
- Camera stream in background
- Canvas rendering throttled
- Toast animations use CSS transitions
- Grid layout with CSS Grid (native optimization)

## Security

### XSS Prevention
- All user input escaped with `escapeHtml()`
- No `innerHTML` with user data (except preview URLs)
- CSP headers (if behind reverse proxy)

### CORS
- Backend must allow `/api` endpoints from origin
- Form data (multipart) doesn't require preflight

### Authentication
- Nonce tied to session (backend validation)
- Captures sealed with backend signature
- Manifest requires verified nonce

## Troubleshooting

### Camera Not Working
- Check browser permissions (Settings → Camera)
- Ensure HTTPS (or localhost for testing)
- Try file upload fallback

### GPS Not Capturing
- Allow location permission
- Check browser geolocation setting
- Mock GPS used by default in dev

### IndexedDB Quota
- Check storage quota: `navigator.storage.estimate()`
- Clear app cache: `app.storage.clear()`
- Max photo size enforced to 10MB

### Backend Errors
- Check network tab for API responses
- Verify nonce not expired (30 min default)
- Ensure photos < 10MB
- Check backend logs

## Future Enhancements

1. **Device Binding** - UUID from native app for hardware verification
2. **Retry Queue** - Auto-retry failed seals when online
3. **Draft Packs** - Save in-progress captures across sessions
4. **Cloud Sync** - Multi-device sync via backend
5. **Offline Queue** - Background sync worker
6. **Batch Operations** - Upload multiple packs at once
7. **Photo Compression** - Client-side WebP compression
8. **Watermark** - Timestamp/GPS overlay on photos
9. **Audio Notes** - Voice recording fallback
10. **QR Codes** - Checkpoint verification codes

## Files Created

- `/home/user/Tradeneck/capture/app.html` (3.5 KB)
- `/home/user/Tradeneck/capture/app.js` (19.7 KB)
- `/home/user/Tradeneck/capture/camera.js` (3.2 KB)
- `/home/user/Tradeneck/capture/config.js` (3.7 KB)
- `/home/user/Tradeneck/capture/storage.js` (7.3 KB)
- `/home/user/Tradeneck/capture/ui.js` (12.1 KB)
- `/home/user/Tradeneck/capture/styles.css` (14.8 KB)
- `/home/user/Tradeneck/capture/README.md` (this file)

**Total:** ~64 KB of code (minified: ~45 KB)

## License

Same as TradeDeck project (see parent CLAUDE.md)
