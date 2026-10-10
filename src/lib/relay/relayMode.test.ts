// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isTorRelayEnabled,
  setTorRelayEnabled,
  getOnionRelayUrl,
  setOnionRelayUrl,
  normalizeOnionWsUrl,
  getTorGatewayUrl,
  getTorRelayUrl,
  isTorAvailable,
} from './relayClient';

const V3 = 'a'.repeat(56) + '.onion';
const V2 = 'b'.repeat(16) + '.onion';

beforeEach(() => {
  localStorage.clear();
});

describe('normalizeOnionWsUrl', () => {
  it('accepte une adresse .onion nue', () => {
    expect(normalizeOnionWsUrl(V3)).toBe(`ws://${V3}`);
  });

  it('accepte un schéma http(s)/ws(s) et un chemin', () => {
    expect(normalizeOnionWsUrl(`https://${V2}/`)).toBe(`ws://${V2}/`);
    expect(normalizeOnionWsUrl(`wss://${V2}/relay`)).toBe(`ws://${V2}/relay`);
  });

  it('rejette une entrée non .onion ou vide', () => {
    expect(normalizeOnionWsUrl('example.com')).toBe('');
    expect(normalizeOnionWsUrl('')).toBe('');
    expect(normalizeOnionWsUrl('   ')).toBe('');
  });
});

describe('préférence Tor', () => {
  it('active/désactive et persiste la préférence (Tor implique .onion)', () => {
    expect(isTorRelayEnabled()).toBe(false);
    // Sans .onion, l'activation ne tient pas (auto-réparation) — pas de Tor sans onion.
    setTorRelayEnabled(true);
    expect(isTorRelayEnabled()).toBe(false);
    // Avec un .onion, l'activation persiste.
    setOnionRelayUrl(V3);
    setTorRelayEnabled(true);
    expect(isTorRelayEnabled()).toBe(true);
    setTorRelayEnabled(false);
    expect(isTorRelayEnabled()).toBe(false);
  });

  it('enregistre puis normalise l’adresse .onion', () => {
    setOnionRelayUrl(V3);
    expect(getOnionRelayUrl()).toBe(`ws://${V3}`);
  });

  it('efface l’adresse .onion quand la valeur est vide', () => {
    setOnionRelayUrl(V3);
    setOnionRelayUrl('');
    expect(getOnionRelayUrl()).toBe('');
  });
});

describe('mode Tor strict (onion uniquement)', () => {
  it('dérive la passerelle (legacy) depuis le relais SMP', () => {
    expect(getTorGatewayUrl()).toMatch(/^wss?:\/\/.+\/tor$/);
  });

  it('n’utilise QUE le .onion : relay vide sans onion, même si une passerelle existe', () => {
    expect(getTorGatewayUrl()).not.toBe('');
    expect(getTorRelayUrl()).toBe('');
  });

  it('utilise le .onion quand il est configuré', () => {
    setOnionRelayUrl(V3);
    expect(getTorRelayUrl()).toBe(`ws://${V3}`);
  });

  it('Tor n’est disponible qu’avec un .onion (jamais via la passerelle)', () => {
    expect(isTorAvailable()).toBe(false);
    setOnionRelayUrl(V3);
    expect(isTorAvailable()).toBe(true);
  });
});
