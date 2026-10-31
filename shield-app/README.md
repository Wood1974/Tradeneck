# Shield (mobile) — standalone forensic photo sealing

Capacitor 8 + Vite + TypeScript. No framework. Runs as a web page for development
and wraps to iOS/Android. iOS deployment target is 15. Android minSdk is 24,
compile/target SDK 36, JDK 21.

**Sign-on needs a network once; everything after it works offline.** Before the app will take a photo,
the person signs in with an account the Shield administrator made, passes an ID check (photo ID plus a live selfie match,
run by Stripe Identity through the standalone Shield server, `Wood1974/tradedeck-shield`) and signs a short statement with the device key (see *Sign-on* below). After that, capture, sealing,
closing and verifying work with no signal and need no call to a server. When the phone is signed in and has signal it also uploads
each sealed photo to the Shield server (see *Stored photos* below); with no signal nothing is sent and the photos wait on the phone. An
end-to-end test runs the offline flow and asserts no requests.

## Working offline

Sign-on is the only step that needs a connection (`src/identity/client.ts` holds the app's only network call, and the build loads
nothing from outside). Do it once, with signal, before heading to a job; the sign-on screen says so and warns when the phone is
offline. After that the Capture screen says "No signal" only when there is none (the system's flag, or the last failed upload attempt) and then lists what still works: photos, sealing, GPS, briefs and checkpoints, closing a job,
exporting and verifying records all work with no signal. You need a connection again only if the app's data is cleared or the app is
reinstalled (a new device key means a new sign-on), or to use the optional online lookup of an attestation. Not yet tested on a
real phone with the network off; the e2e tests switch the network off in a browser.

## Sign-on: ID check and signed note

1. **Sign in** with a Shield account (these are the Shield server's own accounts, not TradeDeck's). To join, use **Create account**:
   an invite code from the person who runs Shield (each works once), an email and a password of at least 12 characters, typed twice
   (`POST /shield/auth/signup`; the server side is open as `tradedeck-shield` PR #7 and is not live until that is merged). Sign-up
   returns to Sign in; the session token is kept in memory only. A forgotten password is reset in the app with **Forgot password?**.
2. **Consent**, then **ID check**: `POST /identity/start` makes a Stripe Identity session (document + live selfie
   match); the check opens in the browser. Stripe, not Shield, receives and keeps the ID and selfie images.
3. **Sign the statement** (`src/identity/note.ts`) with the device key. `POST /identity/note` accepts it only after the
   server itself asks Stripe and sees `verified`, and only if the signature, statement text, seal ID and clock check out.
   The server then returns a **signed receipt** (ECDSA P-256, `src/identity/receipt.ts`) saying the ID check passed for
   exactly this note. The phone checks it before saving and will not seal photos without it.
4. The phone keeps the attestation ID, note hash and signed note: no ID image, selfie or name. Until it exists,
   `captureNative` returns `not-verified` and nothing is sealed. Verifying other people's records needs no sign-on.
5. Each new record signs in `attestationId` and `noteSha256`; the close-out packet embeds the note (`photographer`).
   Verification checks the note signature, key, hash, that it predates the photos, that a packet with note-bound
   photos cannot have the note stripped, and the receipt. Packets and records made before this existed still verify.

What a packet verdict says about the ID check, from the file alone:
- `id-check-confirmed-by-service:<kid>`: the receipt is signed by a service key **pinned in this build**
  (`src/identity/trust.ts`), is for this exact note, and predates the photos. This relies on trusting TradeDeck's key and
  Stripe's check; it is not proof from nothing.
- `id-receipt-signer-unknown`: the receipt is well-formed and for this note, but no pinned key could check it (this is
  what a receipt signed by any key other than the pinned one says). Not confirmed.
- `id-check-test-mode[:<kid>]`: the service signed the receipt, but the check ran in Stripe test mode, which the owner can use when
  they have no real ID to test with. No real ID was checked. It is signed into the receipt, so it cannot be removed, and it is never
  reported as confirmed. The capture screen shows "TEST ID CHECK" instead of "SIGNED NOTE ON FILE".
- `id-check-not-independently-verified`: no receipt in the file. Confirm with `GET /identity/attestations/<id>`, which
  returns only whether it is verified, the note hash, device seal and time.

A signed note does not show the scene in a photo is true. The signing key is not hardware-backed. The statement text is
pinned in both repos by a SHA-256 test, and the receipt format by a shared test vector; change either only with a new version.

Shield is standalone: it does not use TradeDeck's accounts, database or server. Accounts live on the Shield server
(`tradedeck-shield` on Render), are created by its administrator, and there is no self sign-up. The first administrator is
made from `SHIELD_BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` (remove them afterwards); later accounts come from
`POST /shield/admin/accounts`, and a forgotten password is reset in the app with **Forgot password?**, which emails a one-time code (`POST /shield/auth/forgot`, then `/shield/auth/reset`; the server sends it through Resend). An administrator can still reset one with `POST /shield/admin/accounts/<id>/reset-password`.
The owner's test mode is `IDENTITY_TEST_MODE_EMAILS` plus `STRIPE_TEST_SECRET_KEY` on that server. (`Tradedeck-api` still carries an older copy of the
ID-check code with a different setting, `IDENTITY_TEST_MODE_USER_IDS`; the app does not use it.)

Needs before it works end to end: Stripe Identity enabled on the Stripe account (a live `STRIPE_SECRET_KEY` on the server for
real checks); a receipt key made once with `python scripts/gen_receipt_key.py`, its private half set as `IDENTITY_RECEIPT_KEY` on
the Shield server (it refuses to accept notes without it) and its public half pinned in `src/identity/trust.ts` (done, key id
`321c9150a35b8a0e`; the earlier TradeDeck-server key `466ac7e85fc78a0f` stays pinned so old records still verify); and a device test: the check opens through `window.open`, which should hand off to the system
browser in the Capacitor shells but has not been tried on a device. Face matching needs a consent and retention
policy that suits your states (some, such as Illinois, regulate biometric data).

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
Signed store uploads do not run on push. `workflow_dispatch` works after these files are on the default branch. Until then, label this pull request `testflight` or `play-internal` (the job runs only for that label; the build number is the GitHub run number).

- TestFlight: `.github/workflows/shield-app-testflight.yml`.
- Play internal track: `.github/workflows/shield-app-play-internal.yml`. Package `app.tradedeck.shield`, versionName 1.0, versionCode from the GitHub run number. Without `PLAY_SERVICE_ACCOUNT_JSON` the job still builds the signed AAB and uploads the `shield-android-aab` artifact. The first AAB for a new Play app has to be uploaded by hand in Play Console before this workflow can upload.

Permissions are camera + location only. There is no photo-library permission and
no gallery import. Evidence photos go through `@tradedeck/secure-capture`
(`plugins/secure-capture`): an in-app camera, SHA-256 of the JPEG the camera
returned, and a hardware signature (iOS Secure Enclave P-256, Android Keystore
with StrongBox when the device has it and TEE otherwise). Originals and signed
records stay in app-private storage and can be listed, exported, and checked
offline. Uploading is separate: with a signed-in account and signal, the app sends each sealed photo to the Shield server
(`src/native/uploader.ts`, oldest first), where only the account that took it can read it.

The Vault still keeps the existing WebCrypto chain so a browser test can seal
and verify without a device. That key is software. The hardware record is the
evidence queue. App Attest assertions and Play Integrity tokens are TODO hooks
on the plugin and are not requested during an offline seal. `attest` on the
Vault record stays `none` until those calls exist.

## Tabs

| Tab | What it does |
|---|---|
| **Capture** | **In-app camera only** (`@tradedeck/secure-capture` on device; no gallery, photo picker, or file import). A browser cannot capture. The only file input is the Verify tab's importer. A floating camera button on every tab takes a photo in one tap. On device the plugin hashes the JPEG, chains it (`record_hash = SHA-256(canonical JSON \|\| "\|" \|\| prev_hash)`), and signs with the hardware key, then the app also stores a Vault copy with the existing software key. Seals run one at a time. |
| **Jobs** | Lock a generic pack (remodel / draw / unit / loss / shop / custom) — industry-agnostic checkpoints. There is no fee tier and no typed job location; the only GPS in a record is the phone's own fix. |
| **Vault** | Photos stay on the device and, when signed in with signal, are also copied to the Shield server, where only the account that took them can see them. REHASH recomputes the SHA-256; EXPORT writes a `.shield.json` capture-export package: the phone's hardware-signed records for the photo's whole job chain (so the hash chain checks), with this photo's bytes added. A photo with no hardware record on the phone is refused; it is never replaced by the Vault's software-key copy. See `docs/hardware-export.md`. |
| **Verify** | Drop a photo bundle (`.shield.json`) → recomputes the hash of the embedded original: `SEALED` / `UNATTESTED-NATIVE` / `TAMPERED` / `NO-ORIGIN`. (On screen `UNATTESTED-NATIVE` reads "NATIVE CAMERA · photo matches its signed hash" plus what the Apple check is; the stored verdict name is unchanged.) Drop a close-out record (`.shield-record.json`) → recomputes its hash and checks the device signature with the embedded public key: `PACKET-SEALED` / `PACKET-TAMPERED`, with per-point status. |
| **Build** | Construction pack. Brief → locking questions → 5 trade-specific checkpoints → IRC/IBC code references → hashed, signed close-out record. See below. |

## Build (Construction) tab

`src/construction/` is pure logic, no DOM, fully unit-tested:

- `trades.ts` — 14 trades, keyword detection.
- `questions.ts` — trade-specific "locking questions" shown when the brief scores under 70.
- `score.ts` — brief strength (detail, size, material, location, action verb, trade terms, exclusions).
- `points.ts` — generates exactly 5 checkpoints (`construction-1..5`) from the brief and answers, each with a suggested code.
- **Server results in the Vault.** For each uploaded photo the Vault detail shows, in the server's own terms and only when the server sends them: the Apple device check, a **clock check** (`CONSISTENT` means the phone's clocks agree with each other, not that the time is proven; `UNVERIFIED TIME` after a restart is not tampering; `DEVICE CLOCK MISMATCH` also puts a warning on the list row), whether a **server ticket** anchors where the job's photo chain started, and a daily **outside timestamp** with whether its certificate chain was checked. A server that predates these fields produces no lines.
- **Server tickets (`src/native/tickets.ts`).** Before a job's first photo (or the phone's, for the id `device`) the app asks the server for a signed ticket, countersigns it with the phone's hardware key and makes it the start of that chain; it runs after sign-on, after a job is locked, and when signal returns (the 60-second sync). Best effort: no failure stops or delays a photo, the shutter waits at most 2 s for a handshake already under way and never starts one, and a chain that could not get a ticket keeps a local start. Until the server owner sets a ticket key (and on a server without these routes) the calls end quietly. A job started offline, or after its first photo, keeps a local start. `readClock`, `signGenesis` and `adoptServerTicket` have unit tests and shared vectors but have **never run on a device against a server**.
- `codes.ts` — 22 code-reference rows (16, plus 6 foundation rows: R401.3, R403.1, R403.1.4, R404.1.3, R405.1, R406.1) bundled so the Codes view and suggestions work offline. Section numbers refer to the **2021 IRC**; Utah adopts it with state amendments (Utah Code 15A-2-103), so Utah's text can differ. There are no IBC citations (one- and two-family dwellings fall under the IRC). The foundation rows (and the R403.1.6 sill-anchor row) were read first-hand from ICC's published 2021 IRC Chapter 4 and Utah Code 15A-3-202; the other rows' section numbers, topics and figures were relayed through research notes rather than read first-hand. **No inspector has reviewed any of them**; descriptions are summaries, not code text. Utah's amendments (Utah Code 15A-3-202 to -206 and -601, pages dated 7/1/2026 or 7/1/2025) were searched by section number: R403.1.6 and R403.1.6.1 (a 32-inch bolt-spacing exception), R403.1.3.5.3 (vertical footing steel placed while the concrete is plastic), R404.1 (design to IBC 1807.1.5 and 1807.1.6 as an alternative) and R405.1 (no drain required where a geotechnical report says so) are amended; the other cited sections are not mentioned by number, and these exceptions are reflected in the rows. A footing or foundation-wall job gets different points 1, 4 and 5 (footing depth, wall waterproofing and drain before backfill, grade away from the foundation). Those points list every section that applies, main one first: point 1 R403.1.4 + R403.1, point 4 R406.1 + R405.1 + R404.1.3, point 5 R401.3. The extra sections ride in the point as `moreCodes` (left out of the packet when empty, so older packets are unchanged). **Not checked:** IPC/IMC/NEC amendments that Utah applies to "corresponding" IRC sections (15A-3-201(2)), including whether E3905.3.1 and E3906.8 correspond to amended NEC sections; most IPC amendment text; and the 1/1/2027 version of 15A-2-103. The earlier version of this table had many numbers pointing at sections that cover something else, and the `tradedeck-api` seed migration (`20261002000000_shield_checkpoints_scaffolding.sql`) still carries those older rows. Reference only: confirm with your inspector.
- `closeout.ts` — `buildCloseoutPacket` freezes brief + points + each point's `SealRecord` (photo hash, chain head, device signature) into one packet: `integrity.hash = SHA-256(stableStringify(body))`, `integrity.signature = ECDSA(device key, same bytes)`, with the device public key embedded. `verifyCloseoutPacket` recomputes both and also authenticates each point's record (signature, chain head, seal ID).

