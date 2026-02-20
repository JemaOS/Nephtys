import { test, expect } from '@playwright/test';

test.describe('Offline Mode', () => {
  test('should load auth page', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Network', () => {
  test('should handle page navigation', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});
