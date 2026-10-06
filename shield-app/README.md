# Shield (mobile) — standalone forensic photo sealing

Capacitor 6 + Vite + TypeScript. No framework. Runs as a web page for development
and wraps to iOS/Android with `npx cap add ios|android`.

**Everything below works with no network.** The only outbound call in the app is
the optional "Send to admin" button on the Close view, and it is a no-op unless a
signed-in Supabase client exists on `window.sb`.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: engine, close-out packet, capture chain
npm run build      # tsc --noEmit + vite build → dist/
npm run cap:init   # once: adds ios/ and android/ (gitignored)
npm run cap:sync   # copy dist/ into the native shells
```

## Native builds

`android/` and `ios/` are committed (Capacitor convention). After any web change:

```bash
npm run build && npx cap sync      # copies dist/ into both shells, updates plugins
npx cap open android               # Android Studio → run on a device
npx cap open ios                   # Xcode (macOS only; runs `pod install` on first sync)
```

Permissions are declared: camera + location on Android (`AndroidManifest.xml`),
`NSCameraUsageDescription` / `NSLocationWhenInUseUsageDescription` on iOS
(`Info.plist`). The camera plugin is invoked with `CameraSource.Camera` only —
the gallery is never an origin path.

**Not wired yet:** `src/native/ios-attest.swift` and `android-integrity.kt`
describe the App Attest / Play Integrity binding (`ShieldAttest.assert(hash)`).
Until a Capacitor plugin exposes that bridge on `window.ShieldAttest`, native
seals report `attest: none` and the Verify verdict is `SEALED` with
`native-camera-no-attest`.

## Tabs

| Tab | What it does |
|---|---|
| **Capture** | Rear camera on native (`@capacitor/camera`). On the web: **OPEN CAMERA** (live `getUserMedia` preview + shutter, sealed as `web-camera`; falls back to the phone's camera app via `capture="environment"` when the in-page camera is blocked) or **ARRIVAL HASH** (any existing file). Every photo: SHA-256 of the bytes → hash chain (`prevChain` → `chainHead`) → ECDSA P-256 signature with this device's key (IndexedDB, non-extractable). |
| **Jobs** | Lock a generic pack (remodel / draw / unit / loss / shop / custom) — industry-agnostic checkpoints with an optional GPS pin and a fee tier. |
| **Vault** | Originals stay on device. REHASH recomputes the SHA-256; EXPORT writes a `.shield.json` bundle (record + original). |
| **Verify** | Drop a photo bundle (`.shield.json`) → recomputes the hash of the embedded original: `SEALED` / `TAMPERED` / `ARRIVAL-ONLY` / `NO-ORIGIN`. Drop a close-out record (`.shield-record.json`) → recomputes its hash and checks the device signature with the embedded public key: `PACKET-SEALED` / `PACKET-TAMPERED`, with per-point status. |
| **Build** | Construction pack. Brief → locking questions → 5 trade-specific checkpoints → IRC/IBC code references → hashed, signed close-out record. See below. |

## Build (Construction) tab

`src/construction/` is pure logic, no DOM, fully unit-tested:

- `trades.ts` — 14 trades, keyword detection.
- `questions.ts` — trade-specific "locking questions" shown when the brief scores under 70.
- `score.ts` — brief strength (detail, size, material, location, action verb, trade terms, exclusions).
- `points.ts` — generates exactly 5 checkpoints (`construction-1..5`) from the brief and answers, each with a suggested code.
- `codes.ts` — the 16 IRC/IBC rows from `tradedeck-api/supabase/migrations/20261002000000_shield_checkpoints_scaffolding.sql`, bundled so the Codes view and suggestions work offline.
- `closeout.ts` — `buildCloseoutPacket` freezes brief + points + each point's `SealRecord` (photo hash, chain head, device signature) into one packet: `integrity.hash = SHA-256(stableStringify(body))`, `integrity.signature = ECDSA(device key, same bytes)`, with the device public key embedded. `verifyCloseoutPacket` recomputes both.

A photo sealed against a construction point is the same forensic `SealRecord` as any other capture — the Build tab adds *what* to photograph and *why*; it does not change *how* the photo is proven.

## What the packet proves / does not prove

- Proves: these photo bytes existed on this device at the recorded time, in this order, and neither the photos nor the brief/points/notes changed since the packet was frozen.
- Does not prove: that a web capture came from a physical camera (`web-camera` and `arrival-hash` both verify as `ARRIVAL-ONLY`), GPS truthfulness, or that the scene was not staged. Native App Attest / Play Integrity (`src/native/`) is the path to origin proof and is wired but not yet backed by a plugin.
