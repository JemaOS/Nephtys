// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Écran proposé APRÈS une récupération par phrase sur un appareil neuf (flux
 * « façon WhatsApp », monté par RecoveryGate) : restaure une sauvegarde `.neph`
 * ou laisse continuer sans restaurer.
 *
 * Réutilise STRICTEMENT les fonctions existantes de `@/lib/backupService`
 * (`importBackupFromFile` puis `restoreBackup`), comme les Réglages. Aucun
 * secret n'est persisté : le mot de passe de sauvegarde ne vit qu'en mémoire
 * locale du composant.
 */

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n';
import { importBackupFromFile, restoreBackup } from '@/lib/backupService';

export function RestoreBackupPrompt({ onContinue }: { readonly onContinue: () => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const handleRestore = async () => {
    if (!user) {
      onContinue();
      return;
    }
    if (!file || !file.name.endsWith('.neph')) {
      alert(t('invalidBackupFileAlert'));
      return;
    }

    setBusy(true);
    setProgress(0);
    setStatus(t('restoreReading'));

    try {
      const backupData = await importBackupFromFile(file, password);
      if (!backupData) throw new Error(t('restoreReadError'));

      const result = await restoreBackup(backupData, user.id, (p, s) => {
        setProgress(p);
        setStatus(s);
      });

      if (result.success) {
        alert(t('restoreSuccessAlert'));
        globalThis.location.reload();
      } else {
        throw new Error(result.error || t('restoreError'));
      }
    } catch (err) {
      console.error('Restore error:', err);
      alert(t('restoreErrorAlert', { message: (err as Error)?.message || t('pleaseTryAgain') }));
    } finally {
      setBusy(false);
      setProgress(0);
      setStatus('');
    }
  };

  return (
    <div className="h-screen-safe flex items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-lg space-y-3">
        <h1 className="text-xl font-bold text-text-primary text-center">
          {t('restoreBackupPromptTitle')}
        </h1>
        <p className="text-sm text-text-secondary text-center">
          {t('restoreBackupPromptDesc')}
        </p>

        <input
          type="file"
          accept=".neph"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full px-3 py-2 rounded-xl bg-bg-surface text-sm text-text-primary outline-none disabled:opacity-50"
        />
        {file && <p className="text-xs text-text-tertiary truncate">{file.name}</p>}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('restorePasswordTitle')}
          disabled={busy}
          className="w-full px-3 py-2 rounded-xl bg-bg-surface text-sm text-text-primary outline-none disabled:opacity-50"
        />
        <p className="text-xs text-text-tertiary">{t('restorePasswordDesc')}</p>

        {busy && (
          <div className="space-y-1">
            <div className="text-xs text-text-secondary">{status || t('restoreInProgress')}</div>
            <div className="w-full bg-bg-hover rounded-full h-2">
              <div
                className="bg-[#7578db] h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleRestore}
          disabled={busy || !file || !password}
          className="w-full px-4 py-3 rounded-2xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('restoreInProgress') : t('restoreBackupAction')}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={busy}
          className="w-full px-4 py-3 rounded-2xl bg-bg-surface text-text-primary text-sm disabled:opacity-50"
        >
          {t('continueWithoutRestore')}
        </button>
      </div>
    </div>
  );
}
