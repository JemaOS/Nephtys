// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Gate de récupération « zéro serveur ».
 *   • Après une inscription : affiche la phrase de récupération (sauvegarde
 *     obligatoire) AVANT de laisser entrer dans l'app.
 *   • Sur un appareil sans clés locales : demande la phrase pour tout restaurer.
 * Tant que l'un des deux est actif, l'app connectée n'est pas rendue.
 */

import { useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { validateRecoveryPhrase, parseDeviceLink } from '@/lib/recovery/recoveryService';
import { isDeviceLink, redeemDeviceLink } from '@/lib/recovery/deviceLink';
import { QrScanner } from '@/components/QrScanner';

function ShowPhraseScreen({ phrase, onConfirm }: { readonly phrase: string; readonly onConfirm: () => void }) {
  const [copied, setCopied] = useState(false);
  const words = phrase.split(' ');
  return (
    <div className="h-screen-safe flex items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-lg space-y-3">
        <h1 className="text-xl font-bold text-text-primary text-center">Votre phrase de récupération</h1>
        <p className="text-sm text-text-secondary text-center">
          Notez ces 24 mots et conservez-les en lieu sûr. Ils sont le <b>seul</b> moyen de
          retrouver vos messages sur un autre appareil. Ils ne sont <b>jamais</b> envoyés au serveur.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-4 rounded-2xl bg-bg-surface">
          {words.map((w, i) => (
            <div key={`${i}-${w}`} className="text-sm text-text-primary">
              <span className="text-text-tertiary mr-1">{i + 1}.</span>
              {w}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(phrase);
            setCopied(true);
          }}
          className="w-full px-3 py-2 rounded-xl bg-bg-hover text-text-primary text-sm"
        >
          {copied ? 'Copié' : 'Copier la phrase'}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="w-full px-4 py-3 rounded-2xl bg-[#7578db] text-white text-sm font-medium"
        >
          J'ai sauvegardé ma phrase
        </button>
      </div>
    </div>
  );
}

function EnterPhraseScreen() {
  const { completeRecovery, signOut } = useAuth();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const valid = validateRecoveryPhrase(phrase);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeRecovery(phrase);
    } catch (e) {
      setError((e as Error)?.message ?? 'Phrase invalide.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen-safe flex items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-lg space-y-3">
        <h1 className="text-xl font-bold text-text-primary text-center">Restaurer vos messages</h1>
        <p className="text-sm text-text-secondary text-center">
          Cet appareil n'a pas vos clés. Entrez votre phrase de récupération (24 mots) pour
          retrouver l'historique.
        </p>
        <textarea
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          rows={3}
          placeholder="mot1 mot2 mot3 …"
          className="w-full px-3 py-2 rounded-xl bg-bg-surface text-sm text-text-primary font-mono resize-none outline-none"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !valid}
          className="w-full px-4 py-3 rounded-2xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Restauration…' : 'Restaurer'}
        </button>
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="w-full px-4 py-3 rounded-2xl bg-bg-surface text-text-primary text-sm"
        >
          Scanner le QR code d'un appareil
        </button>
        <button type="button" onClick={() => signOut()} className="w-full text-xs text-text-tertiary">
          Se déconnecter
        </button>
      </div>
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            if (isDeviceLink(text)) {
              setError(null);
              setBusy(true);
              void redeemDeviceLink(text)
                .catch((e: unknown) => setError((e as Error).message))
                .finally(() => setBusy(false));
              return;
            }
            const scanned = parseDeviceLink(text);
            if (scanned) {
              setPhrase(scanned);
              setError(null);
            } else {
              setError('QR code non reconnu.');
            }
          }}
        />
      )}
    </div>
  );
}

export function RecoveryGate({ children }: { readonly children: ReactNode }) {
  const { pendingPhrase, recoveryRequired, confirmPhraseSaved } = useAuth();
  if (pendingPhrase) {
    return <ShowPhraseScreen phrase={pendingPhrase} onConfirm={confirmPhraseSaved} />;
  }
  if (recoveryRequired) {
    return <EnterPhraseScreen />;
  }
  return <>{children}</>;
}