A photo sealed against a construction point is the same forensic `SealRecord` as any other capture — the Build tab adds *what* to photograph and *why*; it does not change *how* the photo is proven.

## What the packet proves / does not prove

- Proves (when verification passes): the packet hash, every point's record signature and `chainHead`, and the seal-ID-to-key binding are consistent with the public key in the file, so nothing was edited after signing. Records are checked for duplicate/forked chain links, wrong job or checkpoint, time running backwards, and future timestamps.
- Does **not** prove who holds the signing key. The key travels inside the file, so anyone can produce a self-consistent packet with their own key. Compare the displayed signer seal ID with one you trust (the Verify tab accepts an expected ID and then fails any other signer).
- Does not prove: photo bytes (they are not in the close-out packet; the hashes are), that time is accurate (the capture record carries wall, monotonic, and boot identity so the server can label CONSISTENT / UNVERIFIED TIME / DEVICE CLOCK MISMATCH), that the photo came from a physical camera sensor rather than something fed to the OS camera (App Attest and Play Integrity are not called yet), or that the scene was not staged. Android records `isMock` / `isFromMockProvider`. iOS records `isSimulatedBySoftware` / `isProducedByAccessory`. iOS `CLLocation.timestamp` is the OS fix time, not a raw satellite clock. The hashed JPEG is the in-app camera's file bytes (CameraX quality 95 on Android; AVFoundation `fileDataRepresentation` on iOS), not a second encode in JavaScript. Only records whose `captureKind` is `native-camera` verify; any other kind is rejected (`unsupported-capture-kind`).
- Key custody: the Vault copy is a non-extractable WebCrypto key in IndexedDB. The evidence copy is a hardware key that does not leave the Secure Enclave or Android Keystore. A simulator or a device without a Secure Enclave records `key_security_level: software` and still seals locally; a server should refuse that level. If the outbox already has records, the key cannot be reset.
- Apple App Attest (iPhone) is half built. At sign-on the phone enrolls: the server hands out a challenge, Apple vouches for a new key (`attestKey`, needs signal), and the server checks the proof (`POST /shield/attest`). After that each seal records an assertion over the record hash, offline, in `app_attest_assertion_b64`. The assertion is sent with the photo when it is uploaded, and the server checks it against the key the account enrolled (the counter must rise) and stores the result with the photo. **The phone shows the server's answer, not its own check:** after a photo uploads, the Vault says "Apple device check: verified by the Shield server" or "not verified" with the server's status, and "not checked yet" before upload. The phone's own records still say `attest: none`, and the Verify tab's stored verdict is still `UNATTESTED-NATIVE` (shown on screen as "NATIVE CAMERA · photo matches its signed hash" with a note that Apple's check is the server's). Do not treat a sealed photo as device-attested from the phone alone. Play Integrity (Android) is not implemented: `play_integrity_token` is null. Not yet run against a real device attestation.
- A photo bundle (`.shield.json`) now embeds the device public key and is authenticated the same way. A bundle without a key is reported `NO-ORIGIN` with `record-unauthenticated`.

