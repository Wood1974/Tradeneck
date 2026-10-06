# Shield (mobile) — standalone forensic photo sealing

Capacitor 6 + Vite + TypeScript. No framework. Runs as a web page for development
and wraps to iOS/Android with `npx cap add ios|android`.

**Everything below works with no network.** The app makes no outbound calls; an
end-to-end test runs the brief, seal, close and verify flow with the browser offline
and asserts no requests are made.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: engine, packet/bundle verification, capture chain, DB migration
npm run test:e2e   # Playwright against the production build (see E2E_TESTING.md)
npm run build      # tsc --noEmit + vite build → dist/
npm run cap:init   # only if ios/ and android/ are missing (they are committed)
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
| **Capture** | **Native live camera only** (`@capacitor/camera`, camera as the only source, back by default with a front/back toggle that sets the OS camera's starting lens). There is no web camera, gallery, photo picker or file import anywhere: in a browser the Capture screen cannot capture at all. The only file input is the Verify tab's importer for `.shield-record.json` / `.shield.json` files, which can check a record but cannot create a seal. Every photo: SHA-256 of the bytes → hash chain (`prevChain` → `chainHead`) → ECDSA P-256 signature with this device's key (IndexedDB, non-extractable but software-held). Seals run one at a time and commit atomically. |
| **Jobs** | Lock a generic pack (remodel / draw / unit / loss / shop / custom) — industry-agnostic checkpoints with an optional GPS pin and a fee tier. |
| **Vault** | Originals stay on device. REHASH recomputes the SHA-256; EXPORT writes a `.shield.json` bundle (record + original). |
| **Verify** | Drop a photo bundle (`.shield.json`) → recomputes the hash of the embedded original: `SEALED` / `UNATTESTED-NATIVE` / `TAMPERED` / `NO-ORIGIN`. Drop a close-out record (`.shield-record.json`) → recomputes its hash and checks the device signature with the embedded public key: `PACKET-SEALED` / `PACKET-TAMPERED`, with per-point status. |
| **Build** | Construction pack. Brief → locking questions → 5 trade-specific checkpoints → IRC/IBC code references → hashed, signed close-out record. See below. |

## Build (Construction) tab

`src/construction/` is pure logic, no DOM, fully unit-tested:

- `trades.ts` — 14 trades, keyword detection.
- `questions.ts` — trade-specific "locking questions" shown when the brief scores under 70.
- `score.ts` — brief strength (detail, size, material, location, action verb, trade terms, exclusions).
- `points.ts` — generates exactly 5 checkpoints (`construction-1..5`) from the brief and answers, each with a suggested code.
- `codes.ts` — 16 code-reference rows bundled so the Codes view and suggestions work offline. Section numbers refer to the **2021 IRC**; Utah adopts it with state amendments (Utah Code 15A-2-103), so Utah's text can differ. There are no IBC citations (one- and two-family dwellings fall under the IRC). The section numbers, topics and figures were taken from ICC's published 2021 IRC text, relayed through research notes rather than read first-hand, and **no inspector has reviewed them**; descriptions are summaries, not code text. Utah's own amendments to these specific sections have **not** been checked (Utah is known to amend nearby ones, for example an R403.1.6 anchor-bolt exception). The earlier version of this table had many numbers pointing at sections that cover something else, and the `tradedeck-api` seed migration (`20261002000000_shield_checkpoints_scaffolding.sql`) still carries those older rows. Reference only: confirm with your inspector.
- `closeout.ts` — `buildCloseoutPacket` freezes brief + points + each point's `SealRecord` (photo hash, chain head, device signature) into one packet: `integrity.hash = SHA-256(stableStringify(body))`, `integrity.signature = ECDSA(device key, same bytes)`, with the device public key embedded. `verifyCloseoutPacket` recomputes both and also authenticates each point's record (signature, chain head, seal ID).

A photo sealed against a construction point is the same forensic `SealRecord` as any other capture — the Build tab adds *what* to photograph and *why*; it does not change *how* the photo is proven.

## What the packet proves / does not prove

- Proves (when verification passes): the packet hash, every point's record signature and `chainHead`, and the seal-ID-to-key binding are consistent with the public key in the file, so nothing was edited after signing. Records are checked for duplicate/forked chain links, wrong job or checkpoint, time running backwards, and future timestamps.
- Does **not** prove who holds the signing key. The key travels inside the file, so anyone can produce a self-consistent packet with their own key. Compare the displayed signer seal ID with one you trust (the Verify tab accepts an expected ID and then fails any other signer).
- Does not prove: photo bytes (they are not in the packet; the hashes are), that time is accurate (timestamps come from the device clock), that the photo came from a physical camera sensor rather than something fed to the OS camera layer (no attestation yet), GPS truthfulness (native fixes are not yet checked for mock providers), or that the scene was not staged. Camera output is re-encoded (JPEG quality 92), so it is not the raw sensor file. Only records whose `captureKind` is `native-camera` verify; any other kind is rejected (`unsupported-capture-kind`), so a record claiming a web, gallery or file origin can never pass.
- Key custody: the device key is a non-extractable WebCrypto key stored in IndexedDB. That stops casual export, not a compromised app or WebView; it is not hardware-backed. If site data is cleared a new key is created, and older records still verify only against their own embedded key.
- Native App Attest / Play Integrity (`src/native/`) is the path to origin proof and is wired but not yet backed by a plugin; the token is not stored or validated, so an attested record is reported with `attest-token-not-validated`.
- A photo bundle (`.shield.json`) now embeds the device public key and is authenticated the same way. A bundle without a key is reported `NO-ORIGIN` with `record-unauthenticated`.

## What is recorded when a photo is sealed

All of this is in the signed record (`SealRecord`), taken in this order after the OS camera hands the photo back:

- `sha256`, `bytes`, `mime` of the photo; the photo itself is stored separately on the device.
- `createdAt`: the device clock, read when sealing starts (after you confirm the photo, not at the shutter press).
- `gps` (lat, lng, accuracy, source `os`) read right after, waiting up to ~4.5 s and allowed to be a fix up to 5 s old; `null` if location is off or times out. `pinScore` (distance to the job pin; `inside` only if accuracy fits the radius).
- `jobId`, `checkpointId`, `platform` (ios/android), `captureKind` (`native-camera`), `deviceSealId`, `attest` (currently always `none`), `prevChain` / `chainHead`, and the ECDSA `signature`.

Not recorded: the shutter-press instant, EXIF, device model or OS/app version, compass heading, tilt or motion, altitude, which lens was actually used (the OS camera app can switch), flash, mock-location status, or network info.
