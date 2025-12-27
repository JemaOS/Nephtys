import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Supabase Auth User request
    await page.route('**/auth/v1/user', async route => {
      await route.fulfill({
        json: {
          id: 'test-user-id',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'test@example.com',
          phone: '',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      });
    });

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

    // Mock conversation_members for current user (Step 1)
    await page.route('**/rest/v1/conversation_members*user_id=eq.test-user-id*', async route => {
       const json = [
        { conversation_id: 'conv-1', is_pinned: false, is_muted: false, is_archived: false }
       ];
       await route.fulfill({ json });
    });

    // Mock conversations (Step 2)
    await page.route('**/rest/v1/conversations*', async route => {
      const json = [
        {
          id: 'conv-1',
          type: 'direct',
          name: 'Alice',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
        }
      ];
      await route.fulfill({ json });
    });

    // Mock conversation_members for the conversation (Step 3)
    await page.route('**/rest/v1/conversation_members*conversation_id=in.%28conv-1%29*', async route => {
       const json = [
        { conversation_id: 'conv-1', user_id: 'test-user-id' },
        { conversation_id: 'conv-1', user_id: 'alice-id' }
       ];
       await route.fulfill({ json });
    });
    
    // Mock profiles (Step 4)
    await page.route('**/rest/v1/profiles*', async route => {
        const json = [{
            id: 'alice-id',
            username: 'alice',
            display_name: 'Alice',
            avatar_url: null
        }];
        await route.fulfill({ json });
    });

    // Mock messages (Step 5 & 6)
    await page.route('**/rest/v1/messages*', async route => {
      const url = route.request().url();
      
      // Pinned message query
      if (url.includes('is_pinned=eq.true')) {
         await route.fulfill({ json: [] });
         return;
      }
      
      // Unread count query (select=conversation_id)
      if (url.includes('select=conversation_id')) {
         await route.fulfill({ json: [] });
         return;
      }
      
      // Last message query
      const json = [
          {
            id: 'msg-1',
            conversation_id: 'conv-1',
            sender_id: 'alice-id',
            content: 'Hello there!',
            created_at: new Date(Date.now() - 60000).toISOString(),
            type: 'text',
            status: 'read'
          }
        ];
      await route.fulfill({ json });
    });

    await page.goto('/chats');
  });

  test('should navigate to Calls page', async ({ page }) => {
    // Check if we are on chats page first
    await expect(page).toHaveURL(/\/chats/);
    
    // Click on Calls link (using title attribute for Sidebar or text for MobileBottomNav)
    // We try to find by title first (Desktop) then by text (Mobile)
    const callsButton = page.locator('button[title="Appels"], button:has-text("Appels")').first();
    await callsButton.click({ force: true });
    
    await expect(page).toHaveURL(/\/calls/);
  });

  test('should navigate to Settings page', async ({ page }) => {
    const settingsButton = page.locator('button[title="Paramètres"], button:has-text("Paramètres")').first();
    await settingsButton.click({ force: true });
    
    await expect(page).toHaveURL(/\/settings/);
  });

  test('should navigate back to Chats page', async ({ page }) => {
    await page.goto('/settings');
    const chatsButton = page.locator('button[title="Discussions"], button:has-text("Discussions")').first();
    await chatsButton.click({ force: true });
    
    await expect(page).toHaveURL(/\/chats/);
  });
});
