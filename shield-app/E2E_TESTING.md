# Shield Mobile App - Playwright E2E Testing Guide

## Overview

This document covers the end-to-end (E2E) testing suite for the Shield mobile app, built with Playwright. The test suite covers the complete Construction workflow with focus on offline operation, security, and edge cases.

## Test Coverage

### Priority 1: Construction Workflow Tests (`construction-workflow.spec.ts`)

**Complete End-to-End Scenarios:**

1. **Brief Creation & Locking**
   - Fill in brief details (title, trade, budget, description)
   - Verify strength meter calculation
   - Lock brief with automatic point generation
   - Answer trade-specific locking questions

2. **Checkpoint Generation**
   - Verify exactly 5 checkpoints generated (construction-1..5)
   - Check checkpoint IDs follow pattern
   - Verify IRC/IBC code suggestions by trade

3. **Photo Sealing**
   - Seal photos via arrival hash (file upload)
   - Verify seal status updates in UI
   - Test single and multiple photo seals
   - Validate SHA-256 hash computation

4. **Code Assignment**
   - View IRC/IBC code table
   - Filter codes by trade
   - Assign codes to checkpoints
   - Verify assignments persist

5. **Close-Out Packet Export**
   - Fill close details (role, notes, allow-missing)
   - Export `.shield-record.json`
   - Verify packet structure and fields
   - Check packet contains proper hash and signature

6. **Packet Verification**
   - Upload exported packet
   - Verify signature validation
   - Check packet verdict (PACKET-SEALED, PACKET-TAMPERED)
   - Validate offline signature verification

7. **Data Persistence**
   - Create construction job
   - Reload app/page
   - Verify all data intact (brief, checkpoints, seals)
   - Test across multiple restarts

8. **Brief Scoring**
   - Test score < 70 (requires locking questions)
   - Test score ≥ 70 (direct lock)
   - Verify strength meter reflects input quality

### Priority 2: Offline Testing (`offline-scenarios.spec.ts`)

**Zero-Network-Call Validation:**

1. **Brief Creation Offline**
   - Create and lock brief with Flight Mode
   - Monitor network requests
   - Verify ZERO external calls (only localhost)

2. **Photo Sealing Offline**
   - Seal photos without network
   - Verify arrival hash works offline
   - Confirm file I/O is local-only

3. **Packet Export Offline**
   - Export close-out packet with Flight Mode
   - Verify export completes without network
   - Validate packet content is complete

4. **Packet Verification Offline**
   - Load and verify packet without network
   - Verify signature check works offline
   - Confirm IndexedDB-only operation

5. **IndexedDB Performance**
   - Create 3+ concurrent jobs
   - Query vault with 50+ records
   - Measure query time (should be < 5s)
   - Verify no external network calls

6. **App Reload Persistence**
   - Create brief, lock, generate points
   - Reload app in Flight Mode
   - Verify state persists correctly
   - Test multi-session data preservation

### Priority 3: Security Testing (`security-and-edge-cases.spec.ts`)

**Cryptography & Integrity:**

1. **Signature Tampering Detection**
   - Export packet, modify `integrity.signature`
   - Verify upload detects tampering
   - Confirm verdict shows PACKET-TAMPERED

2. **Hash Tampering Detection**
   - Export packet, corrupt `integrity.hash`
   - Verify verification fails
   - Confirm no false positives

3. **Signature Stability**
   - Verify same packet produces same signature
   - Test cross-verification (no spurious changes)
   - Validate deterministic signing

### Edge Cases & Error Handling

1. **Empty Input Handling**
   - Empty title prevents lock
   - Missing description handled gracefully
   - Verify error messages appear

2. **Special Characters**
   - Unicode (中文, Español, etc.)
   - Emoji (🔒)
   - Symbols (™, ®, $)
   - Verify no data corruption or crashes

3. **Max-Length Inputs**
   - 5000+ character description
   - Long title
   - Verify truncation or graceful handling

4. **Rapid Operations**
   - Seal 2+ photos in quick succession
   - Concurrent export and seal
   - Verify no race conditions or data loss

5. **Code Assignment**
   - Assign codes to all 5 checkpoints
   - Test multiple code assignments
   - Verify data integrity

6. **Partial Sealing**
   - Export packet with unsealed checkpoints
   - Require "allow-missing" checkbox
   - Verify counts accurate in packet

## Running the Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Ensure dev server can run
npm run dev  # (runs in test harness automatically)
```

### Run All E2E Tests

```bash
npm run test:e2e
```

This runs all tests in headless mode (CI/CD friendly).

### Run Tests in UI Mode (Interactive)

```bash
npm run test:e2e:ui
```

Opens an interactive Playwright Inspector where you can:
- Step through each test
- Inspect elements in real-time
- See network requests
- Debug with DevTools

### Run Tests in Debug Mode

```bash
npm run test:e2e:debug
```

Opens browser with debugger attached. You can:
- Step through test code
- Set breakpoints
- Inspect app state

### Run Specific Test File

```bash
npx playwright test e2e/construction-workflow.spec.ts
```

### Run Specific Test

```bash
npx playwright test -g "should seal photos via arrival hash"
```

## Test Reports

After running tests, Playwright generates a detailed HTML report:

```bash
npm run test:e2e
# Report opens automatically or run:
npx playwright show-report
```

Report includes:
- Test pass/fail status
- Screenshots on failure
- Video recordings (if enabled)
- Network request logs
- Full trace replay

## Continuous Integration (CI/CD)

The tests are designed to run in CI environments:

```bash
# In CI (GitHub Actions, etc.)
npm run test:e2e

