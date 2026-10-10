// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Abstraction de transport de messagerie.
 *
 * Objectif (feuille de route décentralisation) : sortir le client du
 * couplage direct aux tables Supabase pour pouvoir brancher, sans réécrire
 * l'UI, un modèle « relais » à la SimpleX (files unidirectionnelles, serveur
 * sans identifiants ni graphe social, self-hosting), via le protocole SMP.
 *
 * Aujourd'hui : seule l'implémentation Supabase est active
 * (`VITE_MESSAGING_TRANSPORT` = "supabase", défaut).
 * Demain : `smpTransport` (voir `smpTransport.ts`) implémentera la même
 * interface au-dessus de simplexmq / du client TypeScript SimpleX.
 *
 * L'interface est volontairement minimale et orientée « enveloppe opaque » :
 * le transport ne connaît jamais le clair, uniquement des messages déjà
 * chiffrés E2EE (cf. `src/lib/textEncryption.ts`).
 */

/** Message prêt à être envoyé (contenu déjà chiffré E2EE). */
export interface OutgoingMessage {
  conversationId: string;
  senderId: string;
  /** Ciphertext base64 (jamais de clair). */
  content: string;
  type: string;
  replyToId?: string | null;
  /** Enveloppe E2EE `{ v, iv }` pour le destinataire. */
  encryptionMetadata?: unknown;
  isTextEncrypted?: boolean;
  /** Champs média éventuels (chemin bucket / métadonnées). */
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaThumbnail?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  isMediaEncrypted?: boolean;
  ephemeralDuration?: number | null;
  /** Aperçu de lien (JSON) — déjà chiffré/opaque pour le transport. */
  linkPreview?: unknown;
  /**
   * Phase 1 « cacher le graphe au serveur » : blobs sealed sender (opaque,
   * un par destinataire). Le transport les véhicule sans les interpréter.
   */
  senderSealed?: string[] | null;
}

/** Message reçu (contenu encore chiffré — le déchiffrement est hors transport). */
export interface IncomingMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string;
  createdAt: string;
  /** Champs bruts supplémentaires propres au backend. */
  raw: Record<string, unknown>;
}

export interface SendResult {
  id: string;
  raw: Record<string, unknown>;
}

export type Unsubscribe = () => void;

/**
 * Contrat que tout backend de messagerie doit respecter.
 *
 * Note : dans un backend à files SimpleX, `subscribe` correspond à la
 * souscription aux files SMP de la conversation (pas à un canal Realtime
 * centralisé) et les identifiants ne sont pas des `userId` globaux mais des
 * adresses de file par connexion.
 */
export interface MessagingTransport {
  /** Identifiant du backend pour diagnostics ("supabase" | "smp" | …). */
  readonly kind: string;

  /** Envoie un message (contenu déjà chiffré). */
  sendMessage(msg: OutgoingMessage): Promise<SendResult>;

  /** Souscrit aux messages entrants d'une conversation. */
  subscribe(conversationId: string, onMessage: (msg: IncomingMessage) => void): Unsubscribe;

  /** Récupère l'historique d'une conversation (contenus chiffrés bruts). */
  fetchHistory(conversationId: string, limit?: number): Promise<IncomingMessage[]>;
}
