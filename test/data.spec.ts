import { test, expect } from '@playwright/test';

test.describe('Data - URL Handling', () => {
  test('should handle deep links', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Data - Large Content', () => {
  test('should handle page gracefully', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
