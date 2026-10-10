import { describe, it, expect } from 'vitest';
import {
  encodeStatus,
  parseStatus,
  isExpired,
  activeStatuses,
  toRecord,
  STATUS_TTL_MS,
  type StatusRecord,
} from './statusStore';

describe('statusStore (statuts privés)', () => {
  it('encode/parse un statut', () => {
    const encoded = encodeStatus('bonjour tout le monde', 'id1');
    const payload = parseStatus(encoded);
    expect(payload?.text).toBe('bonjour tout le monde');
    expect(payload?.id).toBe('id1');
    expect(parseStatus('texte normal')).toBeNull();
    expect(parseStatus('\u0000NPT-STATUS:pas-du-json')).toBeNull();
  });

  it('expiration à 24 h', () => {
    const now = 1_000_000;
    const rec = toRecord({ id: 's1', text: 'x', ts: now }, 'conv', now);
    expect(rec.expiresAt).toBe(now + STATUS_TTL_MS);
    expect(isExpired(rec, now + 1000)).toBe(false);
    expect(isExpired(rec, now + STATUS_TTL_MS + 1)).toBe(true);
  });

  it('activeStatuses filtre les expirés et trie du plus récent', () => {
    const now = 10_000;
    const list: StatusRecord[] = [
      { id: 'a', conversationId: 'c', text: 'vieux', ts: 1, expiresAt: now - 1 },
      { id: 'b', conversationId: 'c', text: 'recent', ts: 5, expiresAt: now + 10 },
      { id: 'd', conversationId: 'c', text: 'plus recent', ts: 9, expiresAt: now + 10 },
    ];
    expect(activeStatuses(list, now).map(s => s.id)).toEqual(['d', 'b']);
  });
});
