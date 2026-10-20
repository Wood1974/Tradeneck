# End-to-end tests

Playwright drives an **e2e build** (`vite build --mode e2e --outDir dist-e2e`, never shipped) in Chromium. A browser
cannot drive the OS camera, so that build replaces only the camera call with a stand-in (`__shieldE2ECamera`) and the
test pretends to be the Android app. A second stand-in (`__shieldE2EIdentity`) scripts the answers of the Shield server and
Stripe Identity; the phone side of sign-on (consent, statement, signing with the device key, storing, gating) is real.
Everything after the camera (hash, chain, sign, store, freeze, verify) is the real code. Receipts in these tests are signed by a stand-in
key, not the pinned production key, so they only show the packet reports `id-receipt-signer-unknown`
and never `confirmed-by-service`; the confirmed path is covered in `src/**/*.test.ts` with a shared Python vector. Stripe and the backend are not
exercised here (the backend has its own tests in `tradedeck-shield/server/tests/test_identity.py`). The real Capacitor camera path is not exercised here. `npm run check:bundle` (run in CI) fails if the stand-in
appears in the production `dist/`. The same check covers the identity stand-in.

## What is covered (16 tests)

| Test | Proves |
|---|---|
| brief to sealed point to frozen record to verified packet | lock a brief, seal point 1, freeze, export, re-import and verify `PACKET-SEALED` |
| an edited packet is reported as altered | changing a field after signing gives `PACKET-TAMPERED` / `hash-mismatch` |
| pinning the wrong signer fails | a valid packet is rejected when the expected seal ID does not match |
| a double tap on SEAL FRAME seals exactly one photo | the in-flight guard; fails if the guard is removed |
| a sealed photo rehashes clean and survives a reload | record authenticates; vault persists across reload |
| back is the default, front can be chosen | the toggle changes the direction passed to the camera |
| the one-tap camera button is on every tab | present on all five tabs, seals without leaving the tab, VIEW opens the record |
| a double tap on the one-tap button seals one photo | the in-flight guard applies to it too |
| a denied camera seals nothing | an error shows and the vault stays empty |
| a browser cannot capture | no capture button, video, gallery or file path; SEAL in a browser seals nothing and opens no picker |
| the offline workflow makes no network requests | after sign-on, runs offline (`context.setOffline(true)`) and asserts zero requests (uploading waits for signal, so none are sent) |
| sign-on warns when offline | the sign-on screen says to do it with signal, warns when the phone goes offline without wiping typed input, and clears the warning when signal returns |
| a signed-on phone keeps working with the network off | after sign-on the network is switched off: the "Ready to work offline" status shows, a photo seals and rehashes clean, and sign-on is not asked for again |
| a new person can create an account, then sign in | create-account mode: a short password or mismatched passwords send nothing and keep what was typed; a valid sign-up returns to Sign in with the email kept and a message that does not say whether the address was new; no ID check is reachable until signed in |
| a test-mode ID check is labelled | a receipt marked `testMode` signs the owner on (a photo still seals) but the capture screen says "TEST ID CHECK" and never "SIGNED NOTE ON FILE" |
| an unverified phone cannot seal | sign-on step by step: wrong password, consent required, no signing before the check passes, no capture control until the note is signed, note survives a reload |

Signature, chain, forgery and migration edge cases are unit-tested in `src/**/*.test.ts` (`npm test`), which is
faster and runs on every push.

## Run

```bash
npm run test:e2e                                   # builds, serves on :4173, runs headless
PW_CHROMIUM_PATH=/path/to/chromium npm run test:e2e   # use an already-installed Chromium
npx playwright install --with-deps chromium        # first run on a fresh machine / CI
```

CI runs this as the `e2e` job in `.github/workflows/shield-app.yml` and uploads `playwright-report/` on failure.

## Not covered

The real native camera, App Attest / Play Integrity, iOS and Android devices, and real-GPS behavior need physical devices.
