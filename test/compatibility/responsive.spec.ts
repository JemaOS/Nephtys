import { test, expect } from '@playwright/test';

test.describe('Responsive Layout', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authenticated state in localStorage
    await page.addInitScript(() => {
      const user = {
        id: 'test-user-id',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'test@example.com',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
      
      const session = {
        access_token: 'fake-access-token',
        refresh_token: 'fake-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: user
      };

      localStorage.setItem('nephtys-auth', JSON.stringify(session));
      localStorage.setItem('anu_cached_user', JSON.stringify(user));
      localStorage.setItem('anu_cached_profile', JSON.stringify({
        id: 'test-user-id',
        username: 'testuser',
        display_name: 'Test User',
        avatar_url: null,
      }));
    });
    
    // Mock Supabase Auth User request to avoid redirect
    await page.route('**/auth/v1/user', async route => {
      await route.fulfill({
        json: {
          id: 'test-user-id',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'test@example.com',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      });
    });
  });

  test('should adapt layout to mobile, tablet, and desktop', async ({ page }) => {
    // Desktop (Large)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/chats'); // Go to a protected route
    
    // Sidebar should be visible on desktop
    // We look for the sidebar container which has class w-16 h-screen
    const sidebar = page.locator('.w-16.h-screen');
    await expect(sidebar).toBeVisible();

    // Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    // Sidebar should be hidden
    await expect(sidebar).toBeHidden();
    
    // Bottom Nav should be visible
    const bottomNav = page.locator('.fixed.bottom-0');
    await expect(bottomNav).toBeVisible();
  });
});
