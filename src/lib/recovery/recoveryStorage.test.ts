import { describe, it, expect, beforeEach } from 'vitest';
import { storeRecoveryPhrase, getStoredRecoveryPhrase } from './recoveryService';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KEY = 'nephtys_recovery_phrase';

describe('stockage de la phrase de récupération', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('n’écrit JAMAIS la phrase en clair (chiffrement indisponible → rien)', async () => {
    await storeRecoveryPhrase(PHRASE);
    // IndexedDB indisponible en test → aucun repli en clair autorisé.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('purge une ancienne valeur en clair à la lecture', async () => {
    localStorage.setItem(KEY, PHRASE);
    const got = await getStoredRecoveryPhrase();
    expect(got).toBe(PHRASE);
    // La valeur en clair ne doit plus subsister.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('rejette et purge une valeur en clair invalide', async () => {
    localStorage.setItem(KEY, 'ceci n est pas une phrase bip39');
    expect(await getStoredRecoveryPhrase()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('renvoie null si rien n’est stocké', async () => {
    expect(await getStoredRecoveryPhrase()).toBeNull();
  });
});
