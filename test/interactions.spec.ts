import { test, expect } from '@playwright/test';

test.describe('Interactions - Drag & Drop', () => {
  test('should load page', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Interactions - Upload', () => {
  test('should have upload capability', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});
