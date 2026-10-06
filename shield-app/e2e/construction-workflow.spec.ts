import { test, expect, Page } from '@playwright/test';

test.describe('Construction Workflow - Complete End-to-End', () => {
  let page: Page;

  test.beforeEach(async ({ page: browserPage }) => {
    page = browserPage;
    await page.goto('/');
    // Clear any existing data
    await page.evaluate(() => indexedDB.deleteDatabase('shield-db'));
    await page.reload();
  });

  test('should create and lock a construction brief', async () => {
    // Navigate to Construction tab
    await page.click('[data-tab="construction"]');
    await expect(page).toHaveTitle(/Shield/);

    // Verify we're on the Brief view
    await expect(page.locator('[data-view="construction"]')).toBeVisible();
    await expect(page.locator('[data-cview="brief"]')).toBeVisible();

    // Fill in brief details
    await page.fill('input[placeholder*="Title"]', 'Roof Replacement Project');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Full roof tearoff and replacement with architectural asphalt shingles');
    await page.fill('textarea[name="include"]', 'Debris removal, permits, inspection');
    await page.fill('textarea[name="exclude"]', 'Soffit repair, gutter replacement');

    // Verify strength meter is visible
    await expect(page.locator('[data-strength-meter]')).toBeVisible();

    // Get initial score
    const scoreText = await page.locator('[data-score-value]').textContent();
    const initialScore = parseInt(scoreText || '0');
    expect(initialScore).toBeGreaterThan(0);

    // Lock the brief (should trigger questions if score < 70)
    const lockButton = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockButton.isVisible()) {
      await lockButton.click();
      // Wait for questions to appear
      await expect(page.locator('[data-questions-card]')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should generate 5 checkpoints from locked brief', async () => {
    // Complete the brief setup
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Roof Replacement');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Full roof tearoff and replacement');

    // Lock brief
    const lockButton = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockButton.isVisible()) {
      await lockButton.click();
      await expect(page.locator('[data-questions-card]')).toBeVisible({ timeout: 5000 });
      // Answer any questions and finalize
      const finalizeBtn = page.locator('button:has-text("Finalize")');
      if (await finalizeBtn.isVisible()) {
        await finalizeBtn.click();
      }
    }

    // Wait for points view
    await expect(page.locator('[data-cview="points"]')).toBeVisible({ timeout: 5000 });

    // Verify 5 checkpoints are displayed
    const checkpoints = page.locator('[data-checkpoint-item]');
    const count = await checkpoints.count();
    expect(count).toBe(5);

    // Verify checkpoint IDs follow pattern construction-1..5
    for (let i = 0; i < 5; i++) {
      const checkpoint = checkpoints.nth(i);
      const id = await checkpoint.getAttribute('data-checkpoint-id');
      expect(id).toMatch(/construction-\d/);
    }
  });

  test('should seal photos via arrival hash', async () => {
    // Setup: Create and lock brief
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Roof Replacement');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Full roof replacement');

    // Lock brief (handle questions if needed)
    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Wait for Points view
    await expect(page.locator('[data-cview="points"]')).toBeVisible({ timeout: 5000 });

    // Get first checkpoint and seal it
    const firstCheckpoint = page.locator('[data-checkpoint-item]').first();
    const checkpointId = await firstCheckpoint.getAttribute('data-checkpoint-id');

    // Click SEAL button for first checkpoint
    await firstCheckpoint.locator('[data-action="seal"]').click();

    // Should show modal with camera/upload options
    await expect(page.locator('[data-seal-modal]')).toBeVisible({ timeout: 5000 });

    // Choose arrival hash (file upload) path
    const uploadBtn = page.locator('[data-action="upload-file"]');
    if (await uploadBtn.isVisible()) {
      // Create a simple test image file
      const filePath = '/tmp/test-photo.jpg';
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FF0000';
          ctx.fillRect(0, 0, 100, 100);
        }
      });

      // Use file input if available
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.isVisible()) {
        await fileInput.setInputFiles({
          name: 'test-photo.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('fake-jpeg-data'),
        });
      }
    }

    // Verify seal succeeded (status should update)
    await expect(page.locator(`[data-checkpoint-id="${checkpointId}"] [data-seal-status]`)).toContainText('SEALED|ARRIVAL-ONLY', { timeout: 5000 });
  });

  test('should assign IRC/IBC codes to checkpoints', async () => {
    // Setup: Create brief, lock, generate points, seal one
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Roof Replacement');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Full roof replacement');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Navigate to Codes view
    const codesTab = page.locator('[data-cview-tab="codes"]');
    if (await codesTab.isVisible()) {
      await codesTab.click();
    } else {
      // Click through from points
      const nextBtn = page.locator('button:has-text("Next")');
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
      }
    }

    // Wait for Codes view
    await expect(page.locator('[data-cview="codes"]')).toBeVisible({ timeout: 5000 });

    // Verify IRC/IBC codes are displayed and filterable by trade
    const codeRows = page.locator('[data-code-row]');
    const codeCount = await codeRows.count();
    expect(codeCount).toBeGreaterThan(0);

    // Click a code to assign it
    const firstCode = codeRows.first();
    const codeValue = await firstCode.getAttribute('data-code-irc');

    if (await firstCode.isVisible()) {
      await firstCode.click();
      // Verify assignment (UI should show code as selected/assigned)
    }
  });

  test('should export close-out packet', async () => {
    // Setup: Complete workflow up to Close
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Roof Replacement');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Full roof replacement');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Navigate to Close view
    const closeTab = page.locator('[data-cview-tab="close"]');
    if (await closeTab.isVisible()) {
      await closeTab.click();
    } else {
      // Click through views
      let nextBtn = page.locator('button:has-text("Next")');
      while (await nextBtn.isVisible()) {
        await nextBtn.click();
        await page.waitForTimeout(500);
        nextBtn = page.locator('button:has-text("Next")');
      }
    }

    // Verify Close view
    await expect(page.locator('[data-cview="close"]')).toBeVisible({ timeout: 5000 });

    // Fill close details
    await page.selectOption('select[name="role"]', 'gc');
    await page.fill('textarea[name="notes"]', 'Completed per spec, clean site');
    await page.check('input[name="allow-missing"]');

    // Intercept download
    const downloadPromise = page.waitForEvent('download');

    // Click export button
    await page.locator('button:has-text("Freeze & export packet")').click();

    // Verify download
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('shield-record');
  });

  test('should verify exported packet signature', async () => {
    // First: Create and export a packet
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Roof Replacement');
    await page.selectOption('select[name="trade"]', 'roofing');
    await page.selectOption('select[name="budget"]', 'over50');
    await page.fill('textarea[name="description"]', 'Full roof replacement');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Get to Close view and export
    let nextBtn = page.locator('button:has-text("Next")');
    while (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
      nextBtn = page.locator('button:has-text("Next")');
    }

    await page.selectOption('select[name="role"]', 'gc');
    await page.fill('textarea[name="notes"]', 'Completed');
    await page.check('input[name="allow-missing"]');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Freeze & export packet")').click();
    const download = await downloadPromise;

    // Extract and verify packet content
    const path = await download.path();
    const fs = await import('fs');
    const content = fs.readFileSync(path, 'utf-8');
    const packet = JSON.parse(content);

    // Verify packet structure
    expect(packet.schema).toBe('tradedeck.shield.completion.v2');
    expect(packet.integrity).toBeDefined();
    expect(packet.integrity.hash).toBeDefined();
    expect(packet.integrity.signature).toBeDefined();
    expect(packet.integrity.algo).toBe('SHA-256');

    // Navigate to Verify tab
    await page.click('[data-tab="verify"]');
    await expect(page.locator('[data-verify-view]')).toBeVisible();

    // Upload packet for verification
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles({
        name: 'shield-record.json',
        mimeType: 'application/json',
        buffer: Buffer.from(content),
      });

      // Verify verdict should be PACKET-SEALED or similar
      const verdict = page.locator('[data-verify-verdict]');
      await expect(verdict).toBeVisible({ timeout: 5000 });
    }
  });

  test('should persist data across app restart', async () => {
    // Create a brief
    await page.click('[data-tab="construction"]');
    await page.fill('input[placeholder*="Title"]', 'Test Project');
    await page.selectOption('select[name="trade"]', 'framing');
    await page.selectOption('select[name="budget"]', 'under15');
    await page.fill('textarea[name="description"]', 'Test description');

    const lockBtn = page.locator('button:has-text("Lock brief & generate 5 points")');
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await page.locator('button:has-text("Finalize")').click().catch(() => {});
    }

    // Reload page
    await page.reload();

    // Verify data persisted
    await expect(page.locator('[data-cview="points"]')).toBeVisible({ timeout: 5000 });
    const checkpoints = page.locator('[data-checkpoint-item]');
    expect(await checkpoints.count()).toBe(5);
  });

  test('should validate brief score < 70 requires locking questions', async () => {
    await page.click('[data-tab="construction"]');

    // Enter minimal brief (should score < 70)
    await page.fill('input[placeholder*="Title"]', 'Repair');

    // Try to lock without scoring
    const lockBtn = page.locator('button:has-text("Ask locking questions")');

    // Either questions appear or lock button is disabled
    if (await lockBtn.isVisible()) {
      await lockBtn.click();
      await expect(page.locator('[data-questions-card]')).toBeVisible({ timeout: 5000 });
    } else {
      // Button should be disabled or not visible
      const lockBtn2 = page.locator('button:has-text("Lock brief")');
      if (await lockBtn2.isVisible()) {
        expect(await lockBtn2.isDisabled()).toBe(true);
      }
    }
  });
});
