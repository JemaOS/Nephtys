import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

// Warm-up : force Vite à transformer tous les bundles (évite la latence de
// démarrage à froid qui faisait échouer le 1er essai).
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const path of ['/auth', '/private', '/chats', '/chat/conv-1', '/contacts', '/settings', '/calls', '/archived', '/groups/new']) {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  }
  await page.close();
});

test.describe('QA', () => {
  test('auth : bascule des modes + lien mode privé', async ({ page }) => {
    await page.goto('/auth', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Inscription' }).click();
    await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Éphémère' }).click();
    await expect(page.getByRole('heading', { name: 'Mode éphémère' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /mode privé/i })).toBeVisible({ timeout: 10000 });
  });

  test('routes : chargement sans erreur JS', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const path of ['/auth', '/private', '/chats', '/contacts', '/calls', '/settings', '/archived', '/groups/new']) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    }
    expect(errors, `Erreurs JS:\n${errors.join('\n')}`).toEqual([]);
  });

  test('mode privé : conversation réelle entre 2 navigateurs via le relais', async ({ browser }) => {
    const alice = await (await browser.newContext()).newPage();
    const bob = await (await browser.newContext()).newPage();

    await alice.goto('/private', { timeout: 60000 });
    await alice.getByRole('button', { name: /Créer une connexion privée/i }).click();
    await expect(alice.getByRole('button', { name: /Copier/i })).toBeVisible({ timeout: 30000 });
    const link = await alice.locator('input[readonly]').first().inputValue();
    expect(link.length).toBeGreaterThan(20);

    await bob.goto('/private', { timeout: 60000 });
    await bob.getByPlaceholder(/Collez ici le lien/i).fill(link);
    await bob.getByRole('button', { name: 'Rejoindre' }).click();
    await expect(bob.getByPlaceholder(/Message privé chiffré/i)).toBeVisible({ timeout: 20000 });

    await bob.getByPlaceholder(/Message privé chiffré/i).fill('bonjour Alice');
    await bob.getByRole('button', { name: 'Envoyer' }).click();
    await expect(alice.getByText('bonjour Alice')).toBeVisible({ timeout: 20000 });

    await alice.getByPlaceholder(/Message privé chiffré/i).fill('bonjour Bob');
    await alice.getByRole('button', { name: 'Envoyer' }).click();
    await expect(bob.getByText('bonjour Bob')).toBeVisible({ timeout: 20000 });
  });

  test('messagerie : ouvrir une conversation + envoyer (régression)', async ({ page }) => {
    // Auth simulée + Supabase mocké (comme les tests existants).
    await page.route('**/auth/v1/user', r => r.fulfill({ json: { id: 'test-user-id', aud: 'authenticated', role: 'authenticated', email: 't@e.fr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }));
    await page.addInitScript(() => {
      const user = { id: 'test-user-id', aud: 'authenticated', role: 'authenticated', email: 't@e.fr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      localStorage.setItem('nephtys-auth', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }));
      localStorage.setItem('anu_cached_user', JSON.stringify(user));
      localStorage.setItem('anu_cached_profile', JSON.stringify({ id: 'test-user-id', username: 'testuser', display_name: 'Test', avatar_url: null }));
    });
    await page.route('**/rest/v1/conversation_members?*user_id=eq.test-user-id*', r => r.fulfill({ json: [{ conversation_id: 'conv-1', is_pinned: false, is_muted: false, is_archived: false }] }));
    await page.route('**/rest/v1/conversations*', r => r.fulfill({ json: [{ id: 'conv-1', type: 'direct', name: 'Alice', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() }] }));
    await page.route('**/rest/v1/conversation_members*conversation_id=in*', r => r.fulfill({ json: [{ conversation_id: 'conv-1', user_id: 'test-user-id' }, { conversation_id: 'conv-1', user_id: 'alice-id' }] }));
    await page.route('**/rest/v1/profiles*', r => r.fulfill({ json: [{ id: 'alice-id', username: 'alice', display_name: 'Alice', avatar_url: null }] }));

    const posts: any[] = [];
    await page.route('**/rest/v1/messages*', async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        posts.push(body);
        await route.fulfill({ json: [{ ...body, id: 'msg-new', created_at: new Date().toISOString(), status: 'sent' }] });
        return;
      }
      const url = route.request().url();
      if (url.includes('is_pinned=eq.true')) return route.fulfill({ json: [] });
      if (url.includes('select=conversation_id')) return route.fulfill({ json: [] });
      await route.fulfill({ json: [{ id: 'msg-1', conversation_id: 'conv-1', sender_id: 'alice-id', content: 'Hello', created_at: new Date(Date.now() - 60000).toISOString(), type: 'text', status: 'read' }] });
    });

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/chats', { timeout: 60000 });
    await page.getByText('Alice').first().click();
    await expect(page).toHaveURL(/\/chat\/conv-1/, { timeout: 20000 });

    const input = page.getByPlaceholder('Taper un message');
    await expect(input).toBeVisible({ timeout: 20000 });
    await input.fill('message de test QA');
    await input.press('Enter');

    // L'insert doit partir (preuve que l'envoi n'est pas cassé).
    await expect.poll(() => posts.length, { timeout: 30000 }).toBeGreaterThan(0);
    expect(posts[0].conversation_id).toBe('conv-1');
    expect(String(posts[0].content)).toBeTruthy();
    expect(errors, `Erreurs JS:\n${errors.join('\n')}`).toEqual([]);
  });

  test('pages connectées : rendu sans erreur JS', async ({ page }) => {
    await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
    await page.addInitScript(() => {
      const user = { id: 'test-user-id', aud: 'authenticated', role: 'authenticated', email: 't@e.fr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      localStorage.setItem('nephtys-auth', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }));
      localStorage.setItem('anu_cached_user', JSON.stringify(user));
      localStorage.setItem('anu_cached_profile', JSON.stringify({ id: 'test-user-id', username: 'testuser', display_name: 'Test', avatar_url: null }));
    });
    await page.route('**/rest/v1/**', async route => {
      if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
      return route.fulfill({ json: [] });
    });

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const path of ['/chats', '/contacts', '/settings', '/calls', '/archived', '/groups/new']) {
      await page.goto(BASE + path, { waitUntil: 'load', timeout: 60000 }).catch(() => undefined);
      await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    }
    expect(errors, `Erreurs JS:\n${errors.join('\n')}`).toEqual([]);
  });
});

