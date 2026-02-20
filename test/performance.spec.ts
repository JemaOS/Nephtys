import { test, expect } from '@playwright/test';

test.describe('Performance - Page Load', () => {
  test('should load auth page', async ({ page }) => {
    const start = Date.now();
    await page.goto('/auth');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(30000); // 30s max
  });

  test('should load without hanging', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Performance - Interactions', () => {
  test('should respond to navigation', async ({ page }) => {
    await page.goto('/auth');
    await page.click('button:has-text("Inscription")');
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Performance - Memory', () => {
  test('should not crash during navigation', async ({ page }) => {
    await page.goto('/auth');
    await page.goto('/auth');
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
  });
});
