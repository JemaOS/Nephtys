// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { supabase } from '@/lib/supabase'
import { MediaImg } from '@/components/MediaImg'
import { invalidateMediaUrl } from '@/lib/mediaUrl'
import {
  check2FAStatus,
  enroll2FA,
  verify2FAEnrollment,
  unenroll2FA,
  type TOTPFactor,
  type EnrollmentData
} from '@/lib/twoFactorAuth'

// Type for storage/media type filter
type StorageType = 'all' | 'photos' | 'videos' | 'files' | 'audio';
import {
  ArrowLeft, User, Lock, Bell, MessageSquare, Video, Palette,
  Globe, Database, HelpCircle, Info, LogOut, ChevronRight,
  Moon, Sun, Check, Camera, Edit2, Shield, Key, Trash2,
  Eye, EyeOff, Wifi, WifiOff, Mail, Image, FileText, Mic, Loader2,
  Cloud, CloudUpload, DownloadCloud, Smartphone, Copy, X
} from 'lucide-react'
import {
  createBackup,
  createLightBackup,
  exportBackupAsFile,
  importBackupFromFile,
  restoreBackup,
  getBackupSettings,
  saveBackupSettings,
  getBackupMetadata,
  saveBackupMetadata,
  estimateBackupSizeDetailed,
  type BackupSettings
} from '@/lib/backupService'
import {
  BackupPasswordDialogComponent,
  BackupProgressDisplayComponent,
  BackupInfoDisplayComponent,
  ProtonDriveRecommendationComponent,
  BackupSettingToggleComponent,
  BackupSecurityInfoComponent
} from './SettingsPageComponents'

type SettingsView = 'main' | 'profile' | 'account' | 'privacy' | 'security' | '2fa' | 'delete' |
                     'discussions' | 'wallpaper' | 'notifications' | 'message-notif' | 'call-notif' |
                     'storage' | 'network' | 'help' | 'faq' | 'contact' | 'terms' | 'backup'

