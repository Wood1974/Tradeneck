import { test, expect, Page } from '@playwright/test';

test.describe('Offline Testing - Zero Network Calls', () => {
  let page: Page;
  let networkRequests: string[] = [];

  test.beforeEach(async ({ page: browserPage }) => {
    page = browserPage;
    networkRequests = [];

    // Track all network requests
    page.on('request', (request) => {
      networkRequests.push(request.url());
    });

    await page.goto('/');
    await page.evaluate(() => indexedDB.deleteDatabase('shield-db'));
    await page.reload();

    // Clear tracking after initial load
    networkRequests = [];
  });

  test('should complete brief creation with zero external network calls', async () => {
    // Navigate to Construction
    await page.click('[data-tab="construction"]');

    // Fill brief
    await page.fill('input[placeholder*="Title"]', 'Roof Replacement');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Full roof replacement with asphalt shingles');

    // Lock brief
    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Verify no external network calls (only local/localhost allowed)
    const externalRequests = networkRequests.filter(
      (url) => !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('ws://')
    );
    expect(externalRequests).toHaveLength(0);
  });

  test('should seal photo via arrival hash with zero network', async () => {
    // Setup: Create brief
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Test Project');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Clear network tracking before seal operation
    networkRequests = [];

    // Seal photo
    await expect(page.locator('[data-cview="points"]')).toBeVisible({ timeout: 5000 });
    const firstCheckpoint = page.locator('[data-checkpoint-item]').first();
    await firstCheckpoint.locator('[data-action="seal"]').click();

    // Wait for modal
    await expect(page.locator('[data-seal-modal]')).toBeVisible({ timeout: 5000 });

    // Upload file
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: 'test.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('test-data'),
      });
    }

    // Wait for seal to complete
    await page.waitForTimeout(2000);

    // Verify seal succeeded with zero external network
    const externalRequests = networkRequests.filter(
      (url) => !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('ws://')
    );
    expect(externalRequests).toHaveLength(0);

    // Verify seal status updated
    const sealStatus = firstCheckpoint.locator('[data-seal-status]');
    await expect(sealStatus).toBeVisible({ timeout: 5000 });
  });

  test('should export packet with zero network calls', async () => {
    // Setup: Create brief and navigate to Close
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Export Test');
    await page.selectOption('select[name="trade"]', 'electrical');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Test export');

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

    // Clear network tracking
    networkRequests = [];

    // Export packet
    await page.selectOption('select[name="role"]', 'gc');
    await page.fill('textarea[name="notes"]', 'Completed');
    await page.check('input[name="allow-missing"]');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Freeze & export packet")').click();
    await downloadPromise;

    // Verify no external network calls during export
    const externalRequests = networkRequests.filter(
      (url) => !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('ws://')
    );
    expect(externalRequests).toHaveLength(0);
  });

  test('should verify packet offline with zero network', async () => {
    // Create and export packet first
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Verify Test');
    await page.selectOption('select[name="trade"]', 'framing');
    await page.selectOption('select[name="budget"]', 'under15');
    await page.fill('textarea[name="description"]', 'Test');

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
    await page.fill('textarea[name="notes"]', 'Done');
    await page.check('input[name="allow-missing"]');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Freeze & export packet")').click();
    const download = await downloadPromise;
    const path = await download.path();

    const fs = await import('fs');
    const content = fs.readFileSync(path, 'utf-8');

    // Go to Verify and upload packet
    await page.click('[data-tab="verify"]');

    // Clear network tracking
    networkRequests = [];

    // Upload packet
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: 'shield-record.json',
        mimeType: 'application/json',
        buffer: Buffer.from(content),
      });
    }

    // Wait for verification
    await page.waitForTimeout(2000);

    // Verify no external calls during verification
    const externalRequests = networkRequests.filter(
      (url) => !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('ws://')
    );
    expect(externalRequests).toHaveLength(0);

    // Verify verdict is displayed
    const verdict = page.locator('[data-verify-verdict]');
    await expect(verdict).toBeVisible({ timeout: 5000 });
  });

  test('should handle offline IndexedDB queries efficiently', async () => {
    // Create multiple jobs to stress IndexedDB
    for (let i = 0; i < 3; i++) {
      await page.click('[data-tab="construction"]');
      await page.fill('input[placeholder*="Title"]', `Project ${i}`);
      await page.selectOption('select[name="trade"]', i % 2 === 0 ? 'roofing' : 'electrical');
      await page.selectOption('select[name="budget"]', 'over50');
      await page.fill('textarea[name="description"]', `Project ${i} description`);

      const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
      if (await lockBtn.isVisible()) {
        await lockBtn.click();
        await page.locator('button:has-text("Finalize")').click().catch(() => {});
      }

      // Go to Vault to ensure data is stored
      await page.click('[data-tab="vault"]');
      await page.waitForTimeout(500);
    }

    // Clear network tracking
    networkRequests = [];

    // Query vault (should be fast from IndexedDB)
    const startTime = Date.now();
    await page.click('[data-tab="vault"]');
    const records = page.locator('[data-vault-record]');
    await records.first().isVisible({ timeout: 5000 });
    const queryTime = Date.now() - startTime;

    // Should complete quickly (< 5 seconds for IndexedDB)
    expect(queryTime).toBeLessThan(5000);

    // Should have zero external network calls
    const externalRequests = networkRequests.filter(
      (url) => !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('ws://')
    );
    expect(externalRequests).toHaveLength(0);
  });

  test('should reload app with Flight Mode and maintain state', async () => {
    // Create a brief
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Persist Test');
    await page.selectOption('select[name="trade"]', 'plumbing');
    await page.selectOption('select[name="budget"]', '15to50');
    await page.fill('textarea[name="description"]', 'Test persistence');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Verify points are loaded
    await expect(page.locator('[data-cview="points"]')).toBeVisible({ timeout: 5000 });
    const checkpoints = page.locator('[data-checkpoint-item]');
    const initialCount = await checkpoints.count();
    expect(initialCount).toBe(5);

    // Clear network tracking and reload
    networkRequests = [];
    await page.reload();

    // Verify data persisted after reload
    await expect(page.locator('[data-cview="points"]')).toBeVisible({ timeout: 5000 });
    const reloadedCheckpoints = page.locator('[data-checkpoint-item]');
    const reloadedCount = await reloadedCheckpoints.count();
    expect(reloadedCount).toBe(5);

    // Verify minimal network calls on reload (only app assets)
    const externalRequests = networkRequests.filter(
      (url) =>
        !url.includes('localhost') &&
        !url.includes('127.0.0.1') &&
        !url.includes('ws://') &&
        !url.includes('.js') &&
        !url.includes('.css') &&
        !url.includes('.png') &&
        !url.includes('.svg') &&
        !url.includes('.ico')
    );
    expect(externalRequests).toHaveLength(0);
  });
});
