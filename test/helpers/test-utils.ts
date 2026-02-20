// Test utilities and helpers for Playwright tests
import { Page, Locator, expect } from '@playwright/test';

// Mock data helpers
export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  username: 'testuser',
  display_name: 'Test User',
};

export const mockSession = {
  access_token: 'fake-access-token',
  refresh_token: 'fake-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: mockUser,
};

export const mockConversations = [
  { id: 'conv-1', type: 'direct', name: 'Alice', created_at: new Date().toISOString() },
  { id: 'conv-2', type: 'direct', name: 'Bob', created_at: new Date().toISOString() },
  { id: 'conv-3', type: 'group', name: 'Test Group', created_at: new Date().toISOString() },
];

export const mockMessages = [
  { id: 'msg-1', conversation_id: 'conv-1', sender_id: 'alice-id', content: 'Hello!', created_at: new Date().toISOString() },
  { id: 'msg-2', conversation_id: 'conv-1', sender_id: 'test-user-id', content: 'Hi there!', created_at: new Date().toISOString() },
];

// Auth helpers
export async function setupAuthenticatedSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('nephtys-auth', JSON.stringify({
      access_token: 'fake-access-token',
      refresh_token: 'fake-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      }
    }));
    localStorage.setItem('anu_cached_user', JSON.stringify({
      id: 'test-user-id',
      email: 'test@example.com',
    }));
    localStorage.setItem('anu_cached_profile', JSON.stringify({
      id: 'test-user-id',
      username: 'testuser',
      display_name: 'Test User',
      avatar_url: null,
    }));
  });
}

export async function mockApiRoutes(page: Page) {
  // Mock auth user
  await page.route('**/auth/v1/user', async route => {
    await route.fulfill({ json: { ...mockUser, aud: 'authenticated', role: 'authenticated' } });
  });

  // Mock conversations
  await page.route('**/rest/v1/conversations*', async route => {
    await route.fulfill({ json: mockConversations });
  });

  // Mock messages
  await page.route('**/rest/v1/messages*', async route => {
    await route.fulfill({ json: mockMessages });
  });
}

// UI Helpers
export async function waitForLoading(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.animate-pulse')).toHaveCount(0);
}

export async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true });
}

// Accessibility helpers
export async function checkA11y(page: Page) {
  // Check for basic accessibility issues
  const issues: string[] = [];
  
  // Check images have alt text
  const images = await page.locator('img').all();
  for (const img of images) {
    const alt = await img.getAttribute('alt');
    const ariaLabel = await img.getAttribute('aria-label');
    if (!alt && !ariaLabel) {
      issues.push('Image missing alt text');
    }
  }
  
  // Check buttons have labels
  const buttons = await page.locator('button').all();
  for (const btn of buttons) {
    const text = await btn.textContent();
    const ariaLabel = await btn.getAttribute('aria-label');
    if (!text?.trim() && !ariaLabel) {
      issues.push('Button missing accessible label');
    }
  }
  
  return issues;
}

// Performance helpers
export async function measurePageLoad(page: Page): Promise<number> {
  const start = Date.now();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  return Date.now() - start;
}

// State persistence helpers
export async function checkLocalStorage(page: Page, key: string) {
  const value = await page.evaluate((k) => localStorage.getItem(k), key);
  return value !== null;
}

// Network error injection helpers
export async function simulateNetworkError(page: Page, urlPattern: string) {
  await page.route(urlPattern, route => {
    route.abort('failed');
  });
}

// Slow network simulation
export async function simulateSlowNetwork(page: Page, delay: number = 5000) {
  await page.route('**/*', async route => {
    await new Promise(resolve => setTimeout(resolve, delay));
    await route.continue();
  });
}

// Offline mode helpers
export async function setOfflineMode(page: Page, offline: boolean) {
  await page.context().setOffline(offline);
}

// XSS prevention helpers
export async function checkForXSS(page: Page, payload: string): Promise<boolean> {
  await page.goto('/auth');
  await page.fill('input[id="username"]', payload);
  await page.click('button[type="submit"]');
  
  // Check if payload is executed as script
  const scripts = await page.evaluate(() => {
    return document.scripts.length;
  });
  
  return scripts > 0;
}

// Memory leak detection helpers
export async function measureMemory(page: Page): Promise<number> {
  return await page.evaluate(() => {
    // @ts-ignore
    if (performance.memory) {
      // @ts-ignore
      return performance.memory.usedJSHeapSize;
    }
    return 0;
  });
}

// Wait for element with timeout
export async function waitForElement(locator: Locator, timeout: number = 5000) {
  await locator.waitFor({ state: 'visible', timeout });
}

// Expect helpers
export { expect };