## What is recorded when a photo is sealed

All of this is in the signed record (`SealRecord`), taken in this order after the OS camera hands the photo back:

- `sha256`, `bytes`, `mime` of the photo; the photo itself is stored separately on the device.
- `createdAt`: the device clock, read when sealing starts (after you confirm the photo, not at the shutter press).
- `gps` (lat, lng, accuracy, source `os`) read right after, waiting up to ~4.5 s and allowed to be a fix up to 5 s old; `null` if location is off or times out. Nobody can type a location. `pinScore` is retired: new records always carry `null` (the key stays because it is part of the signed form); old records that carry a score still verify.
- `jobId`, `checkpointId`, `platform` (ios/android), `captureKind` (`native-camera`), `deviceSealId`, `attest` (currently always `none`), `prevChain` / `chainHead`, and the ECDSA `signature`.

The Vault `SealRecord` is the software copy above. The hardware capture record (see `plugins/secure-capture/README.md`) additionally stores the photo hash, previous record hash, ticket id, wall time, monotonic time, boot id or boot count, a GNSS time when a fix exists, a simulated-location flag, a sensor-snapshot hash (GPS integers, app version, key security level), and a DER signature. A local chain with no server ticket is labeled `ticket_origin: local` and is not a server ticket hash. `adoptServerTicket` is refused once any photo is in that chain.
