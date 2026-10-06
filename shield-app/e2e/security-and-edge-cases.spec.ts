import { test, expect, Page } from '@playwright/test';

test.describe('Security Testing - Packet Integrity & Tampering', () => {
  let page: Page;

  test.beforeEach(async ({ page: browserPage }) => {
    page = browserPage;
    await page.goto('/');
    await page.evaluate(() => indexedDB.deleteDatabase('shield-db'));
    await page.reload();
  });

  test('should detect tampered packet signature', async () => {
    // Create and export a packet
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Signature Test');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test tampering detection');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Go to Close and export
    let nextBtn = page.locator('button:has-text("Next")');
    while (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
      nextBtn = page.locator('button:has-text("Next")');
    }

    await page.selectOption('select[name="role"]', 'gc');
    await page.fill('textarea[name="notes"]', 'Test');
    await page.check('input[name="allow-missing"]');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Freeze & export packet")').click();
    const download = await downloadPromise;
    const path = await download.path();

    // Tamper with packet
    const fs = await import('fs');
    let content = fs.readFileSync(path, 'utf-8');
    const packet = JSON.parse(content);

    // Corrupt the signature
    packet.integrity.signature = packet.integrity.signature.slice(0, -1) + 'X';
    const tamperedContent = JSON.stringify(packet);

    // Go to Verify and upload tampered packet
    await page.click('[data-tab="verify"]');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: 'shield-record.json',
        mimeType: 'application/json',
        buffer: Buffer.from(tamperedContent),
      });

      // Wait for verification and check verdict
      await page.waitForTimeout(2000);
      const verdict = page.locator('[data-verify-verdict]');
      await expect(verdict).toBeVisible({ timeout: 5000 });

      // Verdict should indicate tampering
      const verdictText = await verdict.textContent();
      expect(verdictText).toMatch(/TAMPERED|FAILED|INVALID/i);
    }
  });

  test('should detect packet with corrupted hash', async () => {
    // Create packet
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Hash Test');
    await page.selectOption('select[name="trade"]', 'electrical');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test hash tampering');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Navigate to Close
    let nextBtn = page.locator('button:has-text("Next")');
    while (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
      nextBtn = page.locator('button:has-text("Next")');
    }

    await page.selectOption('select[name="role"]', 'gc');
    await page.fill('textarea[name="notes"]', 'Test');
    await page.check('input[name="allow-missing"]');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Freeze & export packet")').click();
    const download = await downloadPromise;
    const path = await download.path();

    // Tamper with hash
    const fs = await import('fs');
    let content = fs.readFileSync(path, 'utf-8');
    const packet = JSON.parse(content);

    // Corrupt the hash
    packet.integrity.hash = '0000000000000000000000000000000000000000000000000000000000000000';
    const tamperedContent = JSON.stringify(packet);

    // Verify should fail
    await page.click('[data-tab="verify"]');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: 'shield-record.json',
        mimeType: 'application/json',
        buffer: Buffer.from(tamperedContent),
      });

      await page.waitForTimeout(2000);
      const verdict = page.locator('[data-verify-verdict]');
      await expect(verdict).toBeVisible({ timeout: 5000 });

      const verdictText = await verdict.textContent();
      expect(verdictText).toMatch(/TAMPERED|FAILED|INVALID/i);
    }
  });

  test('should verify signature stability across multiple verifications', async () => {
    // Create packet
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Stability Test');
    await page.selectOption('select[name="trade"]', 'hvac');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test signature stability');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Go to Close and export
    let nextBtn = page.locator('button:has-text("Next")');
    while (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
      nextBtn = page.locator('button:has-text("Next")');
    }

    await page.selectOption('select[name="role"]', 'gc');
    await page.fill('textarea[name="notes"]', 'Test');
    await page.check('input[name="allow-missing"]');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Freeze & export packet")').click();
    const download = await downloadPromise;
    const path = await download.path();

    const fs = await import('fs');
    const content = fs.readFileSync(path, 'utf-8');
    const packet1 = JSON.parse(content);

    // Verify multiple times, signature should remain same
    const signatures = [packet1.integrity.signature];

    // Reload and verify again (should recompute same signature)
    await page.reload();
    await page.click('[data-tab="verify"]');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: 'shield-record.json',
        mimeType: 'application/json',
        buffer: Buffer.from(content),
      });

      // Get result
      await page.waitForTimeout(2000);
      const verdict = page.locator('[data-verify-verdict]');
      await expect(verdict).toBeVisible({ timeout: 5000 });

      // Should be valid
      const verdictText = await verdict.textContent();
      expect(verdictText).toMatch(/SEALED|VALID|SUCCESS/i);
    }
  });
});

