// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';
import { useI18n } from '@/i18n';
import { Lock, Eye, EyeOff, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { checkPassphraseStrength } from '@/lib/passphraseKeyStore';

export interface PassphraseModalProps {
    /**
     * - 'setup' : l'utilisateur définit sa passphrase pour la 1ère fois
     * - 'unlock' : sur un nouveau device, on demande la passphrase pour
     *   déchiffrer la clé privée déjà stockée en DB
     */
    mode: 'setup' | 'unlock';
    onSubmit: (passphrase: string) => Promise<void>;
    /**
     * Si mode = 'unlock' et que l'utilisateur clique "Réinitialiser mes clés"
     * (= perdre l'historique média mais récupérer son compte).
     */
    onReset?: () => Promise<void>;
}

export const PassphraseModal: React.FC<PassphraseModalProps> = ({ mode, onSubmit, onReset }) => {
    const { t } = useI18n();
    const [passphrase, setPassphrase] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const strength = checkPassphraseStrength(passphrase);
    const passphrasesMatch = mode === 'setup' ? passphrase === confirm : true;
    const canSubmit =
        !submitting &&
        strength.ok &&
        passphrasesMatch &&
        passphrase.length > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            await onSubmit(passphrase);
        } catch (err) {
            setError(
                mode === 'unlock'
                    ? t('passphraseIncorrect')
                    : t('passphraseSaveError'),
            );
        } finally {
            setSubmitting(false);
        }
    };

    const handleReset = async () => {
        if (!onReset) return;
        setSubmitting(true);
        try {
            await onReset();
        } catch {
            setError(t('resetFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-[200]"
            role="dialog"
            aria-modal="true"
            aria-label={t('recoveryPassphrase')}
        >
            <div className="w-full max-w-md bg-bg-surface rounded-3xl p-6 shadow-2xl">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
                        <Lock size={22} className="text-accent" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-text-primary">
                            {mode === 'setup' ? t('secureYourKeys') : t('unlockAccount')}
                        </h2>
                        <p className="text-xs text-text-secondary">
                            {mode === 'setup'
                                ? t('setRecoveryPassphrase')
                                : t('enterPassphraseNewDevice')}
                        </p>
                    </div>
                </div>

                {/* Explication */}
                <div className="bg-bg-hover rounded-xl p-3 mb-4 text-xs text-text-secondary leading-relaxed">
                    {mode === 'setup' ? (
                        <>
                            {t('passphraseSetupExplain')}
                        </>
                    ) : (
                        <>
                            {t('passphraseUnlockExplain')}
                        </>
                    )}
                </div>

                {showResetConfirm ? (
                    <div className="space-y-3">
                        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex gap-2">
                            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-text-primary">
                                <p className="font-medium text-red-400 mb-1">{t('keysResetTitle')}</p>
                                <p>
                                    {t('keysResetExplain')}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowResetConfirm(false)}
                                disabled={submitting}
                                className="flex-1 py-2.5 rounded-xl bg-bg-hover hover:bg-bg-primary text-text-primary font-medium disabled:opacity-50"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleReset}
                                disabled={submitting}
                                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {submitting && <Loader2 size={16} className="animate-spin" />}
                                {t('confirm')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div className="relative">
                            <input
                                type={show ? 'text' : 'password'}
                                value={passphrase}
                                onChange={(e) => setPassphrase(e.target.value)}
                                placeholder={t('passwordPlaceholder')}
                                autoFocus
                                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                                className="w-full px-4 py-3 pr-11 rounded-xl bg-bg-hover text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent"
                                aria-label={t('passwordPlaceholder')}
                            />
                            <button
                                type="button"
                                onClick={() => setShow((v) => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                                aria-label={show ? t('hide') : t('show')}
                            >
                                {show ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>

                        {mode === 'setup' && passphrase.length > 0 && (
                            <>
                                <input
                                    type={show ? 'text' : 'password'}
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    placeholder={t('confirmPassphrasePlaceholder')}
                                    autoComplete="new-password"
                                    className="w-full px-4 py-3 rounded-xl bg-bg-hover text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent"
                                    aria-label={t('confirmPassphrasePlaceholder')}
                                />
                                <div className="flex items-center gap-2 text-xs">
                                    <div className="flex-1 h-1 bg-bg-hover rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all ${
                                                strength.score <= 1
                                                    ? 'bg-red-500'
                                                    : strength.score === 2
                                                        ? 'bg-orange-400'
                                                        : strength.score === 3
                                                            ? 'bg-yellow-400'
                                                            : 'bg-green-500'
                                            }`}
                                            style={{ width: `${(strength.score / 4) * 100}%` }}
                                        />
                                    </div>
                                    <span className="text-text-secondary w-20 text-right">
                                        {t(`passphraseStrength${strength.score}`)}
                                    </span>
                                </div>
                                {confirm.length > 0 && !passphrasesMatch && (
                                    <p className="text-xs text-red-400">{t('passphrasesNoMatch')}</p>
                                )}
                            </>
                        )}

                        {error && (
                            <p className="text-xs text-red-400 flex items-center gap-1">
                                <AlertTriangle size={14} /> {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="w-full py-3 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <ShieldCheck size={18} />
                            )}
                            {mode === 'setup' ? t('secureAndContinue') : t('unlockAction')}
                        </button>

                        {mode === 'unlock' && onReset && (
                            <button
                                type="button"
                                onClick={() => setShowResetConfirm(true)}
                                className="w-full py-2 text-xs text-text-tertiary hover:text-red-400 underline-offset-2 hover:underline"
                            >
                                {t('forgotPassphraseReset')}
                            </button>
                        )}
                    </form>
                )}
            </div>
        </div>
    );
};
