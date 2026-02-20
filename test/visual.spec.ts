import { test, expect } from '@playwright/test';

test.describe('Visual Regression - Auth Page', () => {
  test('should match auth page screenshot', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
    
    // Screenshot for visual regression
    await expect(page).toHaveScreenshot('auth-page.png', { 
      maxDiffPixelRatio: 0.1 
    });
  });

  test('should match signup mode screenshot', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Inscription' }).click();
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    
    await expect(page).toHaveScreenshot('auth-signup.png', { 
      maxDiffPixelRatio: 0.1 
    });
  });

  test('should match guest mode screenshot', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Éphémère' }).click();
    await expect(page.getByRole('heading', { name: 'Mode éphémère' })).toBeVisible();
    
    await expect(page).toHaveScreenshot('auth-guest.png', { 
      maxDiffPixelRatio: 0.1 
    });
  });
});

test.describe('Visual Regression - Chats Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nephtys-auth', JSON.stringify({
        access_token: 'fake-token',
        refresh_token: 'fake-refresh',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: { id: 'test-user', email: 'test@example.com' }
      }));
    });
  });

  test('should match chats page screenshot', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('chats-page.png', { 
      maxDiffPixelRatio: 0.15 
    });
  });
});

test.describe('Visual Regression - Mobile', () => {
  test('should match mobile auth page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
    
    await expect(page).toHaveScreenshot('auth-mobile.png', { 
      maxDiffPixelRatio: 0.1 
    });
  });

  test('should match tablet auth page', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/auth');
    await expect(page.locator('body')).toBeVisible();
    
    await expect(page).toHaveScreenshot('auth-tablet.png', { 
      maxDiffPixelRatio: 0.1 
    });
  });
});

test.describe('Visual Regression - Dark Mode', () => {
  test('should match dark mode auth page', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
    });
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('auth-dark.png', { 
      maxDiffPixelRatio: 0.1 
    });
  });
});
