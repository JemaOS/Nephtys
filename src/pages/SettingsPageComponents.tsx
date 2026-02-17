// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { Loader2, Calendar, Database, Lock, Cloud, Shield } from 'lucide-react'

// Helper component for password dialog - defined outside main component
export const BackupPasswordDialogComponent = ({
  passwordAction,
  backupPassword,
  setBackupPassword,
  setShowPasswordInput,
  handleBackup
}: {
  passwordAction: string,
  backupPassword: string,
  setBackupPassword: (v: string) => void,
  setShowPasswordInput: (v: boolean) => void,
  handleBackup: (isLight: boolean) => void
}) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-bg-surface rounded-2xl p-6 w-full max-w-sm space-y-4">
      <h3 className="text-lg font-semibold text-text-primary">
        {passwordAction === 'backup' ? 'Mot de passe de sauvegarde' : 'Mot de passe de restauration'}
      </h3>
      <p className="text-sm text-text-secondary">
        {passwordAction === 'backup' 
          ? 'Créez un mot de passe pour chiffrer votre sauvegarde. Vous en aurez besoin pour la restaurer.'
          : 'Entrez le mot de passe utilisé lors de la création de cette sauvegarde.'}
      </p>
      <input 
        type="password" 
        value={backupPassword} 
        onChange={(e) => setBackupPassword(e.target.value)} 
        placeholder="Mot de passe" 
        className="w-full px-4 py-3 bg-bg-primary rounded-xl text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent" 
        autoFocus 
      />
      <div className="flex gap-3">
        <button 
          onClick={() => { setShowPasswordInput(false); setBackupPassword(''); }} 
          className="flex-1 py-3 rounded-xl bg-bg-hover text-text-primary font-medium"
        >
          Annuler
        </button>
        <button 
          onClick={() => {
            if (backupPassword.length >= 4) {
              setShowPasswordInput(false);
              if (passwordAction === 'backup') handleBackup(false);
              else if (passwordAction === 'light-backup') handleBackup(true);
            } else {
              alert('Le mot de passe doit contenir au moins 4 caractères');
            }
          }} 
          disabled={backupPassword.length < 4} 
          className="flex-1 py-3 rounded-xl bg-accent text-white font-medium disabled:opacity-50"
        >
          Confirmer
        </button>
      </div>
    </div>
  </div>
)

// Helper component for backup progress - defined outside main component
export const BackupProgressDisplayComponent = ({
  isBackingUp,
  isRestoring,
  backupStatus,
  backupProgress
}: {
  isBackingUp: boolean,
  isRestoring: boolean,
  backupStatus: string,
  backupProgress: number
}) => (
  <div className="px-6 py-4 bg-accent/10 mx-4 rounded-2xl mb-4">
    <div className="flex items-center gap-3 mb-2">
      <Loader2 size={20} className="animate-spin text-accent" />
      <span className="text-text-primary font-medium">
        {isBackingUp ? 'Sauvegarde en cours...' : 'Restauration en cours...'}
      </span>
    </div>
    <div className="text-sm text-text-secondary mb-2">{backupStatus}</div>
    <div className="w-full bg-bg-hover rounded-full h-2">
      <div className="bg-accent h-2 rounded-full transition-all duration-300" style={{ width: `${backupProgress}%` }} />
    </div>
    <div className="text-xs text-text-secondary mt-1 text-right">{backupProgress}%</div>
  </div>
)

// Helper function to format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Helper function to format backup date
const formatBackupDate = (date: Date | null): string => {
  if (!date) return 'Jamais'
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Helper for backup info display - defined outside main component
export const BackupInfoDisplayComponent = ({ lastBackupDate, lastBackupSize, estimatedSize }: {
  lastBackupDate: Date | null,
  lastBackupSize: number,
  estimatedSize: number
}) => (
  <div className="px-6 py-4 bg-bg-surface mx-4 rounded-2xl mb-4">
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-text-secondary text-sm">
        <Calendar size={16} /><span>Dernière sauvegarde : {formatBackupDate(lastBackupDate)}</span>
      </div>
      {lastBackupSize > 0 && (
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <Database size={16} /><span>Taille : {formatBytes(lastBackupSize)}</span>
        </div>
      )}
      {estimatedSize > 0 && (
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <Database size={16} /><span>Taille estimée : {formatBytes(estimatedSize)}</span>
        </div>
      )}
      <div className="flex items-center gap-2 text-accent text-sm">
        <Lock size={16} /><span>Chiffrée de bout en bout</span>
      </div>
    </div>
  </div>
)

// Helper for Proton Drive recommendation - defined outside main component
export const ProtonDriveRecommendationComponent = () => (
  <div className="px-6 py-4 border-t border-bg-hover mt-4">
    <div className="bg-[#6d4aff]/10 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[#6d4aff] flex items-center justify-center flex-shrink-0">
          <Cloud size={20} className="text-white" />
        </div>
        <div className="flex-1">
          <div className="text-text-primary font-medium mb-1">Stockage recommandé : Proton Drive</div>
          <p className="text-text-secondary text-sm mb-2">
            Après avoir créé votre sauvegarde, uploadez le fichier .neph sur Proton Drive pour le stocker en toute sécurité.
          </p>
        </div>
      </div>
    </div>
  </div>
)

// Helper component for backup setting toggle - defined outside main component
export const BackupSettingToggleComponent = ({
  label,
  description,
  value,
  onChange
}: {
  label: string,
  description: string,
  value: boolean,
  onChange: (v: boolean) => void
}) => (
  <div className="px-6 py-4 border-t border-bg-hover">
    <div className="flex items-center justify-between">
      <div>
        <div className="text-text-primary">{label}</div>
        <div className="text-text-secondary text-sm">{description}</div>
      </div>
      <button 
        onClick={() => onChange(!value)} 
        className={`w-12 h-6 rounded-full relative transition-colors ${value ? 'bg-accent' : 'bg-[#8696a0]'}`}
      >
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${value ? 'right-1' : 'left-1'}`}></div>
      </button>
    </div>
  </div>
)

// Helper component for security info - defined outside main component
export const BackupSecurityInfoComponent = () => (
  <div className="px-6 py-4">
    <div className="bg-bg-surface rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <Shield size={24} className="text-accent flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-text-primary font-medium mb-1">Sauvegarde chiffrée</div>
          <p className="text-text-secondary text-sm">
            Vos sauvegardes sont chiffrées de bout en bout avec votre mot de passe personnel.
          </p>
        </div>
      </div>
    </div>
  </div>
)
