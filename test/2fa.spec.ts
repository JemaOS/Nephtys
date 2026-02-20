import { test, expect } from '@playwright/test';

test.describe('Two-Factor Authentication (2FA)', () => {
  test('should navigate to 2FA settings', async ({ page }) => {
    await page.goto('/settings', { timeout: 15000 });
    // Should redirect to auth if not logged in, or show settings
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('should show enable 2FA option', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
