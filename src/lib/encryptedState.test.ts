import { describe, it, expect, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (...args: any[]) => from(...args) } }));

import {
  putEncryptedState,
  getEncryptedState,
  listEncryptedStateKeys,
  deleteEncryptedState,
} from './encryptedState';

/** Chaîne Supabase « thenable » dont chaque méthode renvoie la chaîne. */
function makeChain(result: unknown) {
  const chain: any = {
    upsert: () => chain,
    select: () => chain,
    eq: () => chain,
    delete: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (onF: any, onR: any) => Promise.resolve(result).then(onF, onR),
  };
  return chain;
}

describe('encryptedState (P4)', () => {
  it('put → upsert dans user_encrypted_state', async () => {
    from.mockReset();
    from.mockReturnValue(makeChain({ data: null, error: null }));
    await putEncryptedState('u1', 'keys', 'blob');
    expect(from).toHaveBeenCalledWith('user_encrypted_state');
  });

  it('get → renvoie le blob', async () => {
    from.mockReturnValue(makeChain({ data: { blob: 'B' }, error: null }));
    expect(await getEncryptedState('u1', 'keys')).toBe('B');
  });

  it('get → null si absent', async () => {
    from.mockReturnValue(makeChain({ data: null, error: null }));
    expect(await getEncryptedState('u1', 'keys')).toBeNull();
  });

  it('list → renvoie les clés', async () => {
    from.mockReturnValue(makeChain({ data: [{ key: 'a' }, { key: 'b' }], error: null }));
    expect(await listEncryptedStateKeys('u1')).toEqual(['a', 'b']);
  });

  it('put → lève une erreur si la RPC échoue', async () => {
    from.mockReturnValue(makeChain({ data: null, error: { message: 'boom' } }));
    await expect(putEncryptedState('u1', 'k', 'b')).rejects.toThrow(/encryptedState\.put/);
  });

  it('delete → ne lève pas', async () => {
    from.mockReturnValue(makeChain({ data: null, error: null }));
    await expect(deleteEncryptedState('u1', 'k')).resolves.toBeUndefined();
  });
});
