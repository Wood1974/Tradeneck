# End-to-end tests

Playwright drives an **e2e build** (`vite build --mode e2e --outDir dist-e2e`, never shipped) in Chromium. A browser
cannot drive the OS camera, so that build replaces only the camera call with a stand-in (`__shieldE2ECamera`) and the
test pretends to be the Android app. Everything after the camera (hash, chain, sign, store, freeze, verify) is the real
code. The real Capacitor camera path is not exercised here. `npm run check:bundle` (run in CI) fails if the stand-in
appears in the production `dist/`.

## What is covered (11 tests)

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
| the whole workflow makes no network requests | runs offline (`context.setOffline(true)`) and asserts zero requests |

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
