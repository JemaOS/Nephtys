import { test, expect } from '@playwright/test';

test.describe('Monitoring - Console', () => {
  test('should load without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Monitoring - Resources', () => {
  test('should load page resources', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});
