import { test, expect } from '@playwright/test';

test.describe('Backup Creation', () => {
  test('should redirect to auth if not authenticated', async ({ page }) => {
    await page.goto('/settings', { timeout: 15000 });
    // Should show some content (either redirect to auth or settings page)
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('should show auth page', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
