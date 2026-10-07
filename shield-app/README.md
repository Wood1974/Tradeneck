# Shield (mobile) — standalone forensic photo sealing

Capacitor 8 + Vite + TypeScript. No framework. Runs as a web page for development
and wraps to iOS/Android. iOS deployment target is 15. Android minSdk is 24,
compile/target SDK 36, JDK 21.

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

The iOS bundle id is `app.tradedeck.shield`, the same id as Android and the
App Store Connect app Tradedeck-shield (Apple ID 6819876039, team 766456AWH4).
Signed store uploads are manual and do not run on push:

- TestFlight: `.github/workflows/shield-app-testflight.yml` (Actions → Shield iOS TestFlight).
- Play internal track: `.github/workflows/shield-app-play-internal.yml` (Actions → Shield Android Play Internal). Package `app.tradedeck.shield`. The first AAB for a new Play app has to be uploaded by hand in Play Console before this workflow can upload.

Permissions are camera + location only. There is no photo-library permission and
no gallery import. Evidence photos go through `@tradedeck/secure-capture`
(`plugins/secure-capture`): an in-app camera, SHA-256 of the JPEG the camera
returned, and a hardware signature (iOS Secure Enclave P-256, Android Keystore
with StrongBox when the device has it and TEE otherwise). Originals and signed
records stay in app-private storage and can be listed, exported, and checked
offline. Sync to the server is not in this build.

The Vault still keeps the existing WebCrypto chain so a browser test can seal
and verify without a device. That key is software. The hardware record is the
evidence queue. App Attest assertions and Play Integrity tokens are TODO hooks
on the plugin and are not requested during an offline seal. `attest` on the
Vault record stays `none` until those calls exist.

## Tabs

| Tab | What it does |
|---|---|
| **Capture** | **In-app camera only** (`@tradedeck/secure-capture` on device; no gallery, photo picker, or file import). A browser cannot capture. The only file input is the Verify tab's importer. A floating camera button on every tab takes a photo in one tap. On device the plugin hashes the JPEG, chains it (`record_hash = SHA-256(canonical JSON \|\| "\|" \|\| prev_hash)`), and signs with the hardware key, then the app also stores a Vault copy with the existing software key. Seals run one at a time. |
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
- `codes.ts` — 16 code-reference rows bundled so the Codes view and suggestions work offline. Section numbers refer to the **2021 IRC**; Utah adopts it with state amendments (Utah Code 15A-2-103), so Utah's text can differ. There are no IBC citations (one- and two-family dwellings fall under the IRC). The section numbers, topics and figures were taken from ICC's published 2021 IRC text, relayed through research notes rather than read first-hand, and **no inspector has reviewed them**; descriptions are summaries, not code text. Utah's amendments (Utah Code 15A-3-202 to -206 and -601, pages dated 7/1/2026 or 7/1/2025) were searched by section number: only R403.1.6 (an exception is added, also to R403.1.6.1) and R403.1.3.5.3 (an exception for placing vertical footing steel while the concrete is plastic) are amended; the other cited sections are not mentioned by number, and the two exceptions are reflected in those rows. **Not checked:** IPC/IMC/NEC amendments that Utah applies to "corresponding" IRC sections (15A-3-201(2)), including whether E3905.3.1 and E3906.8 correspond to amended NEC sections; most IPC amendment text; and the 1/1/2027 version of 15A-2-103. The earlier version of this table had many numbers pointing at sections that cover something else, and the `tradedeck-api` seed migration (`20261002000000_shield_checkpoints_scaffolding.sql`) still carries those older rows. Reference only: confirm with your inspector.
- `closeout.ts` — `buildCloseoutPacket` freezes brief + points + each point's `SealRecord` (photo hash, chain head, device signature) into one packet: `integrity.hash = SHA-256(stableStringify(body))`, `integrity.signature = ECDSA(device key, same bytes)`, with the device public key embedded. `verifyCloseoutPacket` recomputes both and also authenticates each point's record (signature, chain head, seal ID).

A photo sealed against a construction point is the same forensic `SealRecord` as any other capture — the Build tab adds *what* to photograph and *why*; it does not change *how* the photo is proven.

## What the packet proves / does not prove

- Proves (when verification passes): the packet hash, every point's record signature and `chainHead`, and the seal-ID-to-key binding are consistent with the public key in the file, so nothing was edited after signing. Records are checked for duplicate/forked chain links, wrong job or checkpoint, time running backwards, and future timestamps.
- Does **not** prove who holds the signing key. The key travels inside the file, so anyone can produce a self-consistent packet with their own key. Compare the displayed signer seal ID with one you trust (the Verify tab accepts an expected ID and then fails any other signer).
- Does not prove: photo bytes (they are not in the close-out packet; the hashes are), that time is accurate (the capture record carries wall, monotonic, and boot identity so the server can label CONSISTENT / UNVERIFIED TIME / DEVICE CLOCK MISMATCH), that the photo came from a physical camera sensor rather than something fed to the OS camera (App Attest and Play Integrity are not called yet), or that the scene was not staged. Android records `isMock` / `isFromMockProvider`. iOS records `isSimulatedBySoftware` / `isProducedByAccessory`. iOS `CLLocation.timestamp` is the OS fix time, not a raw satellite clock. The hashed JPEG is the in-app camera's file bytes (CameraX quality 95 on Android; AVFoundation `fileDataRepresentation` on iOS), not a second encode in JavaScript. Only records whose `captureKind` is `native-camera` verify; any other kind is rejected (`unsupported-capture-kind`).
- Key custody: the Vault copy is a non-extractable WebCrypto key in IndexedDB. The evidence copy is a hardware key that does not leave the Secure Enclave or Android Keystore. A simulator or a device without a Secure Enclave records `key_security_level: software` and still seals locally; a server should refuse that level. If the outbox already has records, the key cannot be reset.
- App Attest and Play Integrity are not implemented. The plugin returns `app_attest_assertion_b64: null` and `play_integrity_token: null`. Do not treat a sealed photo as device-attested.
- A photo bundle (`.shield.json`) now embeds the device public key and is authenticated the same way. A bundle without a key is reported `NO-ORIGIN` with `record-unauthenticated`.

## What is recorded when a photo is sealed

All of this is in the signed record (`SealRecord`), taken in this order after the OS camera hands the photo back:

- `sha256`, `bytes`, `mime` of the photo; the photo itself is stored separately on the device.
- `createdAt`: the device clock, read when sealing starts (after you confirm the photo, not at the shutter press).
- `gps` (lat, lng, accuracy, source `os`) read right after, waiting up to ~4.5 s and allowed to be a fix up to 5 s old; `null` if location is off or times out. `pinScore` (distance to the job pin; `inside` only if accuracy fits the radius).
- `jobId`, `checkpointId`, `platform` (ios/android), `captureKind` (`native-camera`), `deviceSealId`, `attest` (currently always `none`), `prevChain` / `chainHead`, and the ECDSA `signature`.

The Vault `SealRecord` is the software copy above. The hardware capture record (see `plugins/secure-capture/README.md`) additionally stores the photo hash, previous record hash, ticket id, wall time, monotonic time, boot id or boot count, a GNSS time when a fix exists, a simulated-location flag, a sensor-snapshot hash (GPS integers, app version, key security level), and a DER signature. A local chain with no server ticket is labeled `ticket_origin: local` and is not a server ticket hash. `adoptServerTicket` is refused once any photo is in that chain.
