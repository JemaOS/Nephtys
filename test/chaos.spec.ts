import { test, expect } from '@playwright/test';

test.describe('Chaos - Error Handling', () => {
  test('should handle rapid navigation', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await page.goto('/auth', { timeout: 15000 });
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('should handle page reload', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await page.reload({ timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
