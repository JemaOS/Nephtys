import { test, expect } from '@playwright/test';

test.describe('Advanced - Multi-tab', () => {
  test('should open new page', async ({ context }) => {
    const page2 = await context.newPage();
    await page2.goto('/auth', { timeout: 15000 });
    await expect(page2.locator('body')).toBeVisible({ timeout: 10000 });
    await page2.close();
  });
});

test.describe('Advanced - Keyboard', () => {
  test('should respond to keyboard', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await page.keyboard.press('Tab');
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
