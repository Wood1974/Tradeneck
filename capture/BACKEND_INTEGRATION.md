# Backend Integration Guide

## Overview

The Shield Capture App communicates with the backend via 6 RESTful endpoints. This guide documents the exact API contract, error handling, and implementation notes.

## Endpoints Summary

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/api/challenges/issue` | Request capture nonce | Optional |
| POST | `/api/captures/:pack_id/seal` | Submit photo + metadata | Optional |
| POST | `/api/captures/:pack_id/verify` | Verify all captures offline | Optional |
| POST | `/api/manifests/:pack_id/submit` | Finalize manifest | Optional |
| GET | `/api/manifests/:manifest_id/pdf` | Download manifest PDF | Optional |

## 1. Challenge Issuance

**Purpose:** Get a time-limited nonce for a capture session.

**Request:**
```
POST /api/challenges/issue
Content-Type: application/json

{
  "pack_id": "remodel"
}
```

**Success Response (200):**
```json
{
  "nonce": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "issued_at": "2026-10-02T13:00:00Z",
  "expires_at": "2026-10-02T13:30:00Z",
  "challenge_id": "chal_abc123"
}
```

**Error Response (400):**
```json
{
  "error": "invalid_pack_id",
  "message": "Pack ID not found"
}
```

### Implementation Notes

- **Nonce Format:** JWT or opaque token, 30-minute expiry
- **Nonce Usage:** Must be included in all seal/verify/submit requests
- **Storage:** Backend validates nonce on each request (check expiry)
- **Per-Pack:** Each pack gets unique nonce (don't reuse across packs)
- **Idempotency:** Calling twice returns same nonce if within expiry
- **Rate Limit:** 60/hour per user (optional, recommended)

### Error Codes

| Code | Meaning |
|------|---------|
| `invalid_pack_id` | Pack not found |
| `pack_inactive` | Pack archived or disabled |
| `user_quota_exceeded` | User max challenges/hour exceeded |
| `rate_limited` | Too many requests |

## 2. Checkpoint Sealing

**Purpose:** Submit photo + metadata for a single checkpoint. Backend signs the capture.

**Request:**
```
POST /api/captures/:pack_id/seal
Content-Type: multipart/form-data

photo: <binary JPEG/PNG>
checkpoint_name: "framing"
note: "Wall studs installed"
nonce: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
gps_lat: 40.7128 (optional)
gps_lon: -74.0060 (optional)
gps_accuracy: 5 (optional, meters)
device_bind_hash: "sha256-abc123..." (optional)
```

**Success Response (200):**
```json
{
  "ok": true,
  "checkpoint_name": "framing",
  "photo_hash": "sha256:abc123def456...",
  "photo_size_bytes": 245632,
  "signed_at": "2026-10-02T13:05:00Z",
  "signature": "sig_xyz789..."
}
```

**Error Response (400):**
```json
{
  "error": "photo_too_large",
  "message": "Photo exceeds 10MB limit",
  "max_size_mb": 10
}
```

**Error Response (409):**
```json
{
  "error": "duplicate_checkpoint",
  "message": "Checkpoint already captured in this session",
  "previous_seal_time": "2026-10-02T13:02:00Z"
}
```

### Implementation Notes

- **Photo Validation:**
  - Accept JPEG, PNG, WebP
  - Max 10MB (configurable)
  - Compute SHA256 hash of bytes (not file path)
  - Return hash in response for client verification

- **GPS Validation:**
  - Lat: -90 to 90
  - Lon: -180 to 180
  - Accuracy: 0-5000 meters
  - Store if provided, allow empty

- **Nonce Validation:**
  - Check nonce exists and not expired
  - Check nonce matches pack_id
  - Consume/mark nonce as used (prevents replay)

- **Checkpoint Validation:**
  - Verify checkpoint_name exists in pack definition
  - Check not already captured in this session
  - Return error with timestamp of previous attempt

- **Device Binding (optional):**
  - If provided, validate format (SHA256 hex)
  - Store with capture for future verification
  - Used to tie captures to specific device

### Error Codes

| Code | Meaning |
|------|---------|
| `photo_required` | No photo in multipart data |
| `photo_too_large` | Photo > 10MB |
| `invalid_photo_format` | Not JPEG/PNG/WebP |
| `checkpoint_not_found` | Checkpoint doesn't exist in pack |
| `duplicate_checkpoint` | Already sealed in this session |
| `nonce_required` | Missing nonce parameter |
| `nonce_invalid` | Nonce format invalid |
| `nonce_expired` | Nonce past 30min expiry |
| `nonce_mismatched` | Nonce issued for different pack |

## 3. Offline Verification

**Purpose:** Check all 9 invariants/constraints for captured checkpoints before submission.

**Request:**
```
POST /api/captures/:pack_id/verify
Content-Type: application/json

