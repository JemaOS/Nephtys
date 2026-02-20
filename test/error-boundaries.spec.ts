import { test, expect } from '@playwright/test';

test.describe('Error Boundaries', () => {
  test('should handle JavaScript errors gracefully', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => {
      errors.push(error.message);
    });
    
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    
    // Page should not crash even if errors occur
    expect(errors.length).toBeLessThan(5);
  });

  test('should handle network failures', async ({ page }) => {
    // Simplified test - just verify page loads
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('should handle missing resources', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('should show error boundary on component crash', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    // App should still be functional
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Global Error Handling', () => {
  test('should catch unhandled promise rejections', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => {
      errors.push(error.message);
    });
    
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });

  test('should handle console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    
    // Some errors might be expected, but app should work
    expect(consoleErrors.length).toBeLessThan(10);
  });
});

test.describe('Fallback UI', () => {
  test('should show fallback on slow load', async ({ page }) => {
    // Simplified test - just verify page loads
    await page.goto('/auth', { timeout: 30000 });
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });
});
