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
import { isDeviceLink, redeemDeviceLink, describeDeviceLink } from '@/lib/recovery/deviceLink';
import { QrScanner } from '@/components/QrScanner';
import { RestoreBackupPrompt } from '@/components/RestoreBackupPrompt';

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

function EnterPhraseScreen({ onRecovered }: { readonly onRecovered: () => void }) {
  const { completeRecovery, signOut, clearRecoveryRequired, startFreshWithoutRecovery } = useAuth();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotAck, setForgotAck] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const valid = validateRecoveryPhrase(phrase);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeRecovery(phrase);
      // Récupération par phrase réussie : proposer la restauration d'une
      // sauvegarde `.neph` (flux « façon WhatsApp ») au lieu d'entrer
      // directement dans l'app.
      onRecovered();
    } catch (e) {
      setError((e as Error)?.message ?? 'Phrase invalide.');
    } finally {
      setBusy(false);
    }
  };

  const startFresh = async () => {
    setForgotBusy(true);
    setError(null);
    try {
      await startFreshWithoutRecovery();
      // Un nouveau jeu de clés est installé → `pendingPhrase` est défini et le
      // gate bascule sur l'affichage de la nouvelle phrase à sauvegarder.
      setForgotOpen(false);
      setForgotAck(false);
    } catch (e) {
      setForgotOpen(false);
      setError((e as Error)?.message ?? 'Réinitialisation impossible.');
    } finally {
      setForgotBusy(false);
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
        <button
          type="button"
          onClick={() => { setForgotOpen(true); setError(null); }}
          className="w-full text-xs text-amber-400"
        >
          J'ai perdu ma phrase de récupération
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
              // Lien d'appareil NON authentifié : on exige une confirmation
              // explicite du compte visé avant d'établir la session (sinon un
              // QR forgé permettrait une fixation de session).
              const target = describeDeviceLink(text);
              const ok = globalThis.confirm(
                `Cet appareil va se connecter au compte « ${target?.label ?? 'inconnu'} ». Confirmer ?`,
              );
              if (!ok) {
                setError('Liaison annulée.');
                return;
              }
              setError(null);
              setBusy(true);
              void redeemDeviceLink(text, { confirmed: true })
                .then(() => {
                  // La session et les clés sont installées : on lève l'exigence
                  // de récupération, sinon l'app reste bloquée sur ce gate.
                  clearRecoveryRequired();
                })
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
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-bg-surface p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-text-primary text-center">
              Continuer sans phrase de récupération ?
            </h2>
            <div className="space-y-2 text-sm text-text-secondary">
              <p>
                Sans votre phrase de récupération, votre historique est
                <b> définitivement illisible</b>. Vous allez perdre :
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>tous vos messages, dans chaque conversation ;</li>
                <li>tous vos médias associés (photos, vidéos, vocaux, fichiers).</li>
              </ul>
              <p>
                Vos <b>contacts et vos conversations seront conservés</b>, mais
                <b> vides</b> : aucun message ni média n'y subsistera.
              </p>
              <p>
                Une <b>nouvelle phrase de récupération</b> sera générée. Notez-la
                précieusement : c'est votre seule clé pour retrouver vos messages
                ailleurs. Cette action est <b>irréversible</b>.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={forgotAck}
                onChange={(e) => setForgotAck(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Je comprends que mes messages et médias seront définitivement perdus
                et ne pourront pas être restaurés.
              </span>
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={startFresh}
                disabled={!forgotAck || forgotBusy}
                className="w-full px-4 py-3 rounded-2xl bg-red-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {forgotBusy ? 'Effacement…' : 'Oui, tout effacer et continuer'}
              </button>
              <button
                type="button"
                onClick={() => { setForgotOpen(false); setForgotAck(false); }}
                disabled={forgotBusy}
                className="w-full px-4 py-3 rounded-2xl bg-bg-hover text-text-primary text-sm"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function RecoveryGate({ children }: { readonly children: ReactNode }) {
  const { pendingPhrase, recoveryRequired, confirmPhraseSaved, user } = useAuth();
  // Après une récupération par phrase, on propose la restauration d'une
  // sauvegarde `.neph` AVANT d'entrer dans l'app. Uniquement sur ce chemin :
  // jamais après l'écran de phrase d'inscription, ni sur « même appareil ».
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  if (pendingPhrase) {
    return <ShowPhraseScreen phrase={pendingPhrase} onConfirm={confirmPhraseSaved} />;
  }
  if (recoveryRequired) {
    return <EnterPhraseScreen onRecovered={() => setShowRestorePrompt(true)} />;
  }
  // `user` absent → on ne propose rien et on laisse l'app se rendre normalement.
  if (showRestorePrompt && user) {
    return <RestoreBackupPrompt onContinue={() => setShowRestorePrompt(false)} />;
  }
  return <>{children}</>;
}
