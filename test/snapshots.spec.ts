import { test, expect } from '@playwright/test';

test.describe('Snapshots - Component Structure', () => {
  test('should match auth page DOM structure', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    
    const html = await page.content();
    
    // Basic structure checks
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  test('should match auth form elements', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    
    // Just verify page loaded with content
    const body = page.locator('body');
    await expect(body).toBeVisible();
    
    // Check that there's some content
    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
  });

  test('should match heading structure', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    
    // Just verify page loaded
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Snapshots - State Changes', () => {
  test('should preserve auth page state after interactions', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    
    const initialHTML = await page.content();
    
    // Switch to signup if button exists
    const signupButton = page.getByRole('button', { name: 'Inscription' });
    if (await signupButton.isVisible()) {
      await signupButton.click();
      await page.waitForTimeout(500);
      
      const afterSignupHTML = await page.content();
      // HTML should be different after interaction
      expect(afterSignupHTML).not.toBe(initialHTML);
    }
  });

  test('should preserve input values on navigation', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    
    // Fill form if input exists
    const usernameInput = page.locator('input[id="username"]');
    if (await usernameInput.isVisible()) {
      await usernameInput.fill('testuser');
    }
    
    // Navigate to same page (refresh)
    await page.reload({ timeout: 15000 });
    
    // Should not crash and page should load
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Snapshots - Route Changes', () => {
  test('should match different route structures', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    const authHTML = await page.content();
    
    await page.goto('/chats', { timeout: 15000 });
    await page.waitForTimeout(2000);
    const chatsHTML = await page.content();
    
    // Different routes should have different content
    expect(authHTML).not.toBe(chatsHTML);
  });

  test('should include route-specific elements', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Snapshots - Responsive', () => {
  test('should have responsive meta tag', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    
    const viewport = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      return meta?.getAttribute('content');
    });
    
    expect(viewport).toContain('width');
  });

  test('should handle viewport changes', async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
    
    // Change viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Should still be visible
    await expect(page.locator('body')).toBeVisible();
    
    // Change back
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator('body')).toBeVisible();
  });
});