{
  "nonce": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "captures": [
    {
      "checkpoint_name": "framing",
      "nonce": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "seal_response": {
        "photo_hash": "sha256:abc123...",
        "photo_size_bytes": 245632,
        "signed_at": "2026-10-02T13:05:00Z",
        "signature": "sig_xyz789..."
      }
    }
  ]
}
```

**Success Response (200):**
```json
{
  "valid": true,
  "checks": [
    {
      "name": "All checkpoints have photos",
      "passed": true,
      "detail": "8/8 checkpoints captured"
    },
    {
      "name": "Photo hashes verified",
      "passed": true,
      "detail": "All SHA256 hashes match"
    },
    {
      "name": "Photo sizes valid",
      "passed": true,
      "detail": "All under 10MB limit"
    },
    {
      "name": "GPS coordinates valid",
      "passed": true,
      "detail": "All within valid range"
    },
    {
      "name": "Timestamps in order",
      "passed": true,
      "detail": "Captures in chronological order"
    },
    {
      "name": "Nonce not expired",
      "passed": true,
      "detail": "Expires at 2026-10-02T13:30:00Z"
    },
    {
      "name": "Device binding consistent",
      "passed": true,
      "detail": "All from same device"
    },
    {
      "name": "Notes within length limit",
      "passed": true,
      "detail": "Max 1000 chars, avg 145 chars"
    },
    {
      "name": "No duplicate captures",
      "passed": true,
      "detail": "Each checkpoint captured once"
    }
  ],
  "summary": "All checks passed"
}
```

**Partial Failure Response (200):**
```json
{
  "valid": false,
  "checks": [
    {
      "name": "All checkpoints have photos",
      "passed": false,
      "detail": "Missing: exterior, roof"
    },
    {
      "name": "Timestamps in order",
      "passed": false,
      "detail": "Checkpoint 'roof' before 'foundation'"
    }
  ],
  "summary": "6/9 checks passed"
}
```

### Implementation Notes

- **9 Required Checks:**
  1. All checkpoints have photos (count check)
  2. Photo hashes match sealed values
  3. All photos < 10MB
  4. GPS coords in valid range (if provided)
  5. Timestamps monotonically increasing
  6. Nonce not expired
  7. Device binding consistent (if used)
  8. Notes < 1000 chars
  9. No duplicate checkpoints

- **Error Tolerance:**
  - Return 200 with `valid: false` (don't error)
  - List every failed check with reason
  - Return counts/details to help user fix

- **Offline Capability:**
  - This can run on client (send minimal data)
  - Or on backend (send seal responses)
  - Client has seal hashes, can verify locally

### Check Details

**Check 1: Photos Present**
```
Logic: len(captures) == len(pack.checkpoints)
Error: "Missing: [list checkpoint names]"
```

**Check 2: Hashes Match**
```
Logic: SHA256(photo_bytes) == seal_response.photo_hash
Error: "Hash mismatch in [checkpoint names]"
```

**Check 3: Photo Sizes**
```
Logic: All seal_response.photo_size_bytes < 10 * 1024 * 1024
Error: "Oversized photos: [checkpoint: Xmb]"
```

**Check 4: GPS Validity**
```
Logic: If gps provided: -90 <= lat <= 90, -180 <= lon <= 180
Error: "Invalid GPS: lat=X lon=Y"
```

**Check 5: Timestamps**
```
Logic: For i in [0, n): created_at[i] < created_at[i+1]
Error: "Non-sequential: checkpoint X before Y"
```

**Check 6: Nonce Expiry**
```
Logic: now() < nonce.expires_at
Error: "Nonce expired at X, now Y"
```

**Check 7: Device Binding**
```
Logic: All captures have same device_bind_hash
Error: "Device mismatch: [device hashes]"
```

**Check 8: Note Length**
```
Logic: All note lengths < 1000
Error: "Notes too long: [checkpoint: X chars]"
```

**Check 9: No Duplicates**
```
Logic: Each checkpoint appears <= 1 time
Error: "Duplicate captures: [checkpoint names]"
```

## 4. Manifest Submission

**Purpose:** Finalize and store manifest after verification passes.

**Request:**
```
POST /api/manifests/:pack_id/submit
Content-Type: application/json

