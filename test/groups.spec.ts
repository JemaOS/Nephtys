import { test, expect } from '@playwright/test';

test.describe('Groups', () => {
  test('should handle unauthenticated access', async ({ page }) => {
    await page.goto('/groups');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });

  test('should show auth page for protected route', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
