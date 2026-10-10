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
  it('active/désactive et persiste la préférence', () => {
    expect(isTorRelayEnabled()).toBe(false);
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

describe('passerelle Tor (un clic, sans réglage)', () => {
  it('dérive l’URL de la passerelle depuis le relais SMP', () => {
    expect(getTorGatewayUrl()).toMatch(/^wss?:\/\/.+\/tor$/);
  });

  it('préfère une adresse .onion explicite à la passerelle', () => {
    setOnionRelayUrl(V3);
    expect(getTorRelayUrl()).toBe(`ws://${V3}`);
    setOnionRelayUrl('');
    expect(getTorRelayUrl()).toBe(getTorGatewayUrl());
  });

  it('indique que Tor est disponible via la passerelle', () => {
    expect(isTorAvailable()).toBe(true);
  });
});