{
  "nonce": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "captures": [
    {
      "checkpoint_name": "framing",
      "seal_response": {
        "photo_hash": "sha256:abc123...",
        "signed_at": "2026-10-02T13:05:00Z",
        "signature": "sig_xyz789..."
      }
    }
  ]
}
```

**Success Response (201):**
```json
{
  "manifest_id": "manifest_abc123def456",
  "pack_id": "remodel",
  "status": "pending_review",
  "checkpoint_count": 8,
  "created_at": "2026-10-02T13:15:00Z",
  "expires_at": "2026-10-09T13:15:00Z",
  "pdf_ready": false,
  "pdf_ready_at": "2026-10-02T13:30:00Z"
}
```

**Error Response (400):**
```json
{
  "error": "incomplete_capture",
  "message": "Only 7/8 checkpoints captured",
  "missing_checkpoints": ["roof"]
}
```

### Implementation Notes

- **Manifest ID:** Generate UUID or hash(pack_id + timestamp + nonce)
- **Status:** 
  - `pending_review` - Submitted, awaiting human/automated review
  - `approved` - All checks passed
  - `rejected` - Issues found
  - `archived` - Old manifest (> 7 days)

- **Expiry:** 7 days default (auto-cleanup after)
- **Re-submission:** Don't allow duplicate pack+nonce combos
- **PDF Generation:** Async job, not immediate (check pdf_ready flag)

### Error Codes

| Code | Meaning |
|------|---------|
| `incomplete_capture` | Missing checkpoints |
| `invalid_seal_signature` | Seal signature doesn't verify |
| `nonce_already_used` | Manifest already submitted |
| `duplicate_checkpoint` | Duplicate in captures array |
| `pack_changed` | Pack definition changed since challenge |

## 5. PDF Export

**Purpose:** Generate or retrieve manifest PDF.

**Request:**
```
GET /api/manifests/:manifest_id/pdf
```

**Success Response (200):**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="manifest_abc123.pdf"

[Binary PDF blob]
```

**Error Response (404):**
```json
{
  "error": "not_found",
  "message": "Manifest not found"
}
```

**Error Response (202):**
```json
{
  "error": "not_ready",
  "message": "PDF still generating",
  "retry_after_seconds": 5
}
```

### Implementation Notes

- **Async Generation:**
  - First request: Start async job, return 202
  - Subsequent requests: Check job status
  - When ready: Return 200 with PDF
  - Implement exponential backoff on client (5s, 10s, 20s)

- **PDF Content:**
  - Title page (pack name, submission date)
  - Overview (8/8 checkpoints, verification status)
  - Per-checkpoint section:
    - Photo (full page)
    - Metadata (timestamp, GPS, note)
    - Seal signature verification
  - Summary (all checks passed/failed)

- **Caching:**
  - PDF generated once and cached
  - Same URL always returns same PDF
  - Cache for 7 days

- **Filename:** `manifest_{manifest_id}_{created_date}.pdf`

### Error Codes

| Code | Meaning |
|------|---------|
| `not_found` | Manifest ID doesn't exist |
| `not_ready` | PDF still generating (202) |
| `generation_failed` | PDF job failed permanently |
| `access_denied` | User not authorized |

## Request/Response Patterns

### Authentication (Optional)

If auth required, add header:
```
Authorization: Bearer <user_token>
X-User-ID: user_abc123
```

### CORS Headers

Backend must allow:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

### Error Format (Standard)

All errors follow this schema:
```json
{
  "error": "error_code",
  "message": "Human-readable message",
  "details": {
    "field": "error description"
  },
  "request_id": "req_abc123",
  "timestamp": "2026-10-02T13:00:00Z"
}
```

### Multipart Form Data (Seal)

Example request:
```
POST /api/captures/remodel/seal HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="photo"; filename="photo.jpg"
Content-Type: image/jpeg

[binary JPEG data]
------WebKitFormBoundary
Content-Disposition: form-data; name="checkpoint_name"

framing
------WebKitFormBoundary
Content-Disposition: form-data; name="note"

Wall studs installed
------WebKitFormBoundary
Content-Disposition: form-data; name="nonce"

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
------WebKitFormBoundary
Content-Disposition: form-data; name="gps_lat"

40.7128
------WebKitFormBoundary--
```

## Example Implementation (Python/Flask)

