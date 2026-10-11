// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Lien de **contact** (façon « Contact WhatsApp ») : le QR de « MON CODE » encode
 * `nephtys://contact/@pseudo`. Le scanner d'un autre appareil l'ajoute en contact
 * et ouvre la discussion.
 */

import { supabase } from './supabase';

const RE = /^nephtys:\/\/contact\/@(.+)$/;

export function encodeContactLink(username: string): string {
  return `nephtys://contact/@${username}`;
}

export function isContactLink(text: string): boolean {
  return RE.test(text.trim());
}

export function parseContactLink(text: string): string | null {
  const m = RE.exec(text.trim());
  return m ? m[1].trim() : null;
}

async function findDirectConversation(userId: string, contactUserId: string): Promise<string | null> {
  const { data: members } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId);
  if (!members) return null;
  for (const m of members) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('type')
      .eq('id', m.conversation_id)
      .maybeSingle();
    if (conv?.type !== 'direct') continue;
    const { data: other } = await supabase
      .from('conversation_members')
      .select('id')
      .eq('conversation_id', m.conversation_id)
      .eq('user_id', contactUserId)
      .maybeSingle();
    if (other) return m.conversation_id;
  }
  return null;
}

async function createDirectConversation(userId: string, contactUserId: string): Promise<string | null> {
  const { data: conv, error } = await supabase
    .from('conversations')
    .insert({ type: 'direct', created_by: userId, is_encrypted: true, last_message_at: new Date().toISOString(), name: null })
    .select()
    .maybeSingle();
  if (error || !conv) return null;
  await supabase.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: userId, role: 'admin', is_active: true },
    { conversation_id: conv.id, user_id: contactUserId, role: 'member', is_active: true },
  ]);
  return conv.id;
}

/**
 * Ajoute le contact (par pseudo) et renvoie l'id de la conversation directe.
 * Lève si l'utilisateur est introuvable.
 */
export async function addContactAndOpenConversation(userId: string, username: string): Promise<string | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (!profile?.id) throw new Error('Utilisateur introuvable.');
  if (profile.id === userId) throw new Error('C\'est vous.');

  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('user_id', userId)
    .eq('contact_user_id', profile.id)
    .maybeSingle();
  if (!existing) {
    await supabase
      .from('contacts')
      .insert({ user_id: userId, contact_user_id: profile.id, is_blocked: false, is_favorite: false });
  }

  return (await findDirectConversation(userId, profile.id)) ?? (await createDirectConversation(userId, profile.id));
}