import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth');
  });

  test('should display login form by default', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await expect(page.getByPlaceholder('votre_pseudo')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('should switch to signup mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Inscription' }).click();
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Créer le compte' })).toBeVisible();
  });

  test('should switch to guest mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Éphémère' }).click();
    await expect(page.getByRole('heading', { name: 'Mode éphémère' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Démarrer en mode éphémère' })).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).not.toBeVisible();
  });

  test('should allow input in login form', async ({ page }) => {
    await page.getByPlaceholder('votre_pseudo').fill('testuser');
    await page.getByPlaceholder('••••••••').fill('password123');
    
    await expect(page.getByPlaceholder('votre_pseudo')).toHaveValue('testuser');
    await expect(page.getByPlaceholder('••••••••')).toHaveValue('password123');
  });
});
