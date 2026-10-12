import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase : `supabaseAnon` (client anonyme sans session, défaut du relais)
// et `supabase` (client AVEC session, utilisé pour le garde-fou rétro-compat).
const { rpc, anonRpc } = vi.hoisted(() => ({ rpc: vi.fn(), anonRpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => rpc(...args),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  },
  supabaseAnon: {
    rpc: (...args: any[]) => anonRpc(...args),
    // Client anonyme : AUCUNE session persistée.
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { SupabaseRelayWire, SUPABASE_RELAY_ID, type SupabaseRelayClient } from './supabaseRelayWire';

beforeEach(() => {
  // Consentement d'usage de la session connectée : OFF par défaut.
  localStorage.clear();
  rpc.mockReset();
  anonRpc.mockReset();
});

describe('SupabaseRelayWire (relais aveugle sur Supabase)', () => {
  it('utilise par défaut le client ANONYME (sans session) pour toutes les RPC', async () => {
    const wire = new SupabaseRelayWire();

    anonRpc.mockResolvedValueOnce({ data: { queueId: 'q1', sendToken: 's1', rcvToken: 'r1' }, error: null });
    const created = await wire.request({ op: 'createQueue' });

    expect(anonRpc).toHaveBeenCalledWith('anon_queue_create');
    expect(rpc).not.toHaveBeenCalled();
    expect(created.ok).toBe(true);
    expect(created.result).toEqual({
      queueId: 'q1',
      sendKey: 's1',
      rcvKey: 'r1',
      relay: SUPABASE_RELAY_ID,
    });
  });

  it('mappe chaque opération sur la bonne RPC (client anon)', async () => {
    const wire = new SupabaseRelayWire();
    anonRpc.mockReset();

    // createQueue
    anonRpc.mockResolvedValueOnce({ data: { queueId: 'q1', sendToken: 's1', rcvToken: 'r1' }, error: null });
    const created = await wire.request({ op: 'createQueue' });
    expect(anonRpc).toHaveBeenCalledWith('anon_queue_create');
    expect(created.ok).toBe(true);
    expect(created.result).toEqual({
      queueId: 'q1',
      sendKey: 's1',
      rcvKey: 'r1',
      relay: SUPABASE_RELAY_ID,
    });

    // send
    anonRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const sent = await wire.request({ op: 'send', queueId: 'q1', queueKey: 's1', ciphertext: 'ct' });
    expect(anonRpc).toHaveBeenLastCalledWith('anon_queue_send', {
      p_queue_id: 'q1',
      p_send_token: 's1',
      p_ciphertext: 'ct',
    });
    expect(sent.ok).toBe(true);

    // read
    anonRpc.mockResolvedValueOnce({ data: { messages: [{ id: 'm1', ciphertext: 'ct', ts: 123 }] }, error: null });
    const read = await wire.request({ op: 'read', queueId: 'q1', queueKey: 'r1' });
    expect(read.ok).toBe(true);
    expect((read.result as any[])[0]).toMatchObject({ id: 'm1', ciphertext: 'ct', ts: 123 });

    // ack
    anonRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const ack = await wire.request({ op: 'ack', queueId: 'q1', queueKey: 'r1', ids: ['m1'] });
    expect(anonRpc).toHaveBeenLastCalledWith('anon_queue_ack', {
      p_queue_id: 'q1',
      p_rcv_token: 'r1',
      p_ids: ['m1'],
    });
    expect(ack.ok).toBe(true);

    // delete
    anonRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const del = await wire.request({ op: 'delete', queueId: 'q1', queueKey: 'r1' });
    expect(anonRpc).toHaveBeenLastCalledWith('anon_queue_delete', {
      p_queue_id: 'q1',
      p_rcv_token: 'r1',
    });
    expect(del.ok).toBe(true);
  });

  it('renvoie ok:false en cas d’erreur RPC', async () => {
    const wire = new SupabaseRelayWire();
    anonRpc.mockResolvedValueOnce({ data: null, error: { message: 'unauthorized' } });
    const res = await wire.request({ op: 'send', queueId: 'q', queueKey: 's', ciphertext: 'x' });
    expect(res.ok).toBe(false);
  });

  it('garde-fou rétro-compat : refuse un client AVEC session connectée (AUTH_DENIED)', async () => {
    const sessionClient: SupabaseRelayClient = {
      rpc: vi.fn(),
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    };
    const wire = new SupabaseRelayWire({ client: sessionClient });

    const res = await wire.request({ op: 'createQueue' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/refusé/);
    expect(sessionClient.rpc).not.toHaveBeenCalled();
  });

  it('autorise un client AVEC session si le consentement explicite est donné', async () => {
    const sessionRpc = vi.fn().mockResolvedValue({
      data: { queueId: 'q', sendToken: 's', rcvToken: 'r' },
      error: null,
    });
    const sessionClient: SupabaseRelayClient = {
      rpc: sessionRpc,
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    };
    const wire = new SupabaseRelayWire({ client: sessionClient, allowAuthenticatedSession: true });

    const res = await wire.request({ op: 'createQueue' });
    expect(res.ok).toBe(true);
    expect(sessionRpc).toHaveBeenCalledWith('anon_queue_create');
  });

  it('expose le tag de relais hôte pour le routage par file', () => {
    const wire = new SupabaseRelayWire();
    expect(wire.relayIds).toEqual([SUPABASE_RELAY_ID]);
  });
});
