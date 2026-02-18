import { test, expect } from '@playwright/test';

test.describe('Messaging', () => {
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
    // Note: The URL pattern needs to be flexible as the query might change
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

    // Mock messages (Step 5 & 6 & ChatView)
    const messages = [
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

    await page.route('**/rest/v1/messages*', async route => {
      const method = route.request().method();
      const url = route.request().url();
      
      if (method === 'POST') {
         const postData = route.request().postDataJSON();
         const newMsg = {
            ...postData,
            id: 'msg-new-' + Date.now(),
            created_at: new Date().toISOString(),
            status: 'sent'
         };
         messages.push(newMsg);
         await route.fulfill({ json: [newMsg] });
         return;
      }
      
      // Pinned message query
      if (url.includes('is_pinned=eq.true')) {
         await route.fulfill({ json: [] }); // No pinned messages
         return;
      }
      
      // Unread count query (select=conversation_id)
      if (url.includes('select=conversation_id')) {
         await route.fulfill({ json: [] }); // No unread messages
         return;
      }
      
      // Chat view messages or last message - filter by conversation if specified
      if (url.includes('conversation_id=eq.conv-1') || url.includes('conversation_id=in.%28conv-1%29')) {
         await route.fulfill({ json: messages });
         return;
      }
      
      await route.fulfill({ json: messages });
    });

    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
  });

  test('should open a chat and send a message', async ({ page }) => {
    // Wait for loading to finish
    await expect(page.locator('.animate-pulse')).toHaveCount(0);

    // Click on the conversation with Alice
    await page.getByText('Alice').click();
    
    // Check if we are in the chat view
    await expect(page).toHaveURL(/\/chat\/conv-1/);
    
    // Wait for messages to load
    await page.waitForLoadState('networkidle');
    
    // Check if previous message is visible
    await expect(page.getByText('Hello there!').first()).toBeVisible();
    
    // Type a new message
    const input = page.getByPlaceholder('Taper un message');
    await input.fill('General Kenobi!');
    
    // Send the message
    await page.locator('button[type="submit"]').click();
    
    // Wait for the POST request to finish
    await page.waitForResponse(resp => resp.url().includes('/messages') && resp.request().method() === 'POST');

    // Reload to fetch the new message (since we can't mock realtime easily)
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Verify the message appears in the list
    await expect(page.getByText('General Kenobi!')).toBeVisible();
  });
});
