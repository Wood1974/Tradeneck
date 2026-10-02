# Shield Backend Integration Reference

This document describes all backend API endpoints that the Shield standalone app uses.

## Base URL

All endpoints relative to: `https://tradedeck-api.onrender.com`

## Authentication

All endpoints except `/health` require Supabase JWT:

```javascript
const token = sb.auth.session()?.access_token;
const response = await fetch('/api/shields/...', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

## Endpoints

### 1. Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-10-02T12:00:00Z"
}
```

**Purpose:** Verify backend is online (no auth required)

---

### 2. Issue Challenge Nonce

```http
POST /api/shields/{job_id}/issue-nonce
Authorization: Bearer <token>
```

**Description:**
- Generates a 32-byte random hex nonce with 120-second TTL
- Required before sealing photos
- Nonce is single-use (consumed on seal)

**Response:**
```json
{
  "nonce": "a1b2c3d4e5f6...",
  "ttl_seconds": 120,
  "expires_at": "2026-10-02T12:02:00Z"
}
```

**Errors:**
- `401` — Unauthorized (invalid/missing token)
- `403` — Forbidden (not job owner)
- `404` — Job not found

---

### 3. Seal Photo

```http
POST /api/shields/{job_id}/seal-photo
Authorization: Bearer <token>
Content-Type: multipart/form-data

photo: <binary JPEG/PNG>
note: "Framing complete"
checkpoint: "Foundation Sill Plate & Anchor Bolts"
nonce: "a1b2c3d4e5f6..."
gps_lat: 40.7580
gps_lon: -111.8761
device_bind_hash: "sha256hash..." (optional)
```

**Description:**
- Cryptographically seals a photo with metadata
- Creates SHA256 hash: `bind_hash = sha256(photo_bytes + note + checkpoint + nonce + account_id + gps + timestamp + device_bind_hash)`
- Enforces nonce single-use
- Stores result in `shield_photos` table

**Response:**
```json
{
  "photo_id": "uuid",
  "bind_hash": "64-char-hex-string",
  "bind_ok": true,
  "timestamp": "2026-10-02T12:00:00Z",
  "location_verdict": "consistent"
}
```

**bind_ok values:**
- `true` — Device hash matches stored hash
- `false` — Device changed (mismatch)
- `null` — No device binding required

**Response Status:**
- `201` — Photo sealed successfully
- `400` — Malformed request (missing fields)
- `401` — Unauthorized
- `403` — Forbidden (nonce expired or already used)
- `404` — Job not found
- `413` — File too large (>5MB)

---

### 4. Get Job Photos

```http
GET /api/shields/{job_id}/photos
Authorization: Bearer <token>
```

**Query Parameters:**
- `limit` — Max results (default 20)
- `offset` — Pagination offset (default 0)

**Response:**
```json
[
  {
    "id": "uuid",
    "job_id": "uuid",
    "file_path": "users/uuid/1696234800_photo.jpg",
    "note": "Framing complete",
    "checkpoint": "Foundation Sill Plate & Anchor Bolts",
    "bind_hash": "64-char-hex",
    "bind_ok": true,
    "location_verdict": "consistent",
    "created_at": "2026-10-02T12:00:00Z"
  }
]
```

---

### 5. List Shield Jobs

```http
GET /api/shields
Authorization: Bearer <token>
```

**Query Parameters:**
- `limit` — Max results (default 20)
- `offset` — Pagination (default 0)
- `status` — Filter by status: `active`, `verified`, `closed`

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Kitchen Renovation",
    "trade": "framing",
    "description": "...",
    "status": "active",
    "owner_id": "user_uuid",
    "created_at": "2026-10-02T12:00:00Z",
    "photo_count": 5,
    "verified_count": 3
  }
]
```

---

### 6. Create Shield Job

```http
POST /api/shields
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Roof Installation",
  "trade": "roofing",
  "description": "New architectural shingles, full replacement",
  "location": {
    "address": "123 Main St, Salt Lake City, UT",
    "lat": 40.7580,
    "lon": -111.8761
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "Roof Installation",
  "trade": "roofing",
  "status": "active",
  "created_at": "2026-10-02T12:00:00Z"
}
```

**Status:**
- `201` — Job created
- `400` — Invalid trade (must be: framing, roofing, electrical, plumbing, hvac, concrete)

---

### 7. Verify Batch Photos

```http
POST /api/shields/{job_id}/verify-batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "photo_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Description:**
- Runs 9 offline verification invariants on each photo
- Checks: structure, pack correspondence, nonce single-use, location consistency, device consistency, sequence integrity, timestamp monotonicity, tampering detection, bind_hash validity