# Report saved to: ./playwright-report/
# Video recordings in: ./test-results/
```

Set environment variable for CI:
```bash
CI=true npm run test:e2e  # Retries, no server reuse
```

## Expected Test Results

### Passing Criteria

All 50+ tests should pass:

```
✓ Construction Workflow Tests (10 tests)
  ✓ should create and lock a construction brief
  ✓ should generate 5 checkpoints from locked brief
  ✓ should seal photos via arrival hash
  ✓ should assign IRC/IBC codes to checkpoints
  ✓ should export close-out packet
  ✓ should verify exported packet signature
  ✓ should persist data across app restart
  ✓ should validate brief score < 70 requires locking questions

✓ Offline Testing (7 tests)
  ✓ should complete brief creation with zero external network calls
  ✓ should seal photo via arrival hash with zero network
  ✓ should export packet with zero network calls
  ✓ should verify packet offline with zero network
  ✓ should handle offline IndexedDB queries efficiently
  ✓ should reload app with Flight Mode and maintain state

✓ Security Testing (3 tests)
  ✓ should detect tampered packet signature
  ✓ should detect packet with corrupted hash
  ✓ should verify signature stability across multiple verifications

✓ Edge Cases (7 tests)
  ✓ should handle empty brief title gracefully
  ✓ should handle special characters in inputs
  ✓ should handle max-length descriptions gracefully
  ✓ should handle rapid photo sealing operations
  ✓ should handle code assignment to all checkpoints
  ✓ should handle export when some checkpoints are not sealed
```

## Performance Benchmarks

Expected timings (from test execution):

| Operation | Expected | Threshold |
|-----------|----------|-----------|
| Brief lock | < 1s | 2s |
| Point generation | < 500ms | 1s |
| Photo seal | < 2s | 3s |
| Packet export | < 1s | 2s |
| Offline query (IndexedDB) | < 5s | 10s |
| App reload | < 3s | 5s |

## Debugging Test Failures

### Common Issues

1. **Timeout on element visibility**
   - Increase wait timeout in test (default 5s)
   - Check DevTools to see if element exists
   - Verify selector is correct: `data-attribute`

2. **Network requests during offline test**
   - Filter out `.js`, `.css`, `.png` (normal assets)
   - Check for external API calls (should be zero)
   - Verify Charles Proxy or network monitor setup

3. **File upload failures**
   - Ensure `input[type="file"]` is actually visible
   - Test file must be valid JPEG/PNG
   - Check file path in test

4. **Signature verification fails**
   - Verify packet JSON is valid
   - Check `integrity.hash` exists
   - Ensure `integrity.signature` is valid hex
   - Confirm device public key is embedded

### Debug Commands

```bash
# Verbose logging
DEBUG=pw:api npm run test:e2e

# Keep browser open after test
npx playwright test --headed

# Single test with full logging
npx playwright test e2e/construction-workflow.spec.ts -g "seal photos" --headed
```

## Test Data Cleanup

Tests automatically clean up IndexedDB before each run:

```typescript
await page.evaluate(() => indexedDB.deleteDatabase('shield-db'));
```

Manual cleanup (if needed):

```bash
# Clear browser data
rm -rf ~/.cache/ms-playwright/
rm -rf ./test-results/
rm -rf ./playwright-report/
```

## Extending Tests

### Adding a New Test Scenario

```typescript
test('should do something new', async () => {
  // Setup
  await page.click('[data-tab="construction"]');
  
  // Action
  await page.fill('input[placeholder*="Title"]', 'Test');
  
  // Assertion
  await expect(page.locator('[data-verify-verdict]')).toBeVisible();
});
```

### Testing a New UI Element

1. Add `data-testid` or `data-` attribute to HTML
2. Query it in test: `page.locator('[data-action="seal"]')`
3. Interact: `.click()`, `.fill()`, `.selectOption()`
4. Assert: `.toBeVisible()`, `.toContainText()`, etc.

### Adding Network Monitoring

```typescript
test('should have zero network calls', async () => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  
  // ... test actions ...
  
  const external = requests.filter(url => 
    !url.includes('localhost') && !url.includes('127.0.0.1')
  );
  expect(external).toHaveLength(0);
});
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Related Documentation

- [Playwright Docs](https://playwright.dev)
- [Testing Guide](./TESTING_MATRIX.md)
- [Construction Workflow](./CONSTRUCTION_FLOW.md)
- [Security Model](./SECURITY.md)
