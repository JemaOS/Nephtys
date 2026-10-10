// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Safety number (code de sécurité) — vérification hors-bande.
 *
 * Déterministe et identique sur les deux appareils quel que soit l'ordre
 * des arguments. Extrait de l'ancien barrel `@/lib/crypto` (module mort) pour
 * supprimer la dépendance à tout le code crypto non utilisé.
 *
 * @module safetyNumber
 */

/**
 * Compare deux tableaux d'octets lexicographiquement.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * Génère un « safety number » (code de sécurité) vérifiable hors-bande à
 * partir des deux clés publiques (base64). Le code est déterministe et
 * identique sur les deux appareils quel que soit l'ordre des arguments.
 *
 * @param myPublicKey    Clé publique de l'utilisateur (base64)
 * @param otherPublicKey Clé publique du contact (base64)
 * @returns Code de sécurité formaté en groupes de 5 chiffres
 */
export async function generateSafetyNumber(
  myPublicKey: string,
  otherPublicKey: string
): Promise<string> {
  const encoder = new TextEncoder();
  const a = encoder.encode(myPublicKey);
  const b = encoder.encode(otherPublicKey);

  // Ordre déterministe indépendant de qui appelle.
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));

  // 12 groupes de 5 chiffres (60 chiffres), format Signal-like.
  const groups: string[] = [];
  for (let i = 0; i < 30; i += 5) {
    let num = 0n;
    for (let j = 0; j < 5; j++) {
      num = (num << 8n) | BigInt(digest[i + j]);
    }
    groups.push((num % 100000n).toString().padStart(5, '0'));
  }
  return groups.join(' ');
}
