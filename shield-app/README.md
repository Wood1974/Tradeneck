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

## Tabs

| Tab | What it does |
|---|---|
| **Capture** | Rear camera on native (`@capacitor/camera`), arrival hash on web. Every photo: SHA-256 of the bytes → hash chain (`prevChain` → `chainHead`) → ECDSA P-256 signature with this device's key (IndexedDB, non-extractable). |
| **Jobs** | Lock a generic pack (remodel / draw / unit / loss / shop / custom) — industry-agnostic checkpoints with an optional GPS pin and a fee tier. |
| **Vault** | Originals stay on device. REHASH recomputes the SHA-256; EXPORT writes a `.shield.json` bundle (record + original). |
| **Verify** | Drop a bundle; recomputes the hash of the embedded original and reports `SEALED` / `TAMPERED` / `ARRIVAL-ONLY` / `NO-ORIGIN`. |
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
- Does not prove: camera vs. gallery on web (`ARRIVAL-ONLY`), GPS truthfulness, or that the scene was not staged. Native App Attest / Play Integrity (`src/native/`) is the path to origin proof and is wired but not yet backed by a plugin.
