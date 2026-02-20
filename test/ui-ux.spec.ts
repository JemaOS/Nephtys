import { test, expect } from '@playwright/test';

test.describe('UI/UX - Responsive', () => {
  test('should load on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('UI/UX - Visual', () => {
  test('should display content properly', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});