// ============ HELPER FUNCTIONS ============

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const formatBackupDate = (date: Date | null): string => {
  if (!date) return 'Jamais'
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getStorageTypeLabel = (type: StorageType): string => {
  if (type === 'all') return 'toutes les données'
  if (type === 'photos') return 'les photos'
  if (type === 'videos') return 'les vidéos'
  if (type === 'files') return 'les fichiers'
  return 'les messages vocaux'
}

const getMediaTypeFilter = (type: StorageType): string | null => {
  if (type === 'all') return null
  if (type === 'photos') return 'image'
  if (type === 'videos') return 'video'
  if (type === 'audio') return 'audio'
  return 'file'
}

const getViewTitle = (view: SettingsView): string => {
  const titles: Record<SettingsView, string> = {
    'main': 'Paramètres',
    'profile': 'Profil',
    'account': 'Compte',
    'privacy': 'Confidentialité',
    'security': 'Sécurité',
    '2fa': 'Authentification 2FA',
    'delete': 'Supprimer le compte',
    'discussions': 'Discussions',
    'wallpaper': 'Fond d\'écran',
    'notifications': 'Notifications',
    'message-notif': 'Notifications de messages',
    'call-notif': 'Notifications d\'appels',
    'storage': 'Stockage et données',
    'network': 'Utilisation des données',
    'backup': 'Sauvegarde des discussions',
    'faq': 'FAQ',
    'contact': 'Nous contacter',
    'terms': 'Politique de confidentialité',
    'help': 'Aide'
  }
  return titles[view]
}

const getParentView = (view: SettingsView): SettingsView => {
  const accountViews: SettingsView[] = ['privacy', 'security', '2fa', 'delete']
  if (accountViews.includes(view)) return 'account'
  if (view === 'wallpaper') return 'discussions'
  const notifViews: SettingsView[] = ['message-notif', 'call-notif']
  if (notifViews.includes(view)) return 'notifications'
  if (view === 'network') return 'storage'
  const helpViews: SettingsView[] = ['faq', 'contact', 'terms']
  if (helpViews.includes(view)) return 'help'
  return 'main'
}

// ============ COMPONENT ============

export function SettingsPage() {
  const { profile, signOut, user, updateLocalProfile } = useAuth()
  const { theme, wallpaper, setTheme, setWallpaper } = useTheme()
  const navigate = useNavigate()
  const [currentView, setCurrentView] = useState<SettingsView>('main')
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [vibrationEnabled, setVibrationEnabled] = useState(true)
  const [messagePreviewEnabled, setMessagePreviewEnabled] = useState(true)
  const [callNotificationsEnabled, setCallNotificationsEnabled] = useState(true)
  const [ringtoneEnabled, setRingtoneEnabled] = useState(true)
  const [callVibrationEnabled, setCallVibrationEnabled] = useState(true)
  const [showCallerName, setShowCallerName] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState(profile?.display_name || '')
  const [editingBio, setEditingBio] = useState(false)
  const [newBio, setNewBio] = useState(profile?.bio || '')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [showLastSeen, setShowLastSeen] = useState(true)
  const [showProfilePhoto, setShowProfilePhoto] = useState(true)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [twoFactorFactors, setTwoFactorFactors] = useState<TOTPFactor[]>([])
  const [twoFactorLoading, setTwoFactorLoading] = useState(false)
  const [twoFactorEnrollment, setTwoFactorEnrollment] = useState<EnrollmentData | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorError, setTwoFactorError] = useState('')
  const [twoFactorStep, setTwoFactorStep] = useState<'idle' | 'enrolling' | 'verifying' | 'disabling'>('idle')
  const [showSecret, setShowSecret] = useState(false)
  const [enterToSend, setEnterToSend] = useState(true)
  const [autoDownloadWifi, setAutoDownloadWifi] = useState(true)
  const [autoDownloadMobile, setAutoDownloadMobile] = useState(false)
  const [autoDownloadPhotos, setAutoDownloadPhotos] = useState(true)
  const [autoDownloadVideos, setAutoDownloadVideos] = useState(false)
  const [autoDownloadFiles, setAutoDownloadFiles] = useState(true)
  const [autoDownloadAudio, setAutoDownloadAudio] = useState(true)
  
  const [storageStats, setStorageStats] = useState({
    total: 0,
    photos: 0,
    videos: 0,
    files: 0,
    audio: 0,
    loading: true
  })
  const [clearingStorage, setClearingStorage] = useState(false)
  
  const [backupSettings, setBackupSettings] = useState<BackupSettings>(getBackupSettings())
  const [lastBackupDate, setLastBackupDate] = useState<Date | null>(null)
  const [lastBackupSize, setLastBackupSize] = useState<number>(0)
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [backupProgress, setBackupProgress] = useState(0)
  const [backupStatus, setBackupStatus] = useState('')
  const [estimatedSize, setEstimatedSize] = useState<number>(0)
  const [backupPassword, setBackupPassword] = useState('')
  const [showPasswordInput, setShowPasswordInput] = useState(false)
  const [passwordAction, setPasswordAction] = useState<'backup' | 'restore' | 'light-backup'>('backup')
  const restoreFileRef = useRef<HTMLInputElement>(null)

  // Load storage stats and backup metadata
  useEffect(() => {
    loadStorageStats()
    loadBackupMetadata()
  }, [user])

  // Load 2FA status
  useEffect(() => {
    if (user) {
      load2FAStatus()
    }
  }, [user])

  const load2FAStatus = async () => {
    setTwoFactorLoading(true)
    try {
      const { enabled, factors } = await check2FAStatus()
      setTwoFactorEnabled(enabled)
      setTwoFactorFactors(factors)
    } catch (e) {
      console.error('Error loading 2FA status:', e)
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleStart2FAEnrollment = async () => {
    setTwoFactorLoading(true)
    setTwoFactorError('')
    setTwoFactorStep('enrolling')
    
    try {
      const result = await enroll2FA('Nephtys App')
      
      if (result.success && result.data) {
        setTwoFactorEnrollment(result.data)
        setTwoFactorStep('verifying')
      } else {
        setTwoFactorError(result.error || 'Erreur lors de l\'inscription')
        setTwoFactorStep('idle')
      }
    } catch (err: any) {
      setTwoFactorError(err.message || 'Erreur inattendue')
      setTwoFactorStep('idle')
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleVerify2FACode = async () => {
    if (!twoFactorEnrollment || twoFactorCode.length !== 6) return
    
    setTwoFactorLoading(true)
    setTwoFactorError('')
    
    try {
      const result = await verify2FAEnrollment(twoFactorEnrollment.id, twoFactorCode)
      
      if (result.success) {
        setTwoFactorEnabled(true)
        setTwoFactorEnrollment(null)
        setTwoFactorCode('')
        setTwoFactorStep('idle')
        await load2FAStatus()
        alert('✅ Authentification à deux facteurs activée !\n\nVotre compte est maintenant protégé.')
      } else {
        setTwoFactorError(result.error || 'Code invalide')
      }
    } catch (err: any) {
      setTwoFactorError(err.message || 'Erreur de vérification')
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleDisable2FA = async () => {
    if (twoFactorFactors.length === 0) return
    
    const confirmed = confirm(
      '⚠️ Désactiver l\'authentification à deux facteurs ?\n\n' +
      'Votre compte sera moins sécurisé sans cette protection supplémentaire.'
    )
    
    if (!confirmed) return
    
    setTwoFactorLoading(true)
    setTwoFactorError('')
    setTwoFactorStep('disabling')
    
    try {
      for (const factor of twoFactorFactors) {
        const result = await unenroll2FA(factor.id)
        if (!result.success) {
          throw new Error(result.error)
        }
      }
      
      setTwoFactorEnabled(false)
      setTwoFactorFactors([])
      setTwoFactorStep('idle')
      alert('✅ Authentification à deux facteurs désactivée')
    } catch (err: any) {
      setTwoFactorError(err.message || 'Erreur lors de la désactivation')
    } finally {
      setTwoFactorLoading(false)
      setTwoFactorStep('idle')
    }
  }

  const handleCancel2FAEnrollment = () => {
    setTwoFactorEnrollment(null)
    setTwoFactorCode('')
    setTwoFactorError('')
    setTwoFactorStep('idle')
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      alert('✅ Copié dans le presse-papiers')
    } catch (e) {
      console.error('Copy failed:', e)
    }
  }

  const loadBackupMetadata = () => {
    const metadata = getBackupMetadata()
    if (metadata.lastBackupDate) {
      setLastBackupDate(new Date(metadata.lastBackupDate))
    }
    setLastBackupSize(metadata.lastBackupSize)
  }

  useEffect(() => {
    if (user) {
      estimateBackupSizeDetailed(user.id, backupSettings).then(estimate => {
        setEstimatedSize(estimate.totalSize)
      })
    }
  }, [user, backupSettings.includeVideos, backupSettings.includeImages, backupSettings.includeAudio, backupSettings.includeFiles])

  const updateBackupSettings = (updates: Partial<BackupSettings>) => {
    const newSettings = { ...backupSettings, ...updates }
    setBackupSettings(newSettings)
    saveBackupSettings(newSettings)
  }

  const loadStorageStats = async () => {
    if (!user) return
    
    try {
      const { data: memberData } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)
      
      if (!memberData || memberData.length === 0) {
        setStorageStats({ total: 0, photos: 0, videos: 0, files: 0, audio: 0, loading: false })
        return
      }
      
      const conversationIds = memberData.map(m => m.conversation_id)
      
      const { data: messages } = await supabase
        .from('messages')
        .select('type, media_type, file_size')
        .in('conversation_id', conversationIds)
        .not('file_size', 'is', null)
      
      if (!messages) {
        setStorageStats({ total: 0, photos: 0, videos: 0, files: 0, audio: 0, loading: false })
        return
      }
      
      let photos = 0, videos = 0, files = 0, audio = 0
      
      messages.forEach(msg => {
        const size = msg.file_size || 0
        const type = msg.media_type || msg.type
        
        if (type === 'image') photos += size
        else if (type === 'video') videos += size
        else if (type === 'audio' || type === 'voice') audio += size
        else if (type === 'file') files += size
      })
      
      setStorageStats({
        total: photos + videos + files + audio,
        photos,
        videos,
        files,
        audio,
        loading: false
      })
    } catch (e) {
      console.error('Error loading storage stats:', e)
      setStorageStats({ total: 0, photos: 0, videos: 0, files: 0, audio: 0, loading: false })
    }
  }

  const handleClearStorage = async (type: 'all' | 'photos' | 'videos' | 'files' | 'audio') => {
    if (!user) return
    
    const typeLabel = getStorageTypeLabel(type)
    if (!confirm(`Voulez-vous vraiment supprimer ${typeLabel} en cache ?\n\nCette action est irréversible.`)) return
    
    setClearingStorage(true)
    try {
      const { data: memberData } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)
      
      if (!memberData) return
      
      const conversationIds = memberData.map(m => m.conversation_id)
      
      let query = supabase
        .from('messages')
        .update({ media_url: null, file_url: null, file_size: null })
        .in('conversation_id', conversationIds)
      
      const mediaTypeFilter = getMediaTypeFilter(type)
      if (mediaTypeFilter) {
        query = query.or(`media_type.eq.${mediaTypeFilter},type.eq.${mediaTypeFilter}`)
      }
      
      await query
      
      alert('✅ Cache vidé avec succès !')
      loadStorageStats()
    } catch (e) {
      console.error('Error clearing storage:', e)
      alert('❌ Erreur lors du vidage du cache')
    } finally {
      setClearingStorage(false)
    }
  }

  const handleSignOut = async () => {
    if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
      await signOut()
      navigate('/auth')
    }
  }

  const handleUpdateDisplayName = async () => {
    if (!user || !newDisplayName.trim()) return
    const trimmed = newDisplayName.trim()
    const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', user.id)
    if (!error) {
      setEditingName(false)
      updateLocalProfile({ display_name: trimmed })
    }
  }

  const handleUpdateBio = async () => {
    if (!user) return
    const trimmed = newBio.trim() || null
    const { error } = await supabase.from('profiles').update({ bio: trimmed }).eq('id', user.id)
    if (!error) {
      setEditingBio(false)
      updateLocalProfile({ bio: trimmed })
    }
  }

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    
    if (file.size > 5 * 1024 * 1024) {
      alert('❌ Fichier trop volumineux\n\nLa photo doit faire moins de 5 MB.')
      return
    }
    
    if (!file.type.startsWith('image/')) {
      alert('❌ Format invalide\n\nVeuillez sélectionner une image (JPG, PNG, etc.).')
      return
    }
    
    setUploadingPhoto(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `avatars/${user.id}/avatar-${Date.now()}.${fileExt}`
      
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true
        })
      
      if (uploadError) {
        console.error('Upload error:', uploadError)
        throw new Error('Erreur lors de l\'upload')
      }
      
      // On stocke le path nu en base (pas l'URL signée qui expire).
      // L'URL signée sera générée à la volée via getMediaUrl() au moment de l'affichage.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: fileName })
        .eq('id', user.id)
      
      if (updateError) {
        console.error('Profile update error:', updateError)
        throw new Error('Erreur lors de la mise à jour du profil')
      }
      
      // Invalider le cache pour qu'au reload la nouvelle photo apparaisse
      try { invalidateMediaUrl(fileName) } catch { /* ignore */ }
      alert('✅ Photo de profil mise à jour !')
      globalThis.location.reload()
    } catch (err: any) {
      console.error('Photo upload error:', err)
      alert(err.message || '❌ Erreur lors de l\'upload de la photo\n\nVeuillez réessayer.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!user) return
    const confirmation = prompt('Pour supprimer votre compte, tapez "SUPPRIMER" :')
    if (confirmation !== 'SUPPRIMER') return
    try {
      await supabase.from('messages').delete().eq('sender_id', user.id)
      await supabase.from('conversation_members').delete().eq('user_id', user.id)
      await supabase.from('contacts').delete().eq('user_id', user.id)
      await supabase.from('profiles').delete().eq('id', user.id)
      await signOut()
      navigate('/auth')
    } catch {
      alert('Erreur lors de la suppression du compte')
    }
  }

  // ============ RENDER HELPERS ============
  
  // Helper: Render 2FA loading state
  const render2FALoadingState = () => (
    <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={32} className="animate-spin text-accent mx-auto mb-4" />
        <p className="text-text-secondary">Chargement...</p>
      </div>
    </div>
  )

  // Helper: Render 2FA verifying state (QR code)
  const render2FAVerifyingState = () => {
    if (!twoFactorEnrollment) return null;
    
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-accent/20 flex items-center justify-center mb-4">
            <Smartphone size={32} className="text-accent" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            Configurer l'authentification
          </h3>
          <p className="text-sm text-text-secondary">
            Scannez ce QR code avec votre application d'authentification
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 mx-auto max-w-xs">
          <img src={twoFactorEnrollment.totp.qr_code} alt="QR Code 2FA" className="w-full h-auto" />
        </div>

        <div className="bg-bg-surface rounded-2xl p-4 space-y-3">
          <p className="text-sm text-text-secondary text-center">Ou entrez ce code manuellement :</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-bg-primary rounded-xl p-3 font-mono text-sm text-text-primary break-all">
              {showSecret ? twoFactorEnrollment.totp.secret : '••••••••••••••••'}
            </div>
            <button onClick={() => setShowSecret(!showSecret)} className="p-2 rounded-xl bg-bg-hover text-text-secondary hover:text-text-primary">
              {showSecret ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
            <button onClick={() => copyToClipboard(twoFactorEnrollment.totp.secret)} className="p-2 rounded-xl bg-bg-hover text-text-secondary hover:text-text-primary">
              <Copy size={20} />
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm text-text-secondary" htmlFor="2fa-code">Entrez le code à 6 chiffres de votre application :</label>
          <input
            id="2fa-code"
            type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={twoFactorCode}
            onChange={(e) => { const value = e.target.value.replaceAll(/\D/g, ''); setTwoFactorCode(value); setTwoFactorError(''); }}
            placeholder="000000"
            className="w-full px-4 py-4 bg-bg-surface rounded-2xl text-text-primary text-center text-2xl font-mono tracking-widest placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
            autoFocus
          />
          {twoFactorError && <p className="text-sm text-red-500 text-center">{twoFactorError}</p>}
        </div>

        <div className="flex gap-3">
          <button onClick={handleCancel2FAEnrollment} disabled={twoFactorLoading} className="flex-1 py-3 rounded-2xl bg-bg-surface text-text-primary font-medium hover:bg-bg-hover transition-colors">
            Annuler
          </button>
          <button onClick={handleVerify2FACode} disabled={twoFactorLoading || twoFactorCode.length !== 6} className="flex-1 py-3 rounded-2xl bg-accent text-white font-medium hover:bg-[#5a5ec9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {twoFactorLoading ? <><Loader2 size={18} className="animate-spin" />Vérification...</> : 'Vérifier'}
          </button>
        </div>

        <div className="bg-bg-surface rounded-2xl p-4">
          <p className="text-sm text-text-secondary mb-2">Applications recommandées (open source) :</p>
          <ul className="text-sm text-text-primary space-y-1">
            <li>• <strong>Aegis Authenticator</strong> (Android) - Open source</li>
            <li>• <strong>FreeOTP+</strong> (Android) - Open source, Red Hat</li>
            <li>• <strong>KeePassXC</strong> (Windows, Mac, Linux) - Open source, européen</li>
            <li>• <strong>Bitwarden</strong> (Android, PC) - Open source</li>
          </ul>
          <p className="text-xs text-text-secondary mt-3">💡 Ces applications respectent votre vie privée et fonctionnent hors ligne.</p>
        </div>
      </div>
    )
  }

  // Helper: Render 2FA main state
  const render2FAMainState = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="bg-bg-surface rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${twoFactorEnabled ? 'bg-green-500/20' : 'bg-bg-hover'}`}>
              <Shield size={24} className={twoFactorEnabled ? 'text-green-500' : 'text-text-secondary'} />
            </div>
            <div>
              <div className="text-text-primary font-medium">Authentification à deux facteurs</div>
              <div className={`text-sm ${twoFactorEnabled ? 'text-green-500' : 'text-text-secondary'}`}>
                {twoFactorEnabled ? '✓ Activée' : 'Désactivée'}
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-text-secondary">
          {twoFactorEnabled
            ? 'Votre compte est protégé par une authentification à deux facteurs. Un code de vérification sera demandé à chaque connexion.'
            : 'Ajoutez une couche de sécurité supplémentaire à votre compte en activant l\'authentification à deux facteurs.'}
        </p>

        {twoFactorEnabled ? (
          <button onClick={handleDisable2FA} disabled={twoFactorLoading} className="w-full py-3 rounded-2xl bg-red-500/10 text-red-500 font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2">
            {twoFactorLoading && twoFactorStep === 'disabling' ? <><Loader2 size={18} className="animate-spin" />Désactivation...</> : <><X size={18} />Désactiver l'authentification 2FA</>}
          </button>
        ) : (
          <button onClick={handleStart2FAEnrollment} disabled={twoFactorLoading} className="w-full py-3 px-4 rounded-2xl bg-accent text-white font-medium hover:bg-[#5a5ec9] transition-colors flex items-center justify-center gap-2">
            {twoFactorLoading && twoFactorStep === 'enrolling' ? <><Loader2 size={18} className="animate-spin flex-shrink-0" /><span>Configuration...</span></> : <><Smartphone size={18} className="flex-shrink-0" /><span>Configurer l'application d'authentification</span></>}
          </button>
        )}

        {twoFactorError && twoFactorStep === 'idle' && <p className="text-sm text-red-500 text-center">{twoFactorError}</p>}
      </div>

      <div className="bg-bg-surface rounded-2xl p-6 space-y-4">
        <h4 className="text-text-primary font-medium">Comment ça fonctionne ?</h4>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-accent text-sm font-medium">1</span></div>
            <p className="text-sm text-text-secondary">Téléchargez une application d'authentification open source (Aegis, FreeOTP+, Tofu, etc.)</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-accent text-sm font-medium">2</span></div>
            <p className="text-sm text-text-secondary">Scannez le QR code avec l'application pour lier votre compte</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-accent text-sm font-medium">3</span></div>
            <p className="text-sm text-text-secondary">À chaque connexion, entrez le code à 6 chiffres généré par l'application</p>
          </div>
        </div>
      </div>

      <div className="bg-accent/10 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <Lock size={20} className="text-accent flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-text-primary font-medium mb-1">Sécurité renforcée</p>
            <p className="text-xs text-text-secondary">L'authentification à deux facteurs protège votre compte même si votre mot de passe est compromis.</p>
          </div>
        </div>
      </div>
    </div>
  )

  // Main 2FA view using helpers
  const render2FAView = () => {
    if (twoFactorLoading && twoFactorStep === 'idle') return render2FALoadingState()
    if (twoFactorStep === 'verifying' && twoFactorEnrollment) return render2FAVerifyingState()
    return render2FAMainState()
  }

  const mainSettings = [
    { icon: User, label: 'Profil', subtitle: profile?.display_name || profile?.username, view: 'profile' as SettingsView },
    { icon: Key, label: 'Compte', subtitle: 'Confidentialité, sécurité', view: 'account' as SettingsView },
    { icon: MessageSquare, label: 'Discussions', subtitle: 'Thème, fonds d\'écran', view: 'discussions' as SettingsView },
    { icon: Bell, label: 'Notifications', subtitle: 'Sons, vibrations', view: 'notifications' as SettingsView },
    { icon: Database, label: 'Stockage et données', subtitle: 'Utilisation réseau', view: 'storage' as SettingsView },
    { icon: Cloud, label: 'Sauvegarde', subtitle: 'Proton Drive', view: 'backup' as SettingsView },
    { icon: HelpCircle, label: 'Aide', subtitle: 'FAQ, nous contacter', view: 'help' as SettingsView },
  ]

  const renderMainView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <button
        type="button"
        className="w-full bg-bg-surface px-6 py-8 cursor-pointer hover:bg-bg-hover transition-colors text-left"
        onClick={() => setCurrentView('profile')}
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <MediaImg
              src={profile?.avatar_url}
              alt={profile?.username || ''}
              className="w-16 h-16 rounded-full object-cover"
              fallback={
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl">
                  {profile?.username?.[0]?.toUpperCase()}
                </div>
              }
            />
            <label className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center cursor-pointer hover:bg-[#5a5ec9]">
              <Camera size={14} className="text-white" />
              <input type="file" accept="image/*" onChange={handleUploadPhoto} className="hidden" disabled={uploadingPhoto} aria-label="Changer la photo de profil" />
            </label>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-medium text-text-primary">{profile?.display_name || profile?.username}</h2>
            <p className="text-sm text-text-secondary">@{profile?.username}</p>
            {profile?.bio && <p className="text-sm text-text-secondary mt-1 italic">"{profile.bio}"</p>}
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </div>
      </button>
      <div className="py-2">
        {mainSettings.map((setting) => (
          <button key={setting.view} onClick={() => setCurrentView(setting.view)} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
            <setting.icon size={24} className="text-text-secondary" />
            <div className="flex-1 text-left">
              <div className="text-text-primary font-normal">{setting.label}</div>
              <div className="text-sm text-text-secondary">{setting.subtitle}</div>
            </div>
            <ChevronRight size={20} className="text-text-secondary" />
          </button>
        ))}
      </div>
      <div className="px-6 py-8 text-center space-y-2">
        <p className="text-sm text-text-secondary">Nephtys optimisé pour JemaOS</p>
        <p className="text-xs text-text-secondary">Version 1.1.0</p>
      </div>
      <div className="px-6 pb-8">
        <button onClick={handleSignOut} className="w-full py-3 rounded-2xl bg-bg-surface hover:bg-bg-hover text-[#ea4335] font-medium transition-colors flex items-center justify-center gap-2">
          <LogOut size={20} />Se déconnecter
        </button>
      </div>
    </div>
  )

  const renderProfileView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="px-6 py-8 space-y-6">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <MediaImg
              src={profile?.avatar_url}
              alt={profile?.username || ''}
              className="w-32 h-32 rounded-full object-cover"
              fallback={
                <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-5xl">
                  {profile?.username?.[0]?.toUpperCase()}
                </div>
              }
            />
            <label className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-accent flex items-center justify-center hover:bg-[#5a5ec9] transition-colors cursor-pointer">
              <Camera size={20} className="text-white" />
              <input type="file" accept="image/*" onChange={handleUploadPhoto} className="hidden" disabled={uploadingPhoto} aria-label="Changer la photo de profil" />
            </label>
          </div>
          <p className="text-sm text-text-secondary">Modifier la photo de profil</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-accent" htmlFor="profile-name">Nom</label>
          <div className="flex items-center gap-3 p-4 bg-bg-surface rounded-2xl">
            <input id="profile-name" type="text" value={editingName ? newDisplayName : (profile?.display_name || profile?.username)} onChange={(e) => setNewDisplayName(e.target.value)} onFocus={() => setEditingName(true)} className="flex-1 bg-transparent text-text-primary outline-none" aria-label="Nom" />
            {editingName ? <button onClick={handleUpdateDisplayName} className="text-accent"><Check size={18} /></button> : <Edit2 size={18} className="text-text-secondary" />}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-accent">Nom d'utilisateur</p>
          <div className="p-4 bg-bg-surface rounded-2xl"><p className="text-text-primary">@{profile?.username}</p></div>
          <p className="text-xs text-text-secondary">Le nom d'utilisateur ne peut pas être modifié</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-accent" htmlFor="profile-bio">Info</label>
          <div className="flex items-center gap-3 p-4 bg-bg-surface rounded-2xl">
            <input id="profile-bio" type="text" placeholder="Ajouter une info..." value={editingBio ? newBio : (profile?.bio || '')} onChange={(e) => setNewBio(e.target.value)} onFocus={() => { setEditingBio(true); setNewBio(profile?.bio || ''); }} className="flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-secondary" aria-label="Info" />
            {editingBio ? <button onClick={handleUpdateBio} className="text-accent"><Check size={18} /></button> : <Edit2 size={18} className="text-text-secondary" />}
          </div>
          {profile?.bio && !editingBio && <p className="text-xs text-text-secondary px-1">Votre info actuelle : "{profile.bio}"</p>}
        </div>
      </div>
    </div>
  )

  const renderAccountView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <button onClick={() => setCurrentView('privacy')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Shield size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Confidentialité</div>
            <div className="text-sm text-text-secondary">Dernière connexion, photo de profil</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('security')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Lock size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Sécurité</div>
            <div className="text-sm text-text-secondary">Chiffrement de bout en bout</div>
          </div>
          <div className="flex items-center gap-2"><Check size={16} className="text-accent" /><span className="text-sm text-accent">Activé</span></div>
        </button>
        <button onClick={() => setCurrentView('2fa')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Key size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Authentification à deux facteurs</div>
            <div className="text-sm text-text-secondary">{twoFactorEnabled ? 'Activée' : 'Désactivée'}</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('delete')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Trash2 size={24} className="text-[#ea4335]" />
          <div className="flex-1 text-left">
            <div className="text-[#ea4335]">Supprimer le compte</div>
            <div className="text-sm text-text-secondary">Suppression définitive de toutes vos données</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
      </div>
    </div>
  )

  const renderPrivacyView = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-text-primary">Dernière connexion</div>
            <div className="text-sm text-text-secondary">Qui peut voir quand vous êtes en ligne</div>
          </div>
          <button onClick={() => setShowLastSeen(!showLastSeen)} className={`w-12 h-6 rounded-full relative transition-colors ${showLastSeen ? 'bg-accent' : 'bg-[#8696a0]'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showLastSeen ? 'right-1' : 'left-1'}`}></div>
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-text-primary">Photo de profil</div>
            <div className="text-sm text-text-secondary">Qui peut voir votre photo</div>
          </div>
          <button onClick={() => setShowProfilePhoto(!showProfilePhoto)} className={`w-12 h-6 rounded-full relative transition-colors ${showProfilePhoto ? 'bg-accent' : 'bg-[#8696a0]'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showProfilePhoto ? 'right-1' : 'left-1'}`}></div>
          </button>
        </div>
      </div>
    </div>
  )

  const renderSecurityView = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="bg-bg-surface rounded-2xl p-6 text-center space-y-4">
        <div className="w-20 h-20 mx-auto rounded-full bg-accent/20 flex items-center justify-center">
          <Lock size={40} className="text-accent" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">Chiffrement activé</h3>
          <p className="text-sm text-text-secondary">Tous vos messages et appels sont chiffrés de bout en bout. Personne, pas même Nephtys, ne peut y accéder.</p>
        </div>
        <div className="pt-4 border-t border-bg-hover">
          <p className="text-xs text-text-secondary">Protocole : Signal Protocol (E2EE)</p>
        </div>
      </div>
    </div>
  )

  const renderDeleteView = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="bg-bg-surface rounded-2xl p-6 space-y-6">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-[#ea4335]/20 flex items-center justify-center mb-4">
            <Trash2 size={40} className="text-[#ea4335]" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">Supprimer le compte</h3>
          <p className="text-sm text-text-secondary">Cette action est irréversible. Toutes vos données seront définitivement supprimées.</p>
        </div>
        <div className="space-y-3 text-sm text-text-secondary">
          <p>• Tous vos messages seront supprimés</p>
          <p>• Toutes vos conversations seront fermées</p>
          <p>• Tous vos contacts seront perdus</p>
          <p>• Votre profil sera définitivement effacé</p>
        </div>
        <button onClick={handleDeleteAccount} className="w-full py-3 rounded-xl bg-[#ea4335] hover:bg-[#d33b2f] text-white font-medium">
          Supprimer définitivement mon compte
        </button>
      </div>
    </div>
  )

  const renderDiscussionsView = () => (
    <div className="flex-1 overflow-y-auto">
      <div className="py-2">
        <div className="px-6 py-4">
          <h3 className="text-sm text-accent mb-4">Affichage</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-text-primary">Thème</span>
              <div className="flex gap-2">
                {[
                  { value: 'light', icon: Sun, label: 'Clair' },
                  { value: 'dark', icon: Moon, label: 'Sombre' }
                ].map((t) => (
                  <button key={t.value} onClick={() => setTheme(t.value as any)} className={`p-2 rounded-xl transition-colors ${theme === t.value ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'}`}>
                    <t.icon size={20} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <button onClick={() => setCurrentView('wallpaper')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Palette size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Fond d'écran</div>
            <div className="text-sm text-text-secondary">Par défaut</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <div className="px-6 py-4">
          <h3 className="text-sm text-accent mb-4">Options de discussion</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Touche Entrée pour envoyer</div>
              <div className="text-sm text-text-secondary">Envoyer avec Entrée</div>
            </div>
            <button onClick={() => setEnterToSend(!enterToSend)} className={`w-12 h-6 rounded-full relative transition-colors ${enterToSend ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${enterToSend ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderWallpaperView = () => {
    const wallpaperOptions = [
      { value: 'default' as const, label: 'Par défaut', style: {} },
      { value: 'dark' as const, label: 'Sombre', style: { backgroundColor: '#000000' } },
      { value: 'light' as const, label: 'Clair', style: { backgroundColor: '#e5ddd5' } },
      { value: 'gradient' as const, label: 'Dégradé', style: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' } },
    ]
    
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-4">
          {wallpaperOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setWallpaper(option.value)}
              className={`aspect-video rounded-2xl transition-all flex items-center justify-center relative overflow-hidden border-2 ${
                wallpaper === option.value ? 'border-accent ring-2 ring-accent/30' : 'border-transparent hover:border-bg-hover'
              }`}
              style={option.value === 'default' ? { backgroundColor: 'var(--bg-surface)' } : option.style}
            >
              <span className={`text-sm font-medium ${option.value === 'dark' || option.value === 'gradient' ? 'text-white' : 'text-text-primary'}`}>
                {option.label}
              </span>
              {wallpaper === option.value && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                  <Check size={14} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const renderNotificationsView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Notifications</div>
              <div className="text-sm text-text-secondary">Activer les notifications</div>
            </div>
            <button onClick={() => setNotificationsEnabled(!notificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${notificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${notificationsEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Sons</div>
              <div className="text-sm text-text-secondary">Sons de notification</div>
            </div>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${soundEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${soundEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
        </div>
        <button onClick={() => setCurrentView('message-notif')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <MessageSquare size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Notifications de messages</div>
            <div className="text-sm text-text-secondary">Son, vibration</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('call-notif')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Video size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Notifications d'appels</div>
            <div className="text-sm text-text-secondary">Sonnerie, vibration</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
      </div>
    </div>
  )

  const renderMessageNotifView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Notifications de messages</div><div className="text-sm text-text-secondary">Afficher les notifications pour les nouveaux messages</div></div>
            <button onClick={() => setNotificationsEnabled(!notificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${notificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${notificationsEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Son de notification</div><div className="text-sm text-text-secondary">Jouer un son pour les nouveaux messages</div></div>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${soundEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${soundEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Vibration</div><div className="text-sm text-text-secondary">Vibrer pour les nouveaux messages</div></div>
            <button onClick={() => setVibrationEnabled(!vibrationEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${vibrationEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${vibrationEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Aperçu du message</div><div className="text-sm text-text-secondary">Afficher le contenu dans la notification</div></div>
            <button onClick={() => setMessagePreviewEnabled(!messagePreviewEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${messagePreviewEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${messagePreviewEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderCallNotifView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Notifications d'appels</div><div className="text-sm text-text-secondary">Afficher les notifications pour les appels entrants</div></div>
            <button onClick={() => setCallNotificationsEnabled(!callNotificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${callNotificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${callNotificationsEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Sonnerie</div><div className="text-sm text-text-secondary">Jouer une sonnerie pour les appels entrants</div></div>
            <button onClick={() => setRingtoneEnabled(!ringtoneEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${ringtoneEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${ringtoneEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Vibration</div><div className="text-sm text-text-secondary">Vibrer pour les appels entrants</div></div>
            <button onClick={() => setCallVibrationEnabled(!callVibrationEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${callVibrationEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${callVibrationEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">Afficher le nom de l'appelant</div><div className="text-sm text-text-secondary">Afficher qui appelle dans la notification</div></div>
            <button onClick={() => setShowCallerName(!showCallerName)} className={`w-12 h-6 rounded-full relative transition-colors ${showCallerName ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showCallerName ? 'right-1' : 'left-1'}`}></div></button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderStorageView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-6 bg-bg-surface mx-4 rounded-2xl mb-4">
          <div className="text-center space-y-3">
            <Database size={48} className="mx-auto text-accent" />
            {storageStats.loading ? (
              <Loader2 size={24} className="mx-auto animate-spin text-accent" />
            ) : (
              <>
                <div className="text-3xl font-bold text-text-primary">{formatBytes(storageStats.total)}</div>
                <div className="text-sm text-text-secondary">Espace utilisé</div>
              </>
            )}
          </div>
        </div>

        {!storageStats.loading && storageStats.total > 0 && (
          <div className="px-4 mb-4">
            <div className="bg-bg-surface rounded-2xl p-4 space-y-3">
              <h3 className="text-sm text-accent font-medium mb-3">Répartition</h3>
              
              {storageStats.photos > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><Image size={20} className="text-blue-400" /><span className="text-text-primary">Photos</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.photos)}</span><button onClick={() => handleClearStorage('photos')} disabled={clearingStorage} className="text-xs text-accent hover:underline">Vider</button></div>
                </div>
              )}
              {storageStats.videos > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><Video size={20} className="text-purple-400" /><span className="text-text-primary">Vidéos</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.videos)}</span><button onClick={() => handleClearStorage('videos')} disabled={clearingStorage} className="text-xs text-accent hover:underline">Vider</button></div>
                </div>
              )}
              {storageStats.audio > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><Mic size={20} className="text-green-400" /><span className="text-text-primary">Messages vocaux</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.audio)}</span><button onClick={() => handleClearStorage('audio')} disabled={clearingStorage} className="text-xs text-accent hover:underline">Vider</button></div>
                </div>
              )}
              {storageStats.files > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><FileText size={20} className="text-orange-400" /><span className="text-text-primary">Fichiers</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.files)}</span><button onClick={() => handleClearStorage('files')} disabled={clearingStorage} className="text-xs text-accent hover:underline">Vider</button></div>
                </div>
              )}
              
              <div className="pt-3 border-t border-bg-hover">
                <button onClick={() => handleClearStorage('all')} disabled={clearingStorage} className="w-full py-2 rounded-xl bg-red-500/10 text-red-500 text-sm font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2">
                  {clearingStorage ? <><Loader2 size={16} className="animate-spin" />Suppression...</> : <><Trash2 size={16} />Vider tout le cache</>}
                </button>
              </div>
            </div>
          </div>
        )}

        <button onClick={() => setCurrentView('network')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Globe size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Utilisation des données</div>
            <div className="text-sm text-text-secondary">Téléchargement automatique</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
      </div>
    </div>
  )

  const renderNetworkView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2"><Wifi size={16} />Connexion Wi-Fi</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div><div className="text-text-primary">Téléchargement automatique</div><div className="text-sm text-text-secondary">Télécharger les médias en Wi-Fi</div></div>
              <button onClick={() => setAutoDownloadWifi(!autoDownloadWifi)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadWifi ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadWifi ? 'right-1' : 'left-1'}`}></div></button>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-bg-hover">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2"><WifiOff size={16} />Données mobiles</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div><div className="text-text-primary">Téléchargement automatique</div><div className="text-sm text-text-secondary">Télécharger avec données mobiles</div></div>
              <button onClick={() => setAutoDownloadMobile(!autoDownloadMobile)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadMobile ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadMobile ? 'right-1' : 'left-1'}`}></div></button>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-bg-hover">
          <h3 className="text-sm text-accent mb-4">Types de médias</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Image size={20} className="text-blue-400" /><span className="text-text-primary">Photos</span></div>
              <button onClick={() => setAutoDownloadPhotos(!autoDownloadPhotos)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadPhotos ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadPhotos ? 'right-1' : 'left-1'}`}></div></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Video size={20} className="text-purple-400" /><span className="text-text-primary">Vidéos</span></div>
              <button onClick={() => setAutoDownloadVideos(!autoDownloadVideos)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadVideos ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadVideos ? 'right-1' : 'left-1'}`}></div></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Mic size={20} className="text-green-400" /><span className="text-text-primary">Messages vocaux</span></div>
              <button onClick={() => setAutoDownloadAudio(!autoDownloadAudio)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadAudio ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadAudio ? 'right-1' : 'left-1'}`}></div></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><FileText size={20} className="text-orange-400" /><span className="text-text-primary">Fichiers</span></div>
              <button onClick={() => setAutoDownloadFiles(!autoDownloadFiles)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadFiles ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadFiles ? 'right-1' : 'left-1'}`}></div></button>
            </div>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-text-secondary">Les paramètres de téléchargement automatique déterminent quand les médias sont téléchargés automatiquement.</p>
        </div>
      </div>
    </div>
  )

  const renderHelpView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <button onClick={() => setCurrentView('faq')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <HelpCircle size={24} className="text-text-secondary" />
          <div className="flex-1 text-left"><div className="text-text-primary">FAQ</div><div className="text-sm text-text-secondary">Questions fréquentes</div></div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('contact')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Mail size={24} className="text-text-secondary" />
          <div className="flex-1 text-left"><div className="text-text-primary">Nous contacter</div><div className="text-sm text-text-secondary">Support technique</div></div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('terms')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Info size={24} className="text-text-secondary" />
          <div className="flex-1 text-left"><div className="text-text-primary">Conditions et politique de confidentialité</div></div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <div className="px-6 py-8 text-center space-y-2">
          <p className="text-sm text-text-secondary">Nephtys optimisé pour JemaOS</p>
          <p className="text-xs text-text-secondary">Version 1.1.0</p>
          <p className="text-xs text-text-secondary mt-4">© 2025 Nephtys. Tous droits réservés.</p>
        </div>
      </div>
    </div>
  )

  const renderFAQView = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {[
        { q: 'Comment fonctionne le chiffrement ?', a: 'Nephtys utilise le protocole Signal pour chiffrer vos messages de bout en bout.' },
        { q: 'Mes données sont-elles sauvegardées ?', a: 'En mode normal oui, en mode éphémère non. Tout est supprimé à la déconnexion.' },
        { q: 'Puis-je utiliser Nephtys sur plusieurs appareils ?', a: 'Oui, jusqu\'à 4 appareils simultanément.' },
      ].map((faq, index) => (
        <div key={faq.q} className="bg-bg-surface rounded-2xl p-4">
          <h4 className="text-text-primary font-medium mb-2">{faq.q}</h4>
          <p className="text-sm text-text-secondary">{faq.a}</p>
        </div>
      ))}
    </div>
  )

  const renderContactView = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="bg-bg-surface rounded-2xl p-6 text-center space-y-4">
        <Mail size={48} className="mx-auto text-accent" />
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">Contactez-nous</h3>
          <p className="text-sm text-text-secondary mb-4">Notre équipe est là pour vous aider</p>
        </div>
        <div className="space-y-3">
          <a href="mailto:contact@jematechnology.fr" className="block py-3 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium">contact@jematechnology.fr</a>
        </div>
      </div>
    </div>
  )

  const renderTermsView = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="bg-bg-surface rounded-2xl p-6 space-y-4 text-sm text-text-secondary">
        <h3 className="text-lg font-semibold text-text-primary">Politique de confidentialité</h3>
        <p>Nephtys respecte votre vie privée. Nous ne collectons aucune donnée personnelle.</p>
        <p>• Aucun tracking</p>
        <p>• Aucune publicité</p>
        <p>• Aucun log des conversations</p>
        <p>• Chiffrement de bout en bout par défaut</p>
      </div>
    </div>
  )

  const handleBackup = async (isLightBackup: boolean = false) => {
    if (!user) return
    
    if (!backupPassword) {
      setPasswordAction(isLightBackup ? 'light-backup' : 'backup')
      setShowPasswordInput(true)
      return
    }
    
    setIsBackingUp(true)
    setBackupProgress(0)
    setBackupStatus('Démarrage de la sauvegarde...')
    
    try {
      const { data: backupData, size } = isLightBackup
        ? await createLightBackup(user.id, (progress, status) => { setBackupProgress(progress); setBackupStatus(status); })
        : await createBackup(user.id, backupSettings, (progress, status) => { setBackupProgress(progress); setBackupStatus(status); })
      
      setBackupStatus('Chiffrement et téléchargement...')
      await exportBackupAsFile(backupData, backupPassword)
      
      const now = new Date()
      setLastBackupDate(now)
      setLastBackupSize(size)
      saveBackupMetadata({ lastBackupDate: now.toISOString(), lastBackupSize: size, backupCount: (getBackupMetadata().backupCount || 0) + 1 })
      updateBackupSettings({ lastBackupDate: now.toISOString(), lastBackupSize: size })
      
      setBackupPassword('')
      setShowPasswordInput(false)
      alert('✅ Sauvegarde terminée avec succès !\n\nLe fichier a été téléchargé. Vous pouvez maintenant l\'uploader sur Proton Drive.')
    } catch (err: any) {
      console.error('Backup error:', err)
      alert('❌ Erreur lors de la sauvegarde\n\n' + (err.message || 'Veuillez réessayer.'))
    } finally {
      setIsBackingUp(false)
      setBackupProgress(0)
      setBackupStatus('')
    }
  }

  const handleRestore = async (file: File) => {
    if (!user) return
    
    if (!backupPassword) {
      setPasswordAction('restore')
      setShowPasswordInput(true)
      return
    }
    
    setIsRestoring(true)
    setBackupProgress(0)
    setBackupStatus('Lecture du fichier...')
    
    try {
      const backupData = await importBackupFromFile(file, backupPassword)
      
      if (!backupData) throw new Error('Impossible de lire le fichier de sauvegarde')
      
      const confirmRestore = confirm(
        `Voulez-vous restaurer cette sauvegarde ?\n\nDate de création : ${new Date(backupData.createdAt).toLocaleDateString('fr-FR')}\nMessages : ${backupData.messages.length}\nConversations : ${backupData.conversations.length}\n\n⚠️ Cette action peut écraser certaines données existantes.`
      )
      
      if (!confirmRestore) { setIsRestoring(false); return }
      
      const result = await restoreBackup(backupData, user.id, (progress, status) => { setBackupProgress(progress); setBackupStatus(status); })
      
      if (result.success) {
        setBackupPassword('')
        setShowPasswordInput(false)
        alert(`✅ Restauration terminée avec succès !\n\nL'application va se recharger.`)
        globalThis.location.reload()
      } else {
        throw new Error(result.error || 'Erreur lors de la restauration')
      }
    } catch (err: any) {
      console.error('Restore error:', err)
      alert('❌ Erreur lors de la restauration\n\n' + (err.message || 'Veuillez réessayer.'))
    } finally {
      setIsRestoring(false)
      setBackupProgress(0)
      setBackupStatus('')
    }
  }

  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.neph')) { alert('❌ Format de fichier invalide\n\nVeuillez sélectionner un fichier .neph'); return }
      handleRestore(file)
    }
  }

