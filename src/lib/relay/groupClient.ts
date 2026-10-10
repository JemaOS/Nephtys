// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/** Point d'entrée client du mode groupe privé (même transport que le 1:1). */

import { WebSocketWire } from './wire';
import { SupabaseRelayWire } from './supabaseRelayWire';
import { hasCustomRelay, getRelayUrl } from './relayClient';
import { GroupMessenger } from './groupMessenger';
import { IdbGroupStore } from './groupIdbStore';

let instance: GroupMessenger | null = null;

export function getGroupMessenger(): GroupMessenger {
  if (!instance) {
    const wire = hasCustomRelay() ? new WebSocketWire(getRelayUrl()) : new SupabaseRelayWire();
    instance = new GroupMessenger(wire, new IdbGroupStore());
  }
  return instance;
}
