# Export is the hardware-signed record

The Vault keeps a copy of each photo signed by a key in the web view's storage. The record that uploads to the Shield server is signed by the Secure Enclave / Keystore key and carries the sensor snapshot and Apple's assertion. EXPORT used to write the first; it now writes the second, so "signed by this phone's hardware key" is true of the file.

## What the file is
The plugin's own `tradedeck.shield.capture-export.v1` package (`exportQueue`) for the photo's job, so the hash chain from `anchor_hash` checks, with the chosen photo's bytes in `photo_b64` on its record. Other photos in the chain keep their hashes and signatures but not their bytes (`includePhotos: false`), which keeps the file small. Code: `src/native/export-package.ts`.

## What it refuses
- A photo with no hardware record on this phone (for example a Vault copy made before hardware sealing existed): "nothing true to export", nothing written.
- Stored bytes that no longer hash to the signed `photo_sha256`: nothing written.
- A browser, which has no hardware record at all.

## Checking it
The app's Verify tab imports this package and checks the chain, each signature, the photo hash and the sensor snapshot. `src/native/export-package.verify.test.ts` runs the real verifier over a package built here (chain intact, both signatures valid, photos `absent` then `match`).

## Not verified
- The real plugin on a phone, the iOS share sheet with this file, and the size of a large job through the bridge. Tests stand in for the plugin.
- Apple's assertion is carried in each record but nothing in this file lets a third party check it by itself; that needs Apple's attestation object, which the Shield server now keeps (tradedeck-shield #33) and a later change adds to the export.
