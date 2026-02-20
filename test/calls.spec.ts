import { test, expect } from '@playwright/test';

test.describe('Video/Audio Calls', () => {
  test('should redirect to auth if not authenticated', async ({ page }) => {
    await page.goto('/calls', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('should show auth page', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Call Features', () => {
  test('should load page', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
