// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Écran plein bloquant de vérification 2FA au login.
 * Tant que `mfaPending` n'est pas résolu, l'app connectée n'est pas rendue
 * (voir App.tsx). Un code TOTP à 6 chiffres est exigé ; « Annuler » déconnecte.
 */

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n';

export function MfaGate() {
  const { verifyMfaAtLogin, signOut } = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError('');
    const result = await verifyMfaAtLogin(code);
    if (!result.success) {
      setError(result.error || t('twoFaInvalidCode'));
      setCode('');
    }
    // En cas de succès, `mfaPending` passe à null et cet écran est démonté.
    setBusy(false);
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen-safe flex items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="w-20 h-20 mx-auto rounded-full bg-accent/20 flex items-center justify-center">
          <ShieldCheck size={40} className="text-accent" />
        </div>
        <h1 className="text-xl font-bold text-text-primary text-center">{t('mfaGateTitle')}</h1>
        <p className="text-sm text-text-secondary text-center">{t('mfaGateDesc')}</p>

        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          className="space-y-3"
        >
          <label className="block text-sm text-text-secondary" htmlFor="mfa-gate-code">
            {t('mfaGateCodeLabel')}
          </label>
          <input
            id="mfa-gate-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replaceAll(/\D/g, '').slice(0, 6));
              setError('');
            }}
            placeholder="123456"
            className="w-full px-3 py-3 rounded-2xl bg-bg-surface text-center text-2xl tracking-[0.5em] font-mono text-text-primary outline-none"
          />
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full py-3 rounded-2xl bg-[#7578db] text-white font-medium hover:bg-[#5a5ec9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy ? <><Loader2 size={18} className="animate-spin" />{t('mfaGateVerifying')}</> : t('mfaGateVerify')}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy}
          className="w-full text-xs text-text-tertiary disabled:opacity-50"
        >
          {t('mfaGateCancel')}
        </button>
      </div>
    </div>
  );
}
