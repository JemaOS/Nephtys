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
  createPrivateRelayWire,
} from './relayClient';
import { FailoverRelayWire } from './failoverRelayWire';
import { SupabaseRelayWire } from './supabaseRelayWire';
import { SmpRelayWire } from './smpRelayWire';

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
  it('active/désactive la préférence (un `.onion` est fourni par défaut)', () => {
    // Un relais `.onion` est fourni par défaut → activer Tor a un effet réel.
    expect(getOnionRelayUrl()).toMatch(/^ws:\/\/.+\.onion/);
    setTorRelayEnabled(true);
    expect(isTorRelayEnabled()).toBe(true);
    setTorRelayEnabled(false);
    expect(isTorRelayEnabled()).toBe(false);
  });

  it('une adresse `.onion` explicite remplace le défaut ; la vider revient au défaut', () => {
    setOnionRelayUrl(V3);
    expect(getOnionRelayUrl()).toBe(`ws://${V3}`);
    setOnionRelayUrl('');
    // Retour au relais `.onion` par défaut (non vide, différent de l'override).
    expect(getOnionRelayUrl()).toMatch(/^ws:\/\/.+\.onion/);
    expect(getOnionRelayUrl()).not.toBe(`ws://${V3}`);
  });

  it('enregistre puis normalise l’adresse .onion', () => {
    setOnionRelayUrl(V3);
    expect(getOnionRelayUrl()).toBe(`ws://${V3}`);
  });

  it('persiste le mode Tor à travers un rechargement (localStorage)', () => {
    setTorRelayEnabled(true);
    expect(localStorage.getItem('nephtys_tor_enabled')).toBe('1');
    expect(isTorRelayEnabled()).toBe(true);
  });
});

describe('entrée Tor (`.onion` prioritaire, passerelle en repli)', () => {
  it('dérive la passerelle Tor depuis le relais SMP', () => {
    expect(getTorGatewayUrl()).toMatch(/^wss?:\/\/.+\/tor$/);
  });

  it('utilise le `.onion` (par défaut) prioritairement à la passerelle', () => {
    expect(getTorRelayUrl()).toBe(getOnionRelayUrl());
    expect(getTorRelayUrl()).toMatch(/^ws:\/\/.+\.onion/);
    expect(isTorAvailable()).toBe(true);
  });

  it('préfère un `.onion` explicite quand il est configuré', () => {
    setOnionRelayUrl(V3);
    expect(getTorRelayUrl()).toBe(`ws://${V3}`);
  });
});

describe('repli du transport privé (Tor → Supabase anon)', () => {
  it('en Tor, le wire est un failover Tor (onion) → Supabase anon', () => {
    setTorRelayEnabled(true);
    setOnionRelayUrl(V3);
    const { wire, failover } = createPrivateRelayWire();
    // La branche Tor n'est plus fail-closed : elle bascule sur le relais
    // anonyme Supabase si le client Tor WASM n'atteint pas l'`.onion`.
    expect(failover).toBeInstanceOf(FailoverRelayWire);
    expect(failover?.primaryWire).toBeInstanceOf(SmpRelayWire);
    expect(failover?.secondaryWire).toBeInstanceOf(SupabaseRelayWire);
    expect(wire).toBe(failover);
  });

  it('hors Tor (défaut), le repli secondaire est le relais Supabase anon', () => {
    expect(isTorRelayEnabled()).toBe(false);
    const { wire, failover } = createPrivateRelayWire();
    expect(failover).toBeInstanceOf(FailoverRelayWire);
    expect(failover?.secondaryWire).toBeInstanceOf(SupabaseRelayWire);
    expect(wire).toBe(failover);
  });
});
