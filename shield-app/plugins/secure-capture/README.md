# Secure capture

In-app camera and hardware seal for TradeDeck Shield. No gallery path. Works offline: originals and records stay in app-private storage until a later sync step exports them.

Shared fixtures: `shield-app/test-vectors/capture-record-v1.json`. The TypeScript and Kotlin tests, and the iOS debug fixture check, all use those bytes.

## Signed message

```
message     = UTF-8 canonical(record) || 0x7C || UTF-8 prev_hash
record_hash = SHA-256(message), lowercase hex
```

`prev_hash` and `record_hash` are not inside the canonical JSON. The first `prev_hash` is the server ticket hash when one has been adopted, otherwise `SHA-256("tradedeck.shield.local-genesis.v1\n" || ticket_clock || "\n" || ticket_id)`.

Canonical JSON matches Tradedeck-api `capture_record.py`: sorted keys, separators `("," , ":")`, null omitted, `0` and `false` kept, non-ASCII escaped as `\uXXXX` (Python `ensure_ascii=True`). Whole numbers only. Booleans are `true`/`false`. Coordinates are microdegrees, accuracy millimetres, heading hundredths of a degree, times milliseconds, scaled before they are signed.

Signed fields, in canonical order: `version`, `checkpoint_id`, `photo_sha256`, `ticket_id`, `wall_time_ms`, `monotonic_ms`, `boot_id`, `boot_count`, `gnss_time_ms`, `location_simulated`, `sensor_hash`, `depth_hash`, `depth_present`, `flags`.

`flags`: 1 screen captured, 2 debugger, 4 mock location, 8 root traces (Android `test-keys` only; iOS does not set this bit).

GPS, accuracy, app version, and key security level live in the sensor snapshot. `sensor_hash` is SHA-256 of that snapshot's canonical JSON. The snapshot is stored beside the record so a verifier can recompute the hash. This build sets `depth_present` false.

## Signatures

Android Keystore `SHA256withECDSA` over `message`. Do not pre-hash. DER.

iOS CryptoKit Secure Enclave `signature(for:)` over the same `message` (SHA-256 then ECDSA). DER. Public key is the uncompressed point `0x04 || X || Y`, base64. `key_id_sha256` is SHA-256 of that point.

StrongBox is tried first on Android API 28+. If it fails, the alias is deleted and the key is created in the TEE. The record stores the level KeyInfo reports (`StrongBox`, `TEE`, or `software`). iOS stores `SecureEnclave`, or `software` when the enclave is missing (simulator). The private key is not exported.

## Time labels

Same rules as `time_audit.py`. Limit is 120000 ms.

- Boot id or boot count changed, or one side has no boot identity: `UNVERIFIED TIME`.
- Same boot and the monotonic clock moved backward: `UNVERIFIED TIME`.
- Same boot and `|wall − (ticket_wall + monotonic elapsed)|` is greater than 120000: `DEVICE CLOCK MISMATCH`. 120000 agrees. 120001 does not. Both directions.
- GNSS time versus the photo wall clock beyond 120000 is also `DEVICE CLOCK MISMATCH`, including across a reboot. Both labels are kept. A missing GNSS time is not a failure.
- Flags and `location_simulated` do not change the time verdict.

The ticket clock compared here is the phone's wall clock at countersign (`ticket_clock`), not `server_time_ms`.

## Genesis

```
clientData = UTF-8("shield-genesis-v1") || SHA256(ticket_hash_raw || canonical(ticket_clock))
```

Android signs `clientData` with `SHA256withECDSA` and must not pre-hash. iOS Secure Enclave signs the same `clientData`. App Attest would pass `SHA256(clientData)` to `generateAssertion`. That call is not made.

`ticket_clock` is the canonical JSON of `wall_time_ms`, `monotonic_ms`, and `boot_id` and/or `boot_count`.

## Not implemented

- Apple App Attest (`app_attest_assertion_b64` is null). `attestKey` needs the network.
- Google Play Integrity (`play_integrity_token` is null). Request it at enrollment or sync, not on the offline seal path.
- Upload, TSA countersign, and batch receipts.

## Export

`exportQueue` returns `{ packages: [...] }` with schema `tradedeck.shield.capture-export.v1`. `verifyLocal` checks the chain, the hardware signature, the photo bytes, and the time label on device. `readOriginal` returns the JPEG for one record hash.
