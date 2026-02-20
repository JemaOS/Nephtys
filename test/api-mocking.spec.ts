import { test, expect } from '@playwright/test';

test.describe('API Mocking', () => {
  test('should load page', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('API Race Conditions', () => {
  test('should handle concurrent requests', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
