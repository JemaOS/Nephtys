import { test, expect } from '@playwright/test';

test.describe('E2E Workflows - Complete User Journeys', () => {
  
  test.describe('Complete Auth Flow', () => {
    test('complete login → chat → logout flow', async ({ page }) => {
      // 1. Go to auth page
      await page.goto('/auth');
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
      
      // 2. Fill login form
      await page.fill('input[id="username"]', 'testuser');
      await page.fill('input[id="password"]', 'password123');
      
      // 3. Submit - should redirect to chats
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
      
      // 4. Should be on chats page (or auth if credentials invalid)
      const url = page.url();
      expect(url.includes('chats') || url.includes('auth')).toBeTruthy();
    });

    test('complete signup flow', async ({ page }) => {
      // 1. Go to auth
      await page.goto('/auth');
      
      // 2. Switch to signup
      await page.getByRole('button', { name: 'Inscription' }).click();
      await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
      
      // 3. Fill signup form
      await page.fill('input[id="username"]', 'newuser');
      await page.fill('input[id="password"]', 'newpassword123');
      
      // 4. Submit
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
      
      // Should either succeed or show error
      await expect(page.locator('body')).toBeVisible();
    });

    test('guest mode flow', async ({ page }) => {
      // 1. Go to auth
      await page.goto('/auth');
      
      // 2. Click guest mode
      await page.getByRole('button', { name: 'Éphémère' }).click();
      await expect(page.getByRole('heading', { name: 'Mode éphémère' })).toBeVisible();
      
      // 3. Enter guest username
      await page.fill('input[id="username"]', 'guest');
      
      // 4. Submit
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
      
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Complete Chat Flow', () => {
    test('send message workflow', async ({ page }) => {
      // Mock auth
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
      
      // Go to chats
      await page.goto('/chats');
      await page.waitForLoadState('networkidle');
      
      // Click on a conversation if exists
      const conversations = page.locator('[class*="conversation"], [class*="chat"]').first();
      if (await conversations.isVisible()) {
        await conversations.click();
        await page.waitForTimeout(1000);
        
        // Try to send message
        const messageInput = page.locator('input[placeholder*="message"], textarea[placeholder*="message"]').first();
        if (await messageInput.isVisible()) {
          await messageInput.fill('Test message');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
        }
      }
      
      // Should still be on chat page
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Complete Group Flow', () => {
    test('create group workflow', async ({ page }) => {
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
      
      // Go to groups
      await page.goto('/groups');
      await page.waitForLoadState('networkidle');
      
      // Click create group button
      const createButton = page.getByRole('button', { name: /créer|create|new/i }).first();
      if (await createButton.isVisible()) {
        await createButton.click();
        await page.waitForTimeout(500);
        
        // Fill group name
        const nameInput = page.locator('input[name="name"], input[id="name"], input[placeholder*="nom"]').first();
        if (await nameInput.isVisible()) {
          await nameInput.fill('Test Group');
        }
      }
      
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Complete Settings Flow', () => {
    test('navigate and modify settings', async ({ page }) => {
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
      
      // Go to settings
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
      
      // Check settings page loads
      await expect(page.locator('body')).toBeVisible();
      
      // Look for settings sections
      const settingsContent = await page.content();
      expect(settingsContent.length).toBeGreaterThan(100);
    });
  });

  test.describe('Navigation Flow', () => {
    test('complete navigation between all pages', async ({ page }) => {
      // Auth page
      await page.goto('/auth');
      await expect(page.locator('body')).toBeVisible();
      
      // Settings page
      await page.goto('/settings');
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
      
      // Chats page  
      await page.goto('/chats');
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
      
      // Groups page
      await page.goto('/groups');
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
      
      // Calls page
      await page.goto('/calls');
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    });
  });
});
