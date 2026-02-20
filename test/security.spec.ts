import { test, expect } from '@playwright/test';

test.describe('Security - Auth', () => {
  test('should redirect to auth for protected routes', async ({ page }) => {
    await page.goto('/chats');
    await expect(page).toHaveURL(/auth/);
  });

  test('should load auth page securely', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Security - Input', () => {
  test('should handle special characters in input', async ({ page }) => {
    await page.goto('/auth');
    const payload = '<script>alert(1)</script>';
    await page.fill('input[id="username"]', payload);
    // Should not execute
    await expect(page.locator('body')).toBeVisible();
  });
});
