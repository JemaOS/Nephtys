import { describe, it, expect, vi } from 'vitest';

// Mock Supabase : on capture les appels RPC.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: any[]) => rpc(...args) } }));

import { SupabaseRelayWire } from './supabaseRelayWire';

describe('SupabaseRelayWire (relais aveugle sur Supabase)', () => {
  it('mappe chaque opération sur la bonne RPC', async () => {
    const wire = new SupabaseRelayWire();
    rpc.mockReset();

    // createQueue
    rpc.mockResolvedValueOnce({ data: { queueId: 'q1', sendToken: 's1', rcvToken: 'r1' }, error: null });
    const created = await wire.request({ op: 'createQueue' });
    expect(rpc).toHaveBeenCalledWith('anon_queue_create');
    expect(created.ok).toBe(true);
    expect(created.result).toEqual({ queueId: 'q1', sendKey: 's1', rcvKey: 'r1' });

    // send
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const sent = await wire.request({ op: 'send', queueId: 'q1', queueKey: 's1', ciphertext: 'ct' });
    expect(rpc).toHaveBeenLastCalledWith('anon_queue_send', {
      p_queue_id: 'q1',
      p_send_token: 's1',
      p_ciphertext: 'ct',
    });
    expect(sent.ok).toBe(true);

    // read
    rpc.mockResolvedValueOnce({ data: { messages: [{ id: 'm1', ciphertext: 'ct', ts: 123 }] }, error: null });
    const read = await wire.request({ op: 'read', queueId: 'q1', queueKey: 'r1' });
    expect(read.ok).toBe(true);
    expect((read.result as any[])[0]).toMatchObject({ id: 'm1', ciphertext: 'ct', ts: 123 });

    // ack
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const ack = await wire.request({ op: 'ack', queueId: 'q1', queueKey: 'r1', ids: ['m1'] });
    expect(rpc).toHaveBeenLastCalledWith('anon_queue_ack', {
      p_queue_id: 'q1',
      p_rcv_token: 'r1',
      p_ids: ['m1'],
    });
    expect(ack.ok).toBe(true);

    // delete
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const del = await wire.request({ op: 'delete', queueId: 'q1', queueKey: 'r1' });
    expect(rpc).toHaveBeenLastCalledWith('anon_queue_delete', {
      p_queue_id: 'q1',
      p_rcv_token: 'r1',
    });
    expect(del.ok).toBe(true);
  });

  it('renvoie ok:false en cas d’erreur RPC', async () => {
    const wire = new SupabaseRelayWire();
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'unauthorized' } });
    const res = await wire.request({ op: 'send', queueId: 'q', queueKey: 's', ciphertext: 'x' });
    expect(res.ok).toBe(false);
  });
});
