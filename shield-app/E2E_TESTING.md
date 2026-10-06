# End-to-end tests

Playwright drives the production build (`vite build` + `vite preview`) in Chromium with a fake camera
(`--use-fake-device-for-media-stream`). Everything is in `e2e/shield.spec.ts`; there is no mocking of the app.

## What is covered (6 tests)

| Test | Proves |
|---|---|
| brief to sealed point to frozen record to verified packet | lock a brief, seal point 1 via the in-page camera, freeze, export, re-import and verify `PACKET-SEALED` |
| an edited packet is reported as altered | changing a field after signing gives `PACKET-TAMPERED` / `hash-mismatch` |
| pinning the wrong signer fails | a valid packet is rejected when the expected seal ID does not match |
| a double tap on the shutter seals exactly one photo | the in-flight guard; fails if the guard is removed |
| arrival-hash seal rehashes clean and survives a reload | record authenticates; vault persists across reload |
| the whole workflow makes no network requests once loaded | runs offline (`context.setOffline(true)`) and asserts zero requests |

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

Native camera, App Attest / Play Integrity, iOS and Android devices, and real-GPS behavior need physical devices.
