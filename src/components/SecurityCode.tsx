// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect } from 'react';
import { Shield, Check, Copy } from 'lucide-react';
import { e2eeManager } from '@/lib/encryption';

interface SecurityCodeProps {
  myPublicKey: string;
  otherPublicKey: string;
  otherUsername: string;
  onClose: () => void;
}

export const SecurityCode: React.FC<SecurityCodeProps> = ({
  myPublicKey,
  otherPublicKey,
  otherUsername,
  onClose,
}) => {
  const [safetyNumber, setSafetyNumber] = useState<string>('');
  const [isVerified, setIsVerified] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generateSafetyNumber();
  }, [myPublicKey, otherPublicKey]);

  const generateSafetyNumber = async () => {
    try {
      const number = await e2eeManager.generateSafetyNumber(myPublicKey, otherPublicKey);
      setSafetyNumber(number);
    } catch (error) {
      console.error('Error generating safety number:', error);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(safetyNumber.replaceAll(/\s/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = () => {
    setIsVerified(true);
    alert('Code de sécurité vérifié! Votre conversation est sécurisée.');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-glass-surface-light backdrop-blur-[30px] border border-glass-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <Shield size={32} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Code de sécurité</h2>
          <p className="text-sm text-text-tertiary">
            Vérifiez ce code avec {otherUsername} pour confirmer que votre conversation est chiffrée de bout en bout
          </p>
        </div>

        {/* Safety Number */}
        <div className="mb-6 p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
          <div className="text-center font-mono text-lg leading-relaxed select-all">
            {safetyNumber || 'Génération...'}
          </div>
        </div>

        {/* Info */}
        <div className="mb-6 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
          <div className="flex gap-3">
            <Shield size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-text-secondary">
              <p className="font-semibold mb-1">Comment vérifier?</p>
              <p>Comparez ce code avec celui de {otherUsername}. S'ils sont identiques, votre conversation est sécurisée.</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleCopy}
            className="w-full py-3 rounded-xl bg-glass-surface-medium hover:bg-white/10 border border-glass-border transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check size={20} className="text-green-500" />
                Copié!
              </>
            ) : (
              <>
                <Copy size={20} />
                Copier le code
              </>
            )}
          </button>

          <button
            onClick={handleVerify}
            disabled={isVerified}
            className={`w-full py-3 rounded-xl transition-colors flex items-center justify-center gap-2 ${
              isVerified
                ? 'bg-green-500/20 border border-green-500/30 text-green-500'
                : 'bg-primary-500 hover:bg-primary-600 text-white'
            }`}
          >
            {isVerified ? (
              <>
                <Check size={20} />
                Vérifié
              </>
            ) : (
              <>
                <Shield size={20} />
                Marquer comme vérifié
              </>
            )}
          </button>

          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-glass-surface-medium hover:bg-white/10 transition-colors"
          >
            Fermer
          </button>
        </div>

        {/* Warning */}
        {isVerified && (
          <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
            <p className="text-xs text-green-500">
              ✓ Conversation vérifiée et sécurisée
            </p>
          </div>
        )}
      </div>
    </div>
  );
};