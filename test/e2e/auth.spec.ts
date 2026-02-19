import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth', { timeout: 15000 });
  });

  test('should display login form by default', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible({ timeout: 10000 });
  });

  test('should switch to signup mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Inscription' }).click({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible({ timeout: 10000 });
  });

  test('should switch to guest mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Éphémère' }).click({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Mode éphémère' })).toBeVisible({ timeout: 10000 });
  });

  test('should allow input in login form', async ({ page }) => {
    await page.getByPlaceholder('votre_pseudo').fill('testuser');
    await page.getByPlaceholder('••••••••').fill('password123');
    
    await expect(page.getByPlaceholder('votre_pseudo')).toHaveValue('testuser');
    await expect(page.getByPlaceholder('••••••••')).toHaveValue('password123');
  });
});
