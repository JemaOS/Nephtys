import { test, expect } from '@playwright/test';

test.describe('Media', () => {
  test('should load auth page', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});
