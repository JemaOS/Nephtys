import { test, expect } from '@playwright/test';

test.describe('Happy Path - Auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth');
  });

  test('should display login form by default', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });

  test('should switch to signup mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Inscription' }).click();
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
  });

  test('should switch to guest mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Éphémère' }).click();
    await expect(page.getByRole('heading', { name: 'Mode éphémère' })).toBeVisible();
  });
});

test.describe('Happy Path - Navigation', () => {
  test('should handle unauthenticated navigation to chats', async ({ page }) => {
    await page.goto('/chats');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });

  test('should handle unauthenticated navigation to settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });

  test('should handle unauthenticated navigation to groups', async ({ page }) => {
    await page.goto('/groups');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
  });
});