// ============ BACKUP VIEW HELPERS ============
// All helper components are defined in SettingsPageComponents.tsx to reduce file complexity

  const renderBackupView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        {showPasswordInput && (
          <BackupPasswordDialogComponent
            passwordAction={passwordAction}
            backupPassword={backupPassword}
            setBackupPassword={setBackupPassword}
            setShowPasswordInput={setShowPasswordInput}
            handleBackup={handleBackup}
          />
        )}

        {(isBackingUp || isRestoring) && (
          <BackupProgressDisplayComponent
            isBackingUp={isBackingUp}
            isRestoring={isRestoring}
            backupStatus={backupStatus}
            backupProgress={backupProgress}
          />
        )}

        <div className="px-6 py-4">
          <div className="text-text-secondary text-sm mb-4">
            <h3 className="text-accent font-medium mb-2">Paramètres de la sauvegarde</h3>
            <p>
              Sauvegardez vos discussions et vos médias dans un fichier chiffré. 
              Vous pourrez ensuite l'uploader sur Proton Drive et le restaurer sur un nouvel appareil.
            </p>
          </div>
        </div>

        <BackupInfoDisplayComponent
          lastBackupDate={lastBackupDate}
          lastBackupSize={lastBackupSize}
          estimatedSize={estimatedSize}
        />

        <div className="px-6 py-4 space-y-3">
          <button
            onClick={() => { setPasswordAction('backup'); setShowPasswordInput(true); }}
            disabled={isBackingUp || isRestoring}
            className={`w-full py-3 rounded-2xl font-medium transition-colors flex items-center justify-center gap-2 ${isBackingUp || isRestoring ? 'bg-accent/50 text-white/70 cursor-not-allowed' : 'bg-accent hover:bg-[#5a5ec9] text-white'}`}
          >
            <CloudUpload size={20} />Créer une sauvegarde complète
          </button>
          <button
            onClick={() => { setPasswordAction('light-backup'); setShowPasswordInput(true); }}
            disabled={isBackingUp || isRestoring}
            className={`w-full py-3 rounded-2xl font-medium transition-colors flex items-center justify-center gap-2 ${isBackingUp || isRestoring ? 'bg-bg-surface/50 text-text-secondary cursor-not-allowed' : 'bg-bg-surface hover:bg-bg-hover text-text-primary'}`}
          >
            <FileText size={20} />Sauvegarde légère (texte uniquement)
          </button>
          <p className="text-xs text-text-secondary text-center">
            La sauvegarde légère n'inclut pas les médias
          </p>
        </div>

        <div className="px-6 py-2">
          <input 
            type="file" 
            accept=".neph" 
            onChange={handleRestoreFileSelect} 
            className="hidden" 
            ref={restoreFileRef}
            aria-label="Sélectionner un fichier de sauvegarde"
          />
          <button 
            onClick={() => restoreFileRef.current?.click()} 
            disabled={isBackingUp || isRestoring} 
            className={`w-full py-3 rounded-2xl font-medium transition-colors flex items-center justify-center gap-2 ${isBackingUp || isRestoring ? 'bg-bg-surface/50 text-text-secondary cursor-not-allowed' : 'bg-bg-surface hover:bg-bg-hover text-text-primary'}`}
          >
            <DownloadCloud size={20} />Restaurer une sauvegarde
          </button>
        </div>

        <ProtonDriveRecommendationComponent />

        <div className="px-6 py-4 border-t border-bg-hover">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-text-primary">Fréquence de rappel</div>
              <div className="text-text-secondary text-sm">
                {(() => {
                  if (backupSettings.frequency === 'daily') return 'Tous les jours'
                  if (backupSettings.frequency === 'weekly') return 'Toutes les semaines'
                  return 'Tous les mois'
                })()}
              </div>
            </div>
            <select 
              value={backupSettings.frequency} 
              onChange={(e) => updateBackupSettings({ frequency: e.target.value as 'daily' | 'weekly' | 'monthly' })} 
              className="bg-bg-surface text-text-primary px-3 py-2 rounded-xl border border-bg-hover focus:outline-none focus:border-accent"
              aria-label="Fréquence de rappel"
            >
              <option value="daily">Tous les jours</option>
              <option value="weekly">Toutes les semaines</option>
              <option value="monthly">Tous les mois</option>
            </select>
          </div>
        </div>

        <BackupSettingToggleComponent
          label="Inclure les images"
          description="Photos et images partagées"
          value={backupSettings.includeImages}
          onChange={(v) => updateBackupSettings({ includeImages: v })}
        />

        <BackupSettingToggleComponent
          label="Inclure les vidéos"
          description="Les vidéos peuvent augmenter la taille de la sauvegarde"
          value={backupSettings.includeVideos}
          onChange={(v) => updateBackupSettings({ includeVideos: v })}
        />

        <BackupSettingToggleComponent
          label="Inclure les messages vocaux"
          description="Messages vocaux et fichiers audio"
          value={backupSettings.includeAudio}
          onChange={(v) => updateBackupSettings({ includeAudio: v })}
        />

        <BackupSettingToggleComponent
          label="Inclure les fichiers"
          description="Documents, PDF et autres fichiers"
          value={backupSettings.includeFiles}
          onChange={(v) => updateBackupSettings({ includeFiles: v })}
        />

        <BackupSecurityInfoComponent />
      </div>
    </div>
  )

  const views: Record<SettingsView, () => JSX.Element> = {
    main: renderMainView,
    profile: renderProfileView,
    account: renderAccountView,
    privacy: renderPrivacyView,
    security: renderSecurityView,
    '2fa': render2FAView,
    delete: renderDeleteView,
    discussions: renderDiscussionsView,
    wallpaper: renderWallpaperView,
    notifications: renderNotificationsView,
    'message-notif': renderMessageNotifView,
    'call-notif': renderCallNotifView,
    storage: renderStorageView,
    network: renderNetworkView,
    help: renderHelpView,
    faq: renderFAQView,
    contact: renderContactView,
    terms: renderTermsView,
    backup: renderBackupView,
  }

  const handleBack = () => {
    setCurrentView(getParentView(currentView))
  }

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-20 md:pb-0 overflow-hidden">
        <div className="bg-bg-surface px-4 py-3 flex items-center gap-4">
          {currentView !== 'main' && (
            <button onClick={handleBack} className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
              <ArrowLeft size={20} />
            </button>
          )}
          <h1 className="text-xl font-medium text-text-primary">{getViewTitle(currentView)}</h1>
        </div>
        {views[currentView]()}
      </div>
    </MainLayout>
  )
}
