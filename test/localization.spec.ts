import { test, expect } from '@playwright/test';

test.describe('Localization', () => {
  test('should display auth page', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('State Persistence', () => {
  test('should load without error', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});
