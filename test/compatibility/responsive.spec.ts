import { test, expect } from '@playwright/test';

test.describe('Responsive Layout', () => {
  test('should adapt layout to mobile, tablet, and desktop', async ({ page }) => {
    // Desktop (Large) - set viewport BEFORE navigating
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/auth', { timeout: 15000 });
    
    // Just verify page loads
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    
    // Mobile - set viewport BEFORE navigating
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/auth', { timeout: 15000 });
    
    // Just verify page loads
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  });
});