```python
from flask import request, jsonify
from datetime import datetime, timedelta
import jwt
import hashlib
import json

SECRET_KEY = 'your-secret-key'
CHALLENGE_EXPIRY = 30  # minutes

# Pack definitions (from config)
PACKS = {
    'remodel': {
        'name': 'Remodel Package',
        'checkpoints': ['before_exterior', 'before_interior', ...]
    }
}

@app.route('/api/challenges/issue', methods=['POST'])
def issue_challenge():
    data = request.json
    pack_id = data.get('pack_id')
    
    if pack_id not in PACKS:
        return {'error': 'invalid_pack_id'}, 400
    
    now = datetime.utcnow()
    expires = now + timedelta(minutes=CHALLENGE_EXPIRY)
    
    payload = {
        'pack_id': pack_id,
        'issued_at': now.isoformat(),
        'expires_at': expires.isoformat()
    }
    
    nonce = jwt.encode(payload, SECRET_KEY, algorithm='HS256')
    
    return {
        'nonce': nonce,
        'issued_at': now.isoformat(),
        'expires_at': expires.isoformat()
    }, 200

@app.route('/api/captures/<pack_id>/seal', methods=['POST'])
def seal_checkpoint(pack_id):
    # Validate nonce
    nonce = request.form.get('nonce')
    try:
        payload = jwt.decode(nonce, SECRET_KEY, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return {'error': 'nonce_expired'}, 400
    
    # Get photo
    photo = request.files.get('photo')
    if not photo:
        return {'error': 'photo_required'}, 400
    
    # Validate size
    photo_bytes = photo.read()
    if len(photo_bytes) > 10 * 1024 * 1024:
        return {'error': 'photo_too_large'}, 400
    
    # Compute hash
    photo_hash = hashlib.sha256(photo_bytes).hexdigest()
    
    # Store capture
    checkpoint_name = request.form.get('checkpoint_name')
    note = request.form.get('note', '')
    
    capture = {
        'pack_id': pack_id,
        'checkpoint_name': checkpoint_name,
        'photo_hash': f'sha256:{photo_hash}',
        'photo_size_bytes': len(photo_bytes),
        'note': note,
        'nonce': nonce,
        'created_at': datetime.utcnow().isoformat()
    }
    
    # Save to database
    db.captures.insert_one(capture)
    
    return {
        'ok': True,
        'checkpoint_name': checkpoint_name,
        'photo_hash': f'sha256:{photo_hash}',
        'photo_size_bytes': len(photo_bytes),
        'signed_at': datetime.utcnow().isoformat(),
        'signature': 'sig_...'
    }, 200
```

## Testing with cURL

```bash
# 1. Get challenge
curl -X POST http://localhost:5000/api/challenges/issue \
  -H 'Content-Type: application/json' \
  -d '{"pack_id": "remodel"}'

# 2. Seal checkpoint
curl -X POST http://localhost:5000/api/captures/remodel/seal \
  -F 'photo=@photo.jpg' \
  -F 'checkpoint_name=framing' \
  -F 'note=Wall studs installed' \
  -F 'nonce=eyJhbGc...'

# 3. Verify
curl -X POST http://localhost:5000/api/captures/remodel/verify \
  -H 'Content-Type: application/json' \
  -d '{...}'

# 4. Submit
curl -X POST http://localhost:5000/api/manifests/remodel/submit \
  -H 'Content-Type: application/json' \
  -d '{...}'

# 5. Get PDF
curl -X GET http://localhost:5000/api/manifests/manifest_abc123/pdf \
  -o manifest.pdf
```

## Deployment Checklist

- [ ] All 5 endpoints implemented
- [ ] Error codes standardized
- [ ] CORS headers configured
- [ ] Rate limiting enabled (optional)
- [ ] Nonce validation working
- [ ] Photo hash validation working
- [ ] Database schema created
- [ ] Indexes on (pack_id, checkpoint_name)
- [ ] Indexes on (manifest_id)
- [ ] PDF generation async job
- [ ] Logging for all endpoints
- [ ] Monitoring/alerting setup
- [ ] Backup strategy for manifests
- [ ] Data retention policy (7+ days)

## Security Considerations

1. **File Upload:** Validate MIME type, not just extension
2. **SQL Injection:** Use parameterized queries
3. **Rate Limiting:** Per-IP or per-user (60 challenges/hour)
4. **Nonce Replay:** Mark nonce as consumed after first seal
5. **Photo Storage:** Encrypt at rest, hash before storage
6. **CORS:** Whitelist specific origins in production
7. **PDF Generation:** Sanitize manifest ID to prevent path traversal
8. **Data Retention:** Auto-delete after 7 days (GDPR)

## Monitoring

Log these events:
- Challenge issued (user_id, pack_id, expires_at)
- Checkpoint sealed (user_id, pack_id, checkpoint, photo_size, seal_time_ms)
- Verification run (user_id, pack_id, checks_passed/failed)
- Manifest submitted (user_id, pack_id, manifest_id, checkpoint_count)
- PDF generated (user_id, manifest_id, generation_time_ms)

Alert on:
- > 1000 ms seal time (photo too large or storage slow)
- > 10% verification failure rate (check implementation)
- PDF generation timeout (> 60 seconds)
- > 100 errors/hour on any endpoint
