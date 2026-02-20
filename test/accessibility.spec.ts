import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
  test('should load auth page', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Accessibility - Color & Contrast', () => {
  test('should load auth page without crash', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