**Response:**
```json
{
  "verified_count": 3,
  "passed": ["uuid1", "uuid2"],
  "failed": [
    {
      "photo_id": "uuid3",
      "reason": "Location speed exceeded threshold (250 mph)",
      "failed_checks": ["assert_location_consistent"]
    }
  ]
}
```

---

### 8. Export PDF

```http
GET /api/shields/{job_id}/export-pdf?format=a4
Authorization: Bearer <token>
```

**Query Parameters:**
- `format` — Paper size: `a4`, `letter` (default `a4`)

**Response:**
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="Shield_JobName_20261002.pdf"`
- Binary PDF data

**PDF Layout:**
- **Header:** Job name, timestamp, owner, trade
- **Grid:** 2-column photo layout, 4" width each
- **Per photo:** Photo, checkpoint label, notes (italic), bind_hash (8 chars)
- **Footer:** Manifest SHA256, chain head hash

---

### 9. Admin: List All Jobs

```http
GET /api/admin/shields
Authorization: Bearer <token>
```

**Requires:** User must have `is_admin = true` in profiles table

**Query Parameters:**
- `limit` — Max results (default 20)
- `offset` — Pagination
- `status` — Filter: `active`, `verified`, `closed`
- `trade` — Filter by trade category
- `owner_id` — Filter by owner (admin only)

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "...",
    "trade": "...",
    "owner": { "id": "...", "email": "..." },
    "status": "active",
    "photo_count": 5,
    "verified_count": 3,
    "created_at": "...",
    "last_updated": "..."
  }
]
```

---

### 10. Admin: Verify Job

```http
POST /api/admin/shields/{job_id}/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "verdict": "approved",
  "notes": "All checkpoints verified by inspector"
}
```

**Requires:** User must have `is_admin = true`

**verdict values:**
- `approved` — All evidence verified
- `rejected` — Missing or invalid evidence
- `needs_revision` — Resubmit evidence with corrections

**Response:**
```json
{
  "job_id": "uuid",
  "status": "verified",
  "verified_at": "2026-10-02T12:00:00Z",
  "verdict": "approved"
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Short error message",
  "detail": "Detailed explanation if available",
  "code": "error_code"
}
```

### Common Errors

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `invalid_request` | Malformed request (missing fields, wrong types) |
| 401 | `unauthorized` | Missing/invalid auth token |
| 403 | `forbidden` | User lacks permission (not job owner, not admin) |
| 404 | `not_found` | Resource not found |
| 409 | `conflict` | Nonce already used or expired |
| 413 | `payload_too_large` | File exceeds 5MB limit |
| 500 | `internal_error` | Backend error (check logs) |

---

## Example Flow

### 1. User creates job
```javascript
const job = await fetch('/api/shields', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Roof', trade: 'roofing' })
}).then(r => r.json());
```

### 2. Request nonce before photo
```javascript
const challenge = await fetch(`/api/shields/${job.id}/issue-nonce`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());
```

### 3. Seal photo with nonce
```javascript
const formData = new FormData();
formData.append('photo', photoBlob);
formData.append('note', 'Ridge cap complete');
formData.append('nonce', challenge.nonce);
formData.append('gps_lat', 40.7580);
formData.append('gps_lon', -111.8761);

const sealed = await fetch(`/api/shields/${job.id}/seal-photo`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
}).then(r => r.json());
```

### 4. Verify and export
```javascript
// Verify all photos
await fetch(`/api/shields/${job.id}/verify-batch`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ photo_ids: [sealed.photo_id] })
});

// Export PDF
const pdfBlob = await fetch(`/api/shields/${job.id}/export-pdf`).then(r => r.blob());
```

---

## Rate Limiting

Shield API currently has no rate limits, but consider adding:
- 100 requests/minute per user
- 1000 requests/minute per IP

---

## Version

Current API version: `v1` (no prefix)

Future versions will use: `/api/v2/shields/...`
