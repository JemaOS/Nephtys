import { test, expect } from '@playwright/test';

test.describe('Appels Audio et Vidéo', () => {
  // On utilise deux contextes de navigateur différents pour simuler deux utilisateurs
  test('Appel audio entre deux utilisateurs', async ({ browser }) => {
    // Créer deux contextes avec les permissions nécessaires pour les appels
    const context1 = await browser.newContext({
      permissions: ['microphone'],
    });
    const context2 = await browser.newContext({
      permissions: ['microphone'],
    });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Utilisateur 1 se connecte
    await page1.goto('/auth');
    await page1.getByRole('button', { name: 'Éphémère' }).click();
    await page1.getByPlaceholder('votre_pseudo').fill('testuser1');
    await page1.click('button[type="submit"]');
    await page1.waitForURL('**/chats', { timeout: 15000 });

    // Utilisateur 2 se connecte
    await page2.goto('/auth');
    await page2.getByRole('button', { name: 'Éphémère' }).click();
    await page2.getByPlaceholder('votre_pseudo').fill('testuser2');
    await page2.click('button[type="submit"]');
    await page2.waitForURL('**/chats', { timeout: 15000 });

    // Utilisateur 1 va dans les contacts et appelle Utilisateur 2
    await page1.getByRole('button', { name: 'Contacts' }).click();
    await page1.getByRole('button', { name: 'Ajouter un contact' }).click();
    await page1.getByPlaceholder('pseudo_utilisateur').fill('testuser2');
    await page1.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page1.waitForURL('**/chat/*', { timeout: 30000 });
    // On suppose qu'il y a un bouton d'appel audio à côté du contact
    // Il faudra adapter le sélecteur en fonction de l'UI réelle
    await page1.click('button[aria-label="Appel vocal"]');

    // Utilisateur 2 devrait voir un écran d'appel entrant
    const incomingCallScreen = page2.locator('text=Appel entrant');
    await expect(incomingCallScreen).toBeVisible({ timeout: 10000 });

    // Utilisateur 2 accepte l'appel
    await page2.click('button[aria-label="Accepter"]');

    // Vérifier que l'appel est en cours sur les deux pages
    await expect(page1.locator('text=Appel en cours')).toBeVisible();
    await expect(page2.locator('text=Appel en cours')).toBeVisible();

    // Utilisateur 1 raccroche
    await page1.click('button[aria-label="Raccrocher"]');

    // Vérifier que l'appel est terminé
    await expect(page1.locator('text=Appel en cours')).not.toBeVisible();
    await expect(page2.locator('text=Appel en cours')).not.toBeVisible();

    await context1.close();
    await context2.close();
  });

  test('Appel vidéo entre deux utilisateurs', async ({ browser }) => {
    // Créer deux contextes avec les permissions nécessaires pour les appels
    const context1 = await browser.newContext({
      permissions: ['microphone', 'camera'],
    });
    const context2 = await browser.newContext({
      permissions: ['microphone', 'camera'],
    });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Utilisateur 1 se connecte
    await page1.goto('/auth');
    await page1.getByRole('button', { name: 'Éphémère' }).click();
    await page1.getByPlaceholder('votre_pseudo').fill('testuser1');
    await page1.click('button[type="submit"]');
    await page1.waitForURL('**/chats', { timeout: 15000 });

    // Utilisateur 2 se connecte
    await page2.goto('/auth');
    await page2.getByRole('button', { name: 'Éphémère' }).click();
    await page2.getByPlaceholder('votre_pseudo').fill('testuser2');
    await page2.click('button[type="submit"]');
    await page2.waitForURL('**/chats', { timeout: 15000 });

    // Utilisateur 1 va dans les contacts et appelle Utilisateur 2
    await page1.getByRole('button', { name: 'Contacts' }).click();
    await page1.getByRole('button', { name: 'Ajouter un contact' }).click();
    await page1.getByPlaceholder('pseudo_utilisateur').fill('testuser2');
    await page1.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page1.waitForURL('**/chat/*', { timeout: 30000 });
    // On suppose qu'il y a un bouton d'appel vidéo à côté du contact
    await page1.click('button[aria-label="Appel vidéo"]');

    // Utilisateur 2 devrait voir un écran d'appel entrant
    const incomingCallScreen = page2.locator('text=Appel vidéo entrant');
    await expect(incomingCallScreen).toBeVisible({ timeout: 10000 });

    // Utilisateur 2 accepte l'appel
    await page2.click('button[aria-label="Accepter"]');

    // Vérifier que l'appel est en cours sur les deux pages
    await expect(page1.locator('video')).toBeVisible();
    await expect(page2.locator('video')).toBeVisible();

    // Utilisateur 2 raccroche
    await page2.click('button[aria-label="Raccrocher"]');

    // Vérifier que l'appel est terminé
    await expect(page1.locator('video')).not.toBeVisible();
    await expect(page2.locator('video')).not.toBeVisible();

    await context1.close();
    await context2.close();
  });
});