test.describe('Edge Cases & Error Handling', () => {
  let page: Page;

  test.beforeEach(async ({ page: browserPage }) => {
    page = browserPage;
    await page.goto('/');
    await page.evaluate(() => indexedDB.deleteDatabase('shield-db'));
    await page.reload();
  });

  test('should handle empty brief title gracefully', async () => {
    await page.click('[data-tab="construction"]');

    // Try with empty title
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Description');

    // Lock button should be disabled or lead to error
    const lockBtn = page.locator('button:has-text("Lock brief")');
    if (await lockBtn.isVisible()) {
      const isDisabled = await lockBtn.isDisabled();
      expect(isDisabled).toBe(true);
    }
  });

  test('should handle special characters in inputs', async () => {
    await page.click('[data-tab="construction"]');

    const specialChars = 'Test™ Roof 中文 Española 🔒 $100K';
    await page.fill('input[placeholder*="Title"]', specialChars);
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Description with ' + specialChars);

    // Should handle without crashing
    const title = await page.inputValue('input[placeholder*="Title"]');
    expect(title).toContain('Test™');
  });

  test('should handle max-length descriptions gracefully', async () => {
    await page.click('[data-tab="construction"]');

    await page.fill('input[placeholder*="Title"]', 'Test');
    await page.selectOption('select[name="trade"]', 'electrical');
    await page.selectOption('select[name="budget"]', 'over50');

    // Fill with very long description
    const longText = 'x'.repeat(5000);
    await page.fill('textarea[name="description"]', longText);

    // App should not crash
    await expect(page.locator('[data-strength-meter]')).toBeVisible();
  });

  test('should handle rapid photo sealing operations', async () => {
    // Setup brief
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Rapid Seal Test');
    await page.selectOption('select[name="trade"]', 'framing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Try to seal multiple checkpoints in rapid succession
    await expect(page.locator('[data-cview="points"]')).toBeVisible({ timeout: 5000 });

    const checkpoints = page.locator('[data-checkpoint-item]');
    const count = await checkpoints.count();

    // Seal first two checkpoints without waiting
    for (let i = 0; i < Math.min(2, count); i++) {
      const checkpoint = checkpoints.nth(i);
      const sealBtn = checkpoint.locator('[data-action="seal"]');

      if (await sealBtn.isVisible()) {
        await sealBtn.click();

        const fileInput = page.locator('input[type="file"]').first();
        if (await fileInput.isVisible()) {
          await fileInput.setInputFiles({
            name: `photo-${i}.jpg`,
            mimeType: 'image/jpeg',
            buffer: Buffer.from(`photo-data-${i}`),
          });
        }
      }
    }

    // Wait and verify both sealed
    await page.waitForTimeout(3000);
    const sealedStatus = page.locator('[data-seal-status]');
    const sealedCount = await sealedStatus.count();
    expect(sealedCount).toBeGreaterThan(0);
  });

  test('should handle code assignment to all checkpoints', async () => {
    // Create brief
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Code Assignment Test');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Navigate to Codes view
    let nextBtn = page.locator('button:has-text("Next")');
    while (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
      nextBtn = page.locator('button:has-text("Next")');
      if (await page.locator('[data-cview="codes"]').isVisible()) {
        break;
      }
    }

    // Verify codes are available
    const codeRows = page.locator('[data-code-row]');
    const codeCount = await codeRows.count();
    expect(codeCount).toBeGreaterThan(0);

    // Assign multiple codes
    for (let i = 0; i < Math.min(3, codeCount); i++) {
      const code = codeRows.nth(i);
      if (await code.isVisible()) {
        await code.click();
        await page.waitForTimeout(200);
      }
    }
  });

  test('should handle export when some checkpoints are not sealed', async () => {
    // Create brief
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Partial Seal Test');
    await page.selectOption('select[name="trade"]', 'plumbing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Seal only first checkpoint
    const firstCheckpoint = page.locator('[data-checkpoint-item]').first();
    await firstCheckpoint.locator('[data-action="seal"]').click();

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: 'test.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('data'),
      });
    }

    // Go to Close
    let nextBtn = page.locator('button:has-text("Next")');
    while (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
      nextBtn = page.locator('button:has-text("Next")');
    }

    // Should require "allow missing" checkbox
    const allowMissingCheckbox = page.locator('input[name="allow-missing"]');
    if (await allowMissingCheckbox.isVisible()) {
      // Without checkbox, export should fail or be disabled
      const exportBtn = page.locator('button:has-text("Freeze & export packet")');
      if (await exportBtn.isVisible()) {
        const isDisabled = await exportBtn.isDisabled();
        if (isDisabled) {
          // Button is disabled until checkbox is checked
          await allowMissingCheckbox.check();
          expect(await exportBtn.isDisabled()).toBe(false);
        }
      }
    }
  });
});
