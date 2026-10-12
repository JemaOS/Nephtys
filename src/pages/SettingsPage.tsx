// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { useAuth } from '@/context/AuthContext'
import { verifyCurrentPhrase, validateRecoveryPhrase } from '@/lib/recovery/recoveryService'
import { useTheme } from '@/context/ThemeContext'
import { supabase } from '@/lib/supabase'
import { MediaImg } from '@/components/MediaImg'
import { invalidateMediaUrl } from '@/lib/mediaUrl'
import { deleteMyMessages } from '@/lib/conversationService'
import { LanguageSelector } from '@/components/LanguageSelector'
import { useI18n, getLocale } from '@/i18n'
import { offlineStorage } from '@/lib/offlineStorage'
import { usePersistentPref } from '@/lib/prefs'
import {
  check2FAStatus,
  enroll2FA,
  verify2FAEnrollment,
  unenroll2FA,
  type TOTPFactor,
  type EnrollmentData
} from '@/lib/twoFactorAuth'
import {
  isTorRelayEnabled,
  setTorRelayEnabled,
  isTorAvailable,
  getRelayUrl,
  setRelayUrl,
  getRelayPoolInput,
  setRelayPool,
  getRelayMode,
  setRelayMode as saveRelayMode,
  getAvailableRelays,
  type RelayMode,
  isDecentralizedRelayEnabled,
  setDecentralizedRelayEnabled,
  isSmpV9Enabled,
  setSmpV9Enabled,
  getSmpV9BridgeUrl,
  setSmpV9BridgeUrl,
  getSmpRelayPresets,
  getSmpV9Host,
  setSmpV9Host
} from '@/lib/relay/relayClient'
import { isRelayOnlyCallsEnabled, setRelayOnlyCallsEnabled, getIceServers } from '@/lib/iceServers'
import { isCoverTrafficEnabled, setCoverTrafficEnabled } from '@/lib/privacyPrefs'
import { isSendJitterEnabled, setSendJitterEnabled } from '@/lib/sendJitter'

import {
  ArrowLeft, User, Lock, Bell, MessageSquare, Video, Palette,
  Globe, Database, HelpCircle, Info, LogOut, ChevronRight,
  Moon, Sun, Check, Camera, Edit2, Shield, Key, Trash2,
  Eye, EyeOff, Wifi, WifiOff, Mail, Image, FileText, Mic, Loader2,
  Cloud, CloudUpload, DownloadCloud, Smartphone, Copy, X, QrCode
} from 'lucide-react'
import { SafeQrCode } from '@/components/SafeQrCode'
import { QrScanner } from '@/components/QrScanner'
import { isDeviceLink, redeemDeviceLink } from '@/lib/recovery/deviceLink'
import { fulfillLinkRequest } from '@/lib/recovery/deviceLinkChannel'
import { encodeContactLink, isContactLink, parseContactLink, addContactAndOpenConversation } from '@/lib/contactLink'
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
                     'storage' | 'network' | 'calls' | 'downloads' | 'devices' | 'help' | 'faq' | 'contact' | 'terms' | 'backup' | 'language'

// ============ HELPER FUNCTIONS ============

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const formatBackupDate = (date: Date | null, neverLabel: string): string => {
  if (!date) return neverLabel
  return date.toLocaleDateString(getLocale(), {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getViewTitle = (view: SettingsView, t: (key: string) => string): string => {
  const titles: Record<SettingsView, string> = {
    'main': t('settings'),
    'profile': t('settingsProfile'),
    'account': t('settingsAccount'),
    'privacy': t('settingsPrivacy'),
    'security': t('settingsSecurity'),
    '2fa': t('settings2fa'),
    'delete': t('settingsDeleteAccount'),
    'discussions': t('settingsDiscussions'),
    'wallpaper': t('settingsWallpaper'),
    'notifications': t('settingsNotifications'),
    'message-notif': t('settingsMessageNotif'),
    'call-notif': t('settingsCallNotif'),
    'storage': t('settingsStorage'),
    'network': t('settingsNetwork'),
    'calls': t('settingsCalls'),
    'downloads': t('settingsDownloads'),
    'devices': 'Code QR',
    'backup': t('settingsBackup'),
    'faq': t('settingsFaq'),
    'contact': t('settingsContact'),
    'terms': t('settingsTerms'),
    'help': t('settingsHelp'),
    'language': t('settingsLanguage')
  }
  return titles[view]
}

const getParentView = (view: SettingsView): SettingsView => {
  const accountViews: SettingsView[] = ['privacy', 'security', '2fa', 'delete']
  if (accountViews.includes(view)) return 'account'
  if (view === 'wallpaper') return 'discussions'
  const notifViews: SettingsView[] = ['message-notif', 'call-notif']
  if (notifViews.includes(view)) return 'notifications'
  const helpViews: SettingsView[] = ['faq', 'contact', 'terms']
  if (helpViews.includes(view)) return 'help'
  return 'main'
}

// ============ COMPONENT ============

export function SettingsPage() {
  const { profile, signOut, signOutAndWipeLocal, user, updateLocalProfile, regenerateRecovery } = useAuth()
  const { theme, wallpaper, setTheme, setWallpaper } = useTheme()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [currentView, setCurrentView] = useState<SettingsView>('main')
  // Interrupteurs persistés (survivent au reload) — voir src/lib/prefs.ts.
  const [notificationsEnabled, setNotificationsEnabled] = usePersistentPref('notifications_enabled')
  const [soundEnabled, setSoundEnabled] = usePersistentPref('sound_enabled')
  const [vibrationEnabled, setVibrationEnabled] = usePersistentPref('vibration_enabled')
  const [messagePreviewEnabled, setMessagePreviewEnabled] = usePersistentPref('message_preview_enabled')
  const [callNotificationsEnabled, setCallNotificationsEnabled] = usePersistentPref('call_notifications_enabled')
  const [ringtoneEnabled, setRingtoneEnabled] = usePersistentPref('ringtone_enabled')
  const [callVibrationEnabled, setCallVibrationEnabled] = usePersistentPref('call_vibration_enabled')
  const [showCallerName, setShowCallerName] = usePersistentPref('show_caller_name')
  const [editingName, setEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState(profile?.display_name || '')
  const [editingBio, setEditingBio] = useState(false)
  const [newBio, setNewBio] = useState(profile?.bio || '')
  const [discoverable, setDiscoverable] = useState<boolean>((profile as any)?.discoverable ?? true)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [showLastSeen, setShowLastSeen] = useState(true)
  const [showProfilePhoto, setShowProfilePhoto] = useState(true)
  const [torEnabled, setTorEnabled] = useState<boolean>(() => isTorRelayEnabled())
  const [torAvailable, setTorAvailable] = useState<boolean>(() => isTorAvailable())
  const [relayInput, setRelayInput] = useState<string>(() => getRelayUrl() ?? '')
  const [relayOnlyCalls, setRelayOnlyCalls] = useState<boolean>(() => isRelayOnlyCallsEnabled())
  const [decentralized, setDecentralized] = useState<boolean>(() => isDecentralizedRelayEnabled())
  const [relayPoolInput, setRelayPoolInput] = useState<string>(() => getRelayPoolInput())
  const [smpV9, setSmpV9] = useState<boolean>(() => isSmpV9Enabled())
  const [smpV9Url, setSmpV9Url] = useState<string>(() => getSmpV9BridgeUrl())
  const [smpV9HostDraft, setSmpV9HostDraft] = useState<string>(() => getSmpV9Host())
  const [smpV9HostSel, setSmpV9HostSel] = useState<string>(() => getSmpV9Host())
  const [relayMode, setRelayMode] = useState<RelayMode>(() => getRelayMode())
  const [availableRelays, setAvailableRelays] = useState<string[]>(() => getAvailableRelays())
  const [iceServerCount, setIceServerCount] = useState<number>(() => getIceServers().length)
  const [selectedRelays, setSelectedRelays] = useState<string[]>(() => {
    if (getRelayMode() !== 'manual') return []
    return getRelayPoolInput()
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  })
  const [showAdvancedRelays, setShowAdvancedRelays] = useState(false)
  const [coverTraffic, setCoverTraffic] = useState<boolean>(() => isCoverTrafficEnabled())
  const [sendJitter, setSendJitter] = useState<boolean>(() => isSendJitterEnabled())
  // Multi-appareil (QR) : code à afficher + scanner.
  const [deviceTab, setDeviceTab] = useState<'mine' | 'scan'>('mine')
  const [deviceMsg, setDeviceMsg] = useState<string | null>(null)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [twoFactorFactors, setTwoFactorFactors] = useState<TOTPFactor[]>([])
  const [twoFactorLoading, setTwoFactorLoading] = useState(false)
  const [twoFactorEnrollment, setTwoFactorEnrollment] = useState<EnrollmentData | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorError, setTwoFactorError] = useState('')
  const [twoFactorStep, setTwoFactorStep] = useState<'idle' | 'enrolling' | 'verifying' | 'disabling'>('idle')
  const [showSecret, setShowSecret] = useState(false)
  const [recoveryPhraseInput, setRecoveryPhraseInput] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [autoDownloadWifi, setAutoDownloadWifi] = usePersistentPref('auto_download_wifi')
  const [autoDownloadMobile, setAutoDownloadMobile] = usePersistentPref('auto_download_mobile')
  const [autoDownloadPhotos, setAutoDownloadPhotos] = usePersistentPref('auto_download_photos')
  const [autoDownloadVideos, setAutoDownloadVideos] = usePersistentPref('auto_download_videos')
  const [autoDownloadFiles, setAutoDownloadFiles] = usePersistentPref('auto_download_files')
  const [autoDownloadAudio, setAutoDownloadAudio] = usePersistentPref('auto_download_audio')
  
  const [storageStats, setStorageStats] = useState({
    total: 0,
    photos: 0,
    videos: 0,
    files: 0,
    audio: 0,
    loading: true
  })
  const [clearingStorage, setClearingStorage] = useState(false)
  const [wipingLocalData, setWipingLocalData] = useState(false)
  
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

  // Valeurs « réseau / appels » recalculées à l'ouverture de la vue (au lieu
  // d'être figées au montage) : la disponibilité Tor, la liste des relais et
  // le nombre de serveurs ICE peuvent changer pendant la session.
  useEffect(() => {
    if (currentView === 'network') {
      setTorAvailable(isTorAvailable())
      setAvailableRelays(getAvailableRelays())
    } else if (currentView === 'calls') {
      setIceServerCount(getIceServers().length)
    }
  }, [currentView])

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
        setTwoFactorError(result.error || t('twoFaEnrollError'))
        setTwoFactorStep('idle')
      }
    } catch (err: any) {
      setTwoFactorError(err.message || t('unexpectedError'))
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
        alert(t('twoFaEnabledAlert'))
      } else {
        setTwoFactorError(result.error || t('twoFaInvalidCode'))
      }
    } catch (err: any) {
      setTwoFactorError(err.message || t('twoFaVerifyError'))
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const handleDisable2FA = async () => {
    if (twoFactorFactors.length === 0) return
    
    const confirmed = confirm(t('twoFaDisableConfirm'))
    
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
      alert(t('twoFaDisabledAlert'))
    } catch (err: any) {
      setTwoFactorError(err.message || t('twoFaDisableError'))
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

  // Rotation de la phrase de récupération : EXIGE la preuve de l'ancienne
  // phrase (vérifiée contre le matériel local) avant toute régénération.
  const handleRotateRecovery = async () => {
    if (!user || recoveryBusy) return
    const phrase = recoveryPhraseInput.trim()
    if (!validateRecoveryPhrase(phrase)) {
      setRecoveryError(t('recoveryPhraseInvalid'))
      return
    }
    setRecoveryBusy(true)
    setRecoveryError('')
    try {
      const verified = await verifyCurrentPhrase(user.id, phrase)
      if (!verified) {
        setRecoveryError(t('recoveryPhraseIncorrect'))
        return
      }
      await regenerateRecovery(phrase)
      setRecoveryPhraseInput('')
    } catch (e) {
      setRecoveryError((e as Error)?.message || t('recoveryRegenerateError'))
    } finally {
      setRecoveryBusy(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      alert(t('copied'))
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

    const typeLabels: Record<string, string> = {
      all: t('storageTypeAll'),
      photos: t('storageTypePhotos'),
      videos: t('storageTypeVideos'),
      files: t('storageTypeFiles'),
      audio: t('storageTypeVoice'),
    }
    if (!confirm(t('clearCacheConfirm', { type: typeLabels[type] }))) return

    setClearingStorage(true)
    try {
      // IMPORTANT : on ne touche JAMAIS à la base (messages.media_url…).
      // L'ancien code faisait un UPDATE global → perte des médias pour TOUS
      // les participants. On purge uniquement le cache LOCAL de cet appareil.
      //
      // 1. IndexedDB locale (messages, conversations, médias déchiffrés).
      await offlineStorage.clearAll()

      // 2. Caches média du Service Worker (nephtys-media-*).
      if ('caches' in globalThis) {
        const keys = await caches.keys()
        await Promise.all(
          keys.filter(k => k.startsWith('nephtys-media')).map(k => caches.delete(k))
        )
      }

      // 3. Caches applicatifs localStorage (anu_cache_*).
      try {
        const stale: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('anu_cache_')) stale.push(key)
        }
        stale.forEach(key => localStorage.removeItem(key))
      } catch {
        // localStorage indisponible : ignoré (best-effort).
      }

      alert(t('cacheCleared'))
      loadStorageStats()
    } catch (e) {
      console.error('Error clearing local cache:', e)
      alert(t('cacheClearError'))
    } finally {
      setClearingStorage(false)
    }
  }

  const handleSignOut = async () => {
    if (confirm(t('signOutConfirm'))) {
      await signOut()
      navigate('/auth')
    }
  }

  // Efface les clés/le stockage LOCAL de cet appareil puis déconnecte.
  // Différent de la déconnexion simple (qui conserve tout, mode local-first).
  const handleWipeLocalData = async () => {
    if (wipingLocalData) return
    const message =
      'Effacer les clés et l\'historique de cet appareil ? ' +
      'Vous devrez saisir votre phrase de récupération à la prochaine connexion.'
    if (!confirm(message)) return
    setWipingLocalData(true)
    try {
      await signOutAndWipeLocal()
      navigate('/auth')
    } catch (e) {
      console.error('[settings] wipe local data failed:', e)
      alert(t('unexpectedError'))
    } finally {
      setWipingLocalData(false)
    }
  }

  const handleUpdateDisplayName = async () => {
    if (!user || !newDisplayName.trim()) return
    const trimmed = newDisplayName.trim()
    const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', user.id)
    if (!error) {
      setEditingName(false)
      updateLocalProfile({ display_name: trimmed })
    } else {
      console.error('[settings] update display name failed:', error)
      alert(t('profileUpdateError'))
    }
  }

  const handleUpdateBio = async () => {
    if (!user) return
    const trimmed = newBio.trim() || null
    const { error } = await supabase.from('profiles').update({ bio: trimmed }).eq('id', user.id)
    if (!error) {
      setEditingBio(false)
      updateLocalProfile({ bio: trimmed })
    } else {
      console.error('[settings] update bio failed:', error)
      alert(t('profileUpdateError'))
    }
  }

  // Discrétion dans l'annuaire : couper/activer la recherche par pseudo.
  const handleToggleDiscoverable = async () => {
    if (!user) return
    const next = !discoverable
    setDiscoverable(next)
    const { error } = await supabase
      .from('profiles')
      .update({ discoverable: next })
      .eq('id', user.id)
    if (error) {
      setDiscoverable(!next)
      console.error('[settings] toggle discoverable failed:', error)
    } else {
      updateLocalProfile({ discoverable: next } as any)
    }
  }

  useEffect(() => {
    setDiscoverable((profile as any)?.discoverable ?? true)
  }, [profile])

  // Routage Tor : simple préférence locale (aucun envoi serveur). Un clic active
  // la passerelle Tor de l'infra — aucun logiciel externe. Prend effet à la
  // prochaine connexion du mode privé.
  const handleSetTorPolicy = (enabled: boolean) => {
    setTorEnabled(enabled)
    setTorRelayEnabled(enabled)
  }

  /** Remet relais / Tor / appels aux valeurs par defaut puis recharge. */
  const handleResetNetwork = () => {
    setRelayUrl('')
    setTorRelayEnabled(false)
    setRelayOnlyCallsEnabled(true)
    setDecentralizedRelayEnabled(false)
    saveRelayMode('auto')
    setRelayMode('auto')
    setRelayPool('')
    setRelayPoolInput('')
    setSmpV9Enabled(false)
    setSmpV9BridgeUrl('')
    setSmpV9Host('')
    setSelectedRelays([])
    globalThis.location.reload()
  }

  const handleToggleDecentralized = () => {
    const next = !decentralized
    setDecentralized(next)
    setDecentralizedRelayEnabled(next)
  }

  const handleSelectRelayMode = (mode: RelayMode) => {
    setRelayMode(mode)
    saveRelayMode(mode)
  }

  const handleToggleRelaySelected = (url: string) => {
    setSelectedRelays(prev =>
      prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]
    )
  }

  /** Sélection vide = tous les relais disponibles. */
  const handleSaveSelectedRelays = () => {
    const pool = (selectedRelays.length ? selectedRelays : availableRelays).join(' ')
    setRelayPool(pool)
    setRelayPoolInput(pool)
    saveRelayMode('manual')
    setRelayMode('manual')
    setAvailableRelays(getAvailableRelays())
  }

  const handleSaveRelayPool = () => {
    setRelayPool(relayPoolInput)
    saveRelayMode('manual')
    setRelayMode('manual')
    setAvailableRelays(getAvailableRelays())
  }

  const handleToggleSmpV9 = () => {
    const next = !smpV9
    setSmpV9(next)
    setSmpV9Enabled(next)
  }

  const handleSaveSmpV9Url = () => {
    setSmpV9BridgeUrl(smpV9Url)
    setSmpV9Url(getSmpV9BridgeUrl())
  }

  const handleToggleCover = () => {
    const next = !coverTraffic
    setCoverTraffic(next)
    setCoverTrafficEnabled(next)
  }

  const handleToggleSendJitter = () => {
    const next = !sendJitter
    setSendJitter(next)
    setSendJitterEnabled(next)
  }

  /**
   * Applique l'URL de relais saisie. `setRelayUrl` refuse silencieusement les
   * URL invalides (wss:// requis) ; on détecte ce refus et on le remonte à
   * l'utilisateur au lieu de recharger sur un réglage non pris en compte.
   */
  const applyRelayUrl = (): boolean => {
    setRelayUrl(relayInput)
    const trimmed = relayInput.trim()
    if (trimmed && getRelayUrl() !== trimmed) {
      alert(t('relayInvalidUrl'))
      return false
    }
    return true
  }

  /** Applique relais + politique de routage Tor puis relance la connexion. */
  const handleSaveAndReconnect = () => {
    if (!applyRelayUrl()) return
    setTorRelayEnabled(torEnabled)
    globalThis.location.reload()
  }

  const handleSaveRelay = () => {
    if (!applyRelayUrl()) return
    globalThis.location.reload()
  }

  const handleToggleRelayOnly = () => {
    const next = !relayOnlyCalls
    setRelayOnlyCalls(next)
    setRelayOnlyCallsEnabled(next)
  }

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    
    if (file.size > 5 * 1024 * 1024) {
      alert(t('fileTooLargeAlert'))
      return
    }
    
    if (!file.type.startsWith('image/')) {
      alert(t('invalidImageFormatAlert'))
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
        throw new Error(t('uploadError'))
      }
      
      // On stocke le path nu en base (pas l'URL signée qui expire).
      // L'URL signée sera générée à la volée via getMediaUrl() au moment de l'affichage.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: fileName })
        .eq('id', user.id)
      
      if (updateError) {
        console.error('Profile update error:', updateError)
        throw new Error(t('profileUpdateError'))
      }
      
      // Invalider le cache pour qu'au reload la nouvelle photo apparaisse
      try { invalidateMediaUrl(fileName) } catch { /* ignore */ }
      alert(t('profilePhotoUpdated'))
      globalThis.location.reload()
    } catch (err: any) {
      console.error('Photo upload error:', err)
      alert(err.message || t('photoUploadErrorAlert'))
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!user) return
    const confirmation = prompt(t('deleteAccountPrompt', { word: t('deleteConfirmWord') }))
    if (confirmation !== t('deleteConfirmWord')) return
    try {
      // 1. Données applicatives de l'utilisateur (RLS-scoped).
      await deleteMyMessages(user.id)
      await supabase.from('conversation_members').delete().eq('user_id', user.id)
      await supabase.from('contacts').delete().eq('user_id', user.id)
      await supabase.from('profiles').delete().eq('id', user.id)

      // 2. Le compte d'authentification NE peut PAS être supprimé depuis le
      //    client (il faut le service role via une Edge Function). On tente
      //    `delete-account` ; si elle n'existe pas / échoue, on NE prétend PAS
      //    avoir supprimé le compte : l'utilisateur auth subsisterait.
      const { error: authDeleteError } = await supabase.functions.invoke('delete-account', {
        body: {},
      })
      if (authDeleteError) {
        console.error('[settings] auth account deletion failed:', authDeleteError)
        alert(t('deleteAccountAuthError'))
        return
      }

      // 3. Compte auth supprimé : on efface le local et on déconnecte.
      try {
        await signOutAndWipeLocal()
      } catch {
        await signOut()
      }
      navigate('/auth')
    } catch (e) {
      console.error('[settings] delete account failed:', e)
      alert(t('deleteAccountError'))
    }
  }

  // ============ RENDER HELPERS ============
  
  // Helper: Render 2FA loading state
  const render2FALoadingState = () => (
    <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={32} className="animate-spin text-accent mx-auto mb-4" />
        <p className="text-text-secondary">{t('loading')}</p>
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
            {t('twoFaSetupTitle')}
          </h3>
          <p className="text-sm text-text-secondary">
            {t('twoFaScanQr')}
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 mx-auto max-w-xs">
          <img src={twoFactorEnrollment.totp.qr_code} alt="QR Code 2FA" className="w-full h-auto" />
        </div>

        <div className="bg-bg-surface rounded-2xl p-4 space-y-3">
          <p className="text-sm text-text-secondary text-center">{t('twoFaOrEnterCode')}</p>
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
          <label className="text-sm text-text-secondary" htmlFor="2fa-code">{t('twoFaEnterCode')}</label>
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
            {t('cancel')}
          </button>
          <button onClick={handleVerify2FACode} disabled={twoFactorLoading || twoFactorCode.length !== 6} className="flex-1 py-3 rounded-2xl bg-accent text-white font-medium hover:bg-[#5a5ec9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {twoFactorLoading ? <><Loader2 size={18} className="animate-spin" />{t('verifying')}</> : t('verify')}
          </button>
        </div>

        <div className="bg-bg-surface rounded-2xl p-4">
          <p className="text-sm text-text-secondary mb-2">{t('twoFaRecommendedApps')}</p>
          <ul className="text-sm text-text-primary space-y-1">
            <li>• <strong>Aegis Authenticator</strong> {t('twoFaAegisDesc')}</li>
            <li>• <strong>FreeOTP+</strong> {t('twoFaFreeOtpDesc')}</li>
            <li>• <strong>KeePassXC</strong> {t('twoFaKeepassxcDesc')}</li>
            <li>• <strong>Bitwarden</strong> {t('twoFaBitwardenDesc')}</li>
          </ul>
          <p className="text-xs text-text-secondary mt-3">{t('twoFaAppsPrivacy')}</p>
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
              <div className="text-text-primary font-medium">{t('twoFaTitle')}</div>
              <div className={`text-sm ${twoFactorEnabled ? 'text-green-500' : 'text-text-secondary'}`}>
                {twoFactorEnabled ? t('twoFaEnabledCheck') : t('twoFaDisabledLabel')}
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-text-secondary">
          {twoFactorEnabled
            ? t('twoFaEnabledDesc')
            : t('twoFaDisabledDesc')}
        </p>

        {twoFactorEnabled ? (
          <button onClick={handleDisable2FA} disabled={twoFactorLoading} className="w-full py-3 rounded-2xl bg-red-500/10 text-red-500 font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2">
            {twoFactorLoading && twoFactorStep === 'disabling' ? <><Loader2 size={18} className="animate-spin" />{t('twoFaDisabling')}</> : <><X size={18} />{t('twoFaDisableButton')}</>}
          </button>
        ) : (
          <button onClick={handleStart2FAEnrollment} disabled={twoFactorLoading} className="w-full py-3 px-4 rounded-2xl bg-accent text-white font-medium hover:bg-[#5a5ec9] transition-colors flex items-center justify-center gap-2">
            {twoFactorLoading && twoFactorStep === 'enrolling' ? <><Loader2 size={18} className="animate-spin flex-shrink-0" /><span>{t('twoFaSetupInProgress')}</span></> : <><Smartphone size={18} className="flex-shrink-0" /><span>{t('twoFaSetupButton')}</span></>}
          </button>
        )}

        {twoFactorError && twoFactorStep === 'idle' && <p className="text-sm text-red-500 text-center">{twoFactorError}</p>}
      </div>

      <div className="bg-bg-surface rounded-2xl p-6 space-y-4">
        <h4 className="text-text-primary font-medium">{t('twoFaHowItWorks')}</h4>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-accent text-sm font-medium">1</span></div>
            <p className="text-sm text-text-secondary">{t('twoFaStep1')}</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-accent text-sm font-medium">2</span></div>
            <p className="text-sm text-text-secondary">{t('twoFaStep2')}</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-accent text-sm font-medium">3</span></div>
            <p className="text-sm text-text-secondary">{t('twoFaStep3')}</p>
          </div>
        </div>
      </div>

      <div className="bg-accent/10 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <Lock size={20} className="text-accent flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-text-primary font-medium mb-1">{t('twoFaSecurityTitle')}</p>
            <p className="text-xs text-text-secondary">{t('twoFaSecurityDesc')}</p>
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
    { icon: User, label: t('settingsProfile'), subtitle: profile?.display_name || profile?.username, view: 'profile' as SettingsView },
    { icon: Key, label: t('settingsAccount'), subtitle: t('mainSubtitleAccount'), view: 'account' as SettingsView },
    { icon: MessageSquare, label: t('settingsDiscussions'), subtitle: t('mainSubtitleDiscussions'), view: 'discussions' as SettingsView },
    { icon: Bell, label: t('settingsNotifications'), subtitle: t('mainSubtitleNotifications'), view: 'notifications' as SettingsView },
    { icon: Database, label: t('settingsStorage'), subtitle: t('mainSubtitleStorage'), view: 'storage' as SettingsView },
    { icon: Wifi, label: t('settingsNetwork'), subtitle: 'Relais, Tor, proxy', view: 'network' as SettingsView },
    { icon: Video, label: t('settingsCalls'), subtitle: 'Relais et médias des appels', view: 'calls' as SettingsView },
    { icon: FileText, label: t('settingsDownloads'), subtitle: 'Téléchargement automatique', view: 'downloads' as SettingsView },
    { icon: QrCode, label: 'Code QR', subtitle: 'Mon code / lier un appareil', view: 'devices' as SettingsView },
    { icon: Cloud, label: t('mainBackupShort'), subtitle: t('mainSubtitleBackup'), view: 'backup' as SettingsView },
    { icon: Globe, label: t('settingsLanguage'), subtitle: t('languageLabel'), view: 'language' as SettingsView },
    { icon: HelpCircle, label: t('settingsHelp'), subtitle: t('mainSubtitleHelp'), view: 'help' as SettingsView },
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
              <input type="file" accept="image/*" onChange={handleUploadPhoto} className="hidden" disabled={uploadingPhoto} aria-label={t('changeProfilePhoto')} />
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
      <button
        type="button"
        onClick={() => setCurrentView('devices')}
        className="w-full bg-bg-surface px-6 py-4 flex items-center gap-4 hover:bg-bg-hover transition-colors border-t border-bg-hover"
      >
        <QrCode size={22} className="text-accent" />
        <div className="flex-1 text-left">
          <div className="text-text-primary">Code QR</div>
          <div className="text-xs text-text-secondary">Mon code / lier un appareil</div>
        </div>
        <ChevronRight size={18} className="text-text-secondary" />
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
        <p className="text-sm text-text-secondary">{t('optimizedForJemaos')}</p>
        <p className="text-xs text-text-secondary">{t('versionLabel', { version: '1.1.0' })} · build {__BUILD_COMMIT__}</p>
      </div>
      <div className="px-6 pb-8">
        <button onClick={handleSignOut} className="w-full py-3 rounded-2xl bg-bg-surface hover:bg-bg-hover text-[#ea4335] font-medium transition-colors flex items-center justify-center gap-2">
          <LogOut size={20} />{t('signOut')}
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
              <input type="file" accept="image/*" onChange={handleUploadPhoto} className="hidden" disabled={uploadingPhoto} aria-label={t('changeProfilePhoto')} />
            </label>
          </div>
          <p className="text-sm text-text-secondary">{t('editProfilePhoto')}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-accent" htmlFor="profile-name">{t('name')}</label>
          <div className="flex items-center gap-3 p-4 bg-bg-surface rounded-2xl">
            <input id="profile-name" type="text" value={editingName ? newDisplayName : (profile?.display_name || profile?.username)} onChange={(e) => setNewDisplayName(e.target.value)} onFocus={() => setEditingName(true)} className="flex-1 bg-transparent text-text-primary outline-none" aria-label={t('name')} />
            {editingName ? <button onClick={handleUpdateDisplayName} className="text-accent"><Check size={18} /></button> : <Edit2 size={18} className="text-text-secondary" />}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-accent">{t('usernameLabel')}</p>
          <div className="p-4 bg-bg-surface rounded-2xl"><p className="text-text-primary">@{profile?.username}</p></div>
          <p className="text-xs text-text-secondary">{t('usernameNotEditable')}</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-accent" htmlFor="profile-bio">{t('infoLabel')}</label>
          <div className="flex items-center gap-3 p-4 bg-bg-surface rounded-2xl">
            <input id="profile-bio" type="text" placeholder={t('addInfoPlaceholder')} value={editingBio ? newBio : (profile?.bio || '')} onChange={(e) => setNewBio(e.target.value)} onFocus={() => { setEditingBio(true); setNewBio(profile?.bio || ''); }} className="flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-secondary" aria-label={t('infoLabel')} />
            {editingBio ? <button onClick={handleUpdateBio} className="text-accent"><Check size={18} /></button> : <Edit2 size={18} className="text-text-secondary" />}
          </div>
          {profile?.bio && !editingBio && <p className="text-xs text-text-secondary px-1">{t('currentInfo', { info: profile.bio })}</p>}
        </div>
        <div className="space-y-2">
          <p className="text-sm text-accent">Annuaire</p>
          <div className="flex items-center justify-between gap-3 p-4 bg-bg-surface rounded-2xl">
            <div className="flex-1">
              <p className="text-text-primary">Apparaître dans l'annuaire</p>
              <p className="text-xs text-text-secondary">
                Si désactivé, votre pseudo n'est plus trouvable par recherche. Vos contacts et
                conversations existants ne sont pas affectés. Les autres peuvent encore vous
                joindre via une connexion privée (lien/QR).
              </p>
            </div>
            <input
              type="checkbox"
              checked={discoverable}
              onChange={handleToggleDiscoverable}
              className="w-5 h-5 accent-[#7578db] shrink-0"
              aria-label="Apparaître dans l'annuaire"
            />
          </div>
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
            <div className="text-text-primary">{t('settingsPrivacy')}</div>
            <div className="text-sm text-text-secondary">{t('accountPrivacyDesc')}</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('security')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Lock size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">{t('settingsSecurity')}</div>
            <div className="text-sm text-text-secondary">{t('accountSecurityDesc')}</div>
          </div>
          <div className="flex items-center gap-2"><Check size={16} className="text-accent" /><span className="text-sm text-accent">{t('enabled')}</span></div>
        </button>
        <button onClick={() => setCurrentView('2fa')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Key size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">{t('twoFaTitle')}</div>
            <div className="text-sm text-text-secondary">{twoFactorEnabled ? t('enabled') : t('disabled')}</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('delete')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Trash2 size={24} className="text-[#ea4335]" />
          <div className="flex-1 text-left">
            <div className="text-[#ea4335]">{t('settingsDeleteAccount')}</div>
            <div className="text-sm text-text-secondary">{t('accountDeleteDesc')}</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button
          onClick={handleWipeLocalData}
          disabled={wipingLocalData}
          className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors disabled:opacity-50"
        >
          <Smartphone size={24} className="text-[#ea4335]" />
          <div className="flex-1 text-left">
            <div className="text-[#ea4335]">Effacer les données de cet appareil</div>
            <div className="text-sm text-text-secondary">
              Supprime les clés de chiffrement et l'historique local, puis vous déconnecte. Votre
              phrase de récupération sera requise à la prochaine connexion.
            </div>
          </div>
          {wipingLocalData
            ? <Loader2 size={18} className="animate-spin text-text-secondary" />
            : <ChevronRight size={20} className="text-text-secondary" />}
        </button>
      </div>
    </div>
  )

  const renderPrivacyView = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-text-primary">{t('lastSeenLabel')}</div>
            <div className="text-sm text-text-secondary">{t('lastSeenDesc')}</div>
          </div>
          <button onClick={() => setShowLastSeen(!showLastSeen)} className={`w-12 h-6 rounded-full relative transition-colors ${showLastSeen ? 'bg-accent' : 'bg-[#8696a0]'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showLastSeen ? 'right-1' : 'left-1'}`}></div>
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-text-primary">{t('profilePhotoLabel')}</div>
            <div className="text-sm text-text-secondary">{t('profilePhotoDesc')}</div>
          </div>
          <button onClick={() => setShowProfilePhoto(!showProfilePhoto)} className={`w-12 h-6 rounded-full relative transition-colors ${showProfilePhoto ? 'bg-accent' : 'bg-[#8696a0]'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showProfilePhoto ? 'right-1' : 'left-1'}`}></div>
          </button>
        </div>
      </div>
    </div>
  )

  const renderSecurityView = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="bg-bg-surface rounded-2xl p-6 text-center space-y-4">
        <div className="w-20 h-20 mx-auto rounded-full bg-accent/20 flex items-center justify-center">
          <Lock size={40} className="text-accent" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">{t('encryptionEnabled')}</h3>
          <p className="text-sm text-text-secondary">{t('encryptionDesc')}</p>
        </div>
        <div className="pt-4 border-t border-bg-hover">
          <p className="text-xs text-text-secondary">{t('protocolLabel')}</p>
        </div>
      </div>

      <div className="bg-bg-surface rounded-2xl p-6 space-y-3">
        <h3 className="text-lg font-semibold text-text-primary">{t('recoveryRotateTitle')}</h3>
        <p className="text-sm text-text-secondary">{t('recoveryRotateDesc')}</p>
        <textarea
          value={recoveryPhraseInput}
          onChange={(e) => { setRecoveryPhraseInput(e.target.value); setRecoveryError('') }}
          rows={3}
          placeholder={t('recoveryCurrentPhrasePlaceholder')}
          className="w-full px-3 py-2 rounded-xl bg-bg-primary text-sm text-text-primary font-mono resize-none outline-none"
        />
        {recoveryError && <p className="text-sm text-red-500">{recoveryError}</p>}
        <button
          onClick={handleRotateRecovery}
          disabled={recoveryBusy || recoveryPhraseInput.trim().length === 0}
          className="w-full py-3 rounded-2xl bg-accent text-white font-medium hover:bg-[#5a5ec9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {recoveryBusy ? <><Loader2 size={18} className="animate-spin" />{t('recoveryVerifying')}</> : t('recoveryRotateButton')}
        </button>
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
          <h3 className="text-lg font-semibold text-text-primary mb-2">{t('settingsDeleteAccount')}</h3>
          <p className="text-sm text-text-secondary">{t('deleteAccountIrreversible')}</p>
        </div>
        <div className="space-y-3 text-sm text-text-secondary">
          <p>• {t('deleteAllMessages')}</p>
          <p>• {t('deleteAllConversations')}</p>
          <p>• {t('deleteAllContacts')}</p>
          <p>• {t('deleteProfileErased')}</p>
        </div>
        <button onClick={handleDeleteAccount} className="w-full py-3 rounded-xl bg-[#ea4335] hover:bg-[#d33b2f] text-white font-medium">
          {t('deleteAccountButton')}
        </button>
      </div>
    </div>
  )

  const renderDiscussionsView = () => (
    <div className="flex-1 overflow-y-auto">
      <div className="py-2">
        <div className="px-6 py-4">
          <h3 className="text-sm text-accent mb-4">{t('displaySection')}</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-text-primary">{t('themeLabel')}</span>
              <div className="flex gap-2">
                {[
                  { value: 'light', icon: Sun, label: t('themeLight') },
                  { value: 'dark', icon: Moon, label: t('themeDark') }
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
            <div className="text-text-primary">{t('settingsWallpaper')}</div>
            <div className="text-sm text-text-secondary">{t('wallpaperDefault')}</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
      </div>
    </div>
  )

  const renderWallpaperView = () => {
    const wallpaperOptions = [
      { value: 'default' as const, label: t('wallpaperDefault'), style: {} },
      { value: 'dark' as const, label: t('themeDark'), style: { backgroundColor: '#000000' } },
      { value: 'light' as const, label: t('themeLight'), style: { backgroundColor: '#e5ddd5' } },
      { value: 'gradient' as const, label: t('wallpaperGradient'), style: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' } },
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
              <div className="text-text-primary">{t('settingsNotifications')}</div>
              <div className="text-sm text-text-secondary">{t('notifEnableDesc')}</div>
            </div>
            <button onClick={() => setNotificationsEnabled(!notificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${notificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${notificationsEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">{t('soundsLabel')}</div>
              <div className="text-sm text-text-secondary">{t('soundsDesc')}</div>
            </div>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${soundEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${soundEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
        </div>
        <button onClick={() => setCurrentView('message-notif')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <MessageSquare size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">{t('settingsMessageNotif')}</div>
            <div className="text-sm text-text-secondary">{t('messageNotifSubtitle')}</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('call-notif')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Video size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">{t('settingsCallNotif')}</div>
            <div className="text-sm text-text-secondary">{t('callNotifSubtitle')}</div>
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
            <div><div className="text-text-primary">{t('settingsMessageNotif')}</div><div className="text-sm text-text-secondary">{t('msgNotifDesc')}</div></div>
            <button onClick={() => setNotificationsEnabled(!notificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${notificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${notificationsEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">{t('notifSoundLabel')}</div><div className="text-sm text-text-secondary">{t('notifSoundDesc')}</div></div>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${soundEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${soundEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">{t('vibrationLabel')}</div><div className="text-sm text-text-secondary">{t('msgVibrationDesc')}</div></div>
            <button onClick={() => setVibrationEnabled(!vibrationEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${vibrationEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${vibrationEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">{t('messagePreviewLabel')}</div><div className="text-sm text-text-secondary">{t('messagePreviewDesc')}</div></div>
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
            <div><div className="text-text-primary">{t('settingsCallNotif')}</div><div className="text-sm text-text-secondary">{t('callNotifDesc')}</div></div>
            <button onClick={() => setCallNotificationsEnabled(!callNotificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${callNotificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${callNotificationsEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">{t('ringtoneLabel')}</div><div className="text-sm text-text-secondary">{t('ringtoneDesc')}</div></div>
            <button onClick={() => setRingtoneEnabled(!ringtoneEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${ringtoneEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${ringtoneEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">{t('vibrationLabel')}</div><div className="text-sm text-text-secondary">{t('callVibrationDesc')}</div></div>
            <button onClick={() => setCallVibrationEnabled(!callVibrationEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${callVibrationEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${callVibrationEnabled ? 'right-1' : 'left-1'}`}></div></button>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-text-primary">{t('showCallerNameLabel')}</div><div className="text-sm text-text-secondary">{t('showCallerNameDesc')}</div></div>
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
                <div className="text-sm text-text-secondary">{t('spaceUsed')}</div>
              </>
            )}
          </div>
        </div>

        {!storageStats.loading && storageStats.total > 0 && (
          <div className="px-4 mb-4">
            <div className="bg-bg-surface rounded-2xl p-4 space-y-3">
              <h3 className="text-sm text-accent font-medium mb-3">{t('breakdown')}</h3>
              
              {storageStats.photos > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><Image size={20} className="text-blue-400" /><span className="text-text-primary">{t('photosLabel')}</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.photos)}</span><button onClick={() => handleClearStorage('photos')} disabled={clearingStorage} className="text-xs text-accent hover:underline">{t('clear')}</button></div>
                </div>
              )}
              {storageStats.videos > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><Video size={20} className="text-purple-400" /><span className="text-text-primary">{t('videosLabel')}</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.videos)}</span><button onClick={() => handleClearStorage('videos')} disabled={clearingStorage} className="text-xs text-accent hover:underline">{t('clear')}</button></div>
                </div>
              )}
              {storageStats.audio > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><Mic size={20} className="text-green-400" /><span className="text-text-primary">{t('voiceMessagesLabel')}</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.audio)}</span><button onClick={() => handleClearStorage('audio')} disabled={clearingStorage} className="text-xs text-accent hover:underline">{t('clear')}</button></div>
                </div>
              )}
              {storageStats.files > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3"><FileText size={20} className="text-orange-400" /><span className="text-text-primary">{t('filesLabel')}</span></div>
                  <div className="flex items-center gap-3"><span className="text-text-secondary">{formatBytes(storageStats.files)}</span><button onClick={() => handleClearStorage('files')} disabled={clearingStorage} className="text-xs text-accent hover:underline">{t('clear')}</button></div>
                </div>
              )}
              
              <div className="pt-3 border-t border-bg-hover">
                <button onClick={() => handleClearStorage('all')} disabled={clearingStorage} className="w-full py-2 rounded-xl bg-red-500/10 text-red-500 text-sm font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2">
                  {clearingStorage ? <><Loader2 size={16} className="animate-spin" />{t('deleting')}</> : <><Trash2 size={16} />{t('clearAllCache')}</>}
                </button>
              </div>
            </div>
          </div>
        )}

        <button onClick={() => setCurrentView('network')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Globe size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">{t('settingsNetwork')}</div>
            <div className="text-sm text-text-secondary">{t('autoDownloadSubtitle')}</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
      </div>
    </div>
  )

  const renderNetworkView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4 border-b border-bg-hover">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2"><Globe size={16} />Serveurs</h3>
          <div className="space-y-4">
            <div>
              <div className="text-text-primary">Relais (mode privé)</div>
              <div className="text-sm text-text-secondary mb-2">URL du relais chiffré utilisé par le mode privé. Vide = réseau par défaut.</div>
              <div className="flex items-center gap-2">
                <input
                  value={relayInput}
                  onChange={e => setRelayInput(e.target.value)}
                  placeholder="wss://relais.exemple/"
                  className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-surface text-[11px] font-mono text-text-secondary"
                />
                <button onClick={handleSaveRelay} className="px-2 py-1 rounded-lg bg-bg-hover text-xs text-text-primary shrink-0">Enregistrer</button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="pr-4">
                <div className="text-text-primary">Routage privé</div>
                <div className="text-sm text-text-secondary">Router le mode privé via le réseau Tor.</div>
              </div>
              <div className="flex gap-1 p-1 rounded-xl bg-bg-surface shrink-0">
                <button
                  type="button"
                  onClick={() => handleSetTorPolicy(true)}
                  disabled={!torAvailable}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${torEnabled ? 'bg-[#7578db] text-white' : 'text-text-secondary'} ${torAvailable ? '' : 'opacity-50'}`}
                >
                  Toujours
                </button>
                <button
                  type="button"
                  onClick={() => handleSetTorPolicy(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${torEnabled ? 'text-text-secondary' : 'bg-[#7578db] text-white'}`}
                >
                  Jamais
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-bg-hover space-y-2">
              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-text-primary">Trafic de couverture</div>
                  <div className="text-sm text-text-secondary">Brouille le timing/volume en envoyant des messages factices.</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleCover}
                  aria-pressed={coverTraffic}
                  className={`w-12 h-6 rounded-full relative shrink-0 transition-colors ${coverTraffic ? 'bg-accent' : 'bg-[#8696a0]'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${coverTraffic ? 'right-1' : 'left-1'}`}></div>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-text-primary">{t('sendJitterLabel')}</div>
                  <div className="text-sm text-text-secondary">{t('sendJitterDesc')}</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSendJitter}
                  aria-pressed={sendJitter}
                  className={`w-12 h-6 rounded-full relative shrink-0 transition-colors ${sendJitter ? 'bg-accent' : 'bg-[#8696a0]'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${sendJitter ? 'right-1' : 'left-1'}`}></div>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-text-primary">Réseau décentralisé</div>
                  <div className="text-sm text-text-secondary">Répartir le mode privé sur plusieurs relais, avec repli automatique.</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleDecentralized}
                  aria-pressed={decentralized}
                  className={`w-12 h-6 rounded-full relative shrink-0 transition-colors ${decentralized ? 'bg-accent' : 'bg-[#8696a0]'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${decentralized ? 'right-1' : 'left-1'}`}></div>
                </button>
              </div>
              {decentralized && (
                <div className="space-y-3 pt-1">
                  <div role="group" aria-label="Choix du mode du réseau décentralisé" className="flex gap-1 p-1 rounded-xl bg-bg-surface">
                    <button
                      type="button"
                      onClick={() => handleSelectRelayMode('auto')}
                      aria-pressed={relayMode === 'auto'}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${relayMode === 'auto' ? 'bg-[#7578db] text-white' : 'text-text-secondary'}`}
                    >
                      Automatique (recommandé)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectRelayMode('manual')}
                      aria-pressed={relayMode === 'manual'}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${relayMode === 'manual' ? 'bg-[#7578db] text-white' : 'text-text-secondary'}`}
                    >
                      Choisir des relais
                    </button>
                  </div>

                  {relayMode === 'auto' ? (
                    <p className="text-sm text-text-secondary">
                      Les relais sont choisis automatiquement ; repli automatique en cas d'indisponibilité.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-text-secondary">Aucun relais coché = tous les relais disponibles.</p>
                      <div className="space-y-1">
                        {availableRelays.map(url => (
                          <label key={url} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-bg-surface cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedRelays.includes(url)}
                              onChange={() => handleToggleRelaySelected(url)}
                              className="accent-[#7578db] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            />
                            <span className="text-[11px] font-mono text-text-secondary break-all">{url}</span>
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveSelectedRelays}
                        className="px-2 py-1 rounded-lg bg-bg-hover text-xs text-text-primary"
                      >
                        Enregistrer les relais
                      </button>
                    </div>
                  )}

                  <div>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedRelays(v => !v)}
                      aria-expanded={showAdvancedRelays}
                      className="flex items-center gap-1 text-xs text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
                    >
                      <ChevronRight size={14} className={`transition-transform ${showAdvancedRelays ? 'rotate-90' : ''}`} />
                      Avancé
                    </button>
                    {showAdvancedRelays && (
                      <div className="mt-2 space-y-1">
                        <textarea
                          value={relayPoolInput}
                          onChange={e => setRelayPoolInput(e.target.value)}
                          rows={3}
                          placeholder="wss://relais1.exemple/  wss://relais2.exemple/"
                          className="w-full px-2 py-1 rounded-lg bg-bg-surface text-[11px] font-mono text-text-secondary resize-none outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleSaveRelayPool}
                          className="px-2 py-1 rounded-lg bg-bg-hover text-xs text-text-primary"
                        >
                          Enregistrer les relais
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <div className="text-text-primary">Réseau SMP</div>
                  <div className="text-sm text-text-secondary">Utiliser les relais SMP via le pont (serveur(s) compatible(s) WS).</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSmpV9}
                  aria-pressed={smpV9}
                  className={`w-12 h-6 rounded-full relative shrink-0 transition-colors ${smpV9 ? 'bg-accent' : 'bg-[#8696a0]'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${smpV9 ? 'right-1' : 'left-1'}`}></div>
                </button>
              </div>
              {smpV9 && (
                <div className="space-y-2">
                  <div className="text-sm text-text-secondary">Relais de messages :</div>
                  <div className="max-h-56 overflow-y-auto rounded-xl bg-bg-surface">
                    {getSmpRelayPresets().map(host => (
                      <button
                        key={host}
                        type="button"
                        onClick={() => { setSmpV9Host(host); setSmpV9HostSel(host) }}
                        className={`w-full text-left px-3 py-2 text-xs font-mono border-b border-bg-hover last:border-0 ${smpV9HostSel === host ? 'text-accent' : 'text-text-secondary'}`}
                      >
                        {smpV9HostSel === host ? '● ' : '○ '}{host}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={smpV9HostDraft}
                      onChange={e => setSmpV9HostDraft(e.target.value)}
                      placeholder="smp.exemple.org"
                      className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-surface text-[11px] font-mono text-text-secondary"
                    />
                    <button
                      type="button"
                      onClick={() => { setSmpV9Host(smpV9HostDraft); setSmpV9HostSel(smpV9HostDraft) }}
                      className="px-2 py-1 rounded-lg bg-bg-hover text-xs text-text-primary shrink-0"
                    >
                      Utiliser
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={smpV9Url}
                      onChange={e => setSmpV9Url(e.target.value)}
                      placeholder="wss://votre-vps/smp"
                      className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-surface text-[11px] font-mono text-text-secondary"
                    />
                    <button
                      type="button"
                      onClick={handleSaveSmpV9Url}
                      className="px-2 py-1 rounded-lg bg-bg-hover text-xs text-text-primary shrink-0"
                    >
                      Enregistrer
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={handleResetNetwork}
                className="w-full px-3 py-2 rounded-xl bg-bg-surface hover:bg-bg-hover text-text-primary text-sm"
              >
                Réinitialiser les valeurs par défaut
              </button>
              <button
                type="button"
                onClick={handleSaveAndReconnect}
                className="w-full px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium"
              >
                Sauvegarder et se reconnecter
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  )

  const renderDevicesView = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Onglets « Code QR » (façon WhatsApp) */}
      <div className="flex border-b border-bg-hover">
        {([['mine', 'MON CODE'], ['scan', 'SCANNER LE CODE']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setDeviceTab(id)}
            className={`flex-1 py-3 text-xs font-semibold tracking-wide transition-colors border-b-2 ${deviceTab === id ? 'text-[#00a884] border-[#00a884]' : 'text-text-secondary border-transparent'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {deviceTab === 'mine' ? (
        <div className="flex-1 overflow-y-auto flex flex-col items-center p-6">
          <div className="relative w-full max-w-sm mt-10">
            <div className="bg-bg-surface rounded-3xl pt-12 pb-5 px-5 flex flex-col items-center shadow-lg">
              <div className="absolute -top-9 w-20 h-20 rounded-full border-4 border-bg-primary overflow-hidden bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-3xl">
                {profile?.username?.[0]?.toUpperCase()}
              </div>
              <h3 className="text-lg font-semibold text-text-primary">{profile?.display_name || profile?.username}</h3>
              <p className="text-sm text-text-secondary mb-4">Contact Nephtys</p>
              {profile?.username && (
                <div className="relative bg-white p-3 rounded-2xl">
                  <SafeQrCode value={encodeContactLink(profile.username)} size={220} />
                  <img src="/icon.svg" alt="" className="absolute inset-0 m-auto w-9 h-9 rounded-lg" />
                </div>
              )}
            </div>
          </div>
          <p className="mt-5 text-sm text-text-secondary text-center max-w-xs">
            Votre code QR est privé. Si vous le partagez avec quelqu'un, cette personne pourra le
            scanner pour vous ajouter en tant que contact.
          </p>
          {profile?.username && (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(encodeContactLink(profile.username as string))}
              className="mt-3 px-4 py-2 rounded-xl bg-bg-hover text-text-primary text-sm"
            >
              Copier le lien
            </button>
          )}
          {deviceMsg && <p className="mt-3 text-xs text-text-secondary text-center">{deviceMsg}</p>}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <p className="px-6 py-3 text-xs text-text-secondary">
            Pointez la caméra vers le code QR de votre autre appareil pour le lier.
          </p>
          <div className="flex-1">
            <QrScanner
              onClose={() => setDeviceTab('mine')}
              onResult={(text) => {
                setDeviceMsg(null)
                if (isContactLink(text)) {
                  // QR de contact → ajoute le contact et ouvre la discussion.
                  const username = parseContactLink(text)
                  const uid = user?.id
                  if (!username || !uid) { setDeviceMsg('QR contact invalide.'); return }
                  void addContactAndOpenConversation(uid, username)
                    .then((convId) => { if (convId) navigate(`/chat/${convId}`); else setDeviceMsg('Contact ajouté ✅.') })
                    .catch((e: unknown) => setDeviceMsg(`Échec : ${(e as Error).message}`))
                } else if (isDeviceLink(text)) {
                  void redeemDeviceLink(text)
                    .then(() => setDeviceMsg('Appareil lié ✅.'))
                    .catch((e: unknown) => setDeviceMsg(`Échec : ${(e as Error).message}`))
                } else {
                  // QR affiché par un nouvel appareil (page de connexion) → on lui
                  // transmet la session + les clés.
                  void fulfillLinkRequest(text)
                    .then(() => setDeviceMsg('Code transmis ✅ — le nouvel appareil est connecté.'))
                    .catch((e: unknown) => setDeviceMsg(`Échec : ${(e as Error).message}`))
                }
              }}
            />
          </div>
          {deviceMsg && <p className="px-6 py-3 text-xs text-text-secondary text-center">{deviceMsg}</p>}
        </div>
      )}
    </div>
  )

  const renderDownloadsView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2"><Wifi size={16} />{t('wifiConnection')}</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div><div className="text-text-primary">{t('autoDownloadLabel')}</div><div className="text-sm text-text-secondary">{t('autoDownloadWifiDesc')}</div></div>
              <button onClick={() => setAutoDownloadWifi(!autoDownloadWifi)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadWifi ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadWifi ? 'right-1' : 'left-1'}`}></div></button>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-bg-hover">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2"><WifiOff size={16} />{t('mobileData')}</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div><div className="text-text-primary">{t('autoDownloadLabel')}</div><div className="text-sm text-text-secondary">{t('autoDownloadMobileDesc')}</div></div>
              <button onClick={() => setAutoDownloadMobile(!autoDownloadMobile)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadMobile ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadMobile ? 'right-1' : 'left-1'}`}></div></button>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-bg-hover">
          <h3 className="text-sm text-accent mb-4">{t('mediaTypes')}</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Image size={20} className="text-blue-400" /><span className="text-text-primary">{t('photosLabel')}</span></div>
              <button onClick={() => setAutoDownloadPhotos(!autoDownloadPhotos)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadPhotos ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadPhotos ? 'right-1' : 'left-1'}`}></div></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Video size={20} className="text-purple-400" /><span className="text-text-primary">{t('videosLabel')}</span></div>
              <button onClick={() => setAutoDownloadVideos(!autoDownloadVideos)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadVideos ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadVideos ? 'right-1' : 'left-1'}`}></div></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Mic size={20} className="text-green-400" /><span className="text-text-primary">{t('voiceMessagesLabel')}</span></div>
              <button onClick={() => setAutoDownloadAudio(!autoDownloadAudio)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadAudio ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadAudio ? 'right-1' : 'left-1'}`}></div></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><FileText size={20} className="text-orange-400" /><span className="text-text-primary">{t('filesLabel')}</span></div>
              <button onClick={() => setAutoDownloadFiles(!autoDownloadFiles)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadFiles ? 'bg-accent' : 'bg-[#8696a0]'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadFiles ? 'right-1' : 'left-1'}`}></div></button>
            </div>
          </div>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-text-secondary">{t('autoDownloadNote')}</p>
        </div>
      </div>
    </div>
  )

  const renderCallsView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2"><Video size={16} />Appels</h3>
          <div className="space-y-4">
            <div>
              <div className="text-text-primary">Serveurs WebRTC ICE</div>
              <div className="text-sm text-text-secondary">{iceServerCount} serveur(s) STUN/TURN configuré(s).</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <div className="text-text-primary">Se connecter via relais</div>
                <div className="text-sm text-text-secondary">Force le média via TURN (protège l'IP ; le relais voit la durée de l'appel).</div>
              </div>
              <button
                onClick={handleToggleRelayOnly}
                aria-pressed={relayOnlyCalls}
                className={`w-12 h-6 rounded-full relative shrink-0 transition-colors ${relayOnlyCalls ? 'bg-accent' : 'bg-[#8696a0]'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${relayOnlyCalls ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderHelpView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <button onClick={() => setCurrentView('faq')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <HelpCircle size={24} className="text-text-secondary" />
          <div className="flex-1 text-left"><div className="text-text-primary">{t('settingsFaq')}</div><div className="text-sm text-text-secondary">{t('faqSubtitle')}</div></div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('contact')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Mail size={24} className="text-text-secondary" />
          <div className="flex-1 text-left"><div className="text-text-primary">{t('settingsContact')}</div><div className="text-sm text-text-secondary">{t('supportDesc')}</div></div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('terms')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Info size={24} className="text-text-secondary" />
          <div className="flex-1 text-left"><div className="text-text-primary">{t('termsLabel')}</div></div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <div className="px-6 py-8 text-center space-y-2">
          <p className="text-sm text-text-secondary">{t('optimizedForJemaos')}</p>
          <p className="text-xs text-text-secondary">{t('versionLabel', { version: '1.1.0' })} · build {__BUILD_COMMIT__}</p>
          <p className="text-xs text-text-secondary mt-4">{t('copyright')}</p>
        </div>
      </div>
    </div>
  )

  const renderFAQView = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {[
        { q: t('faqQ1'), a: t('faqA1') },
        { q: t('faqQ2'), a: t('faqA2') },
        { q: t('faqQ3'), a: t('faqA3') },
      ].map((faq) => (
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
          <h3 className="text-lg font-semibold text-text-primary mb-2">{t('contactUsTitle')}</h3>
          <p className="text-sm text-text-secondary mb-4">{t('contactUsDesc')}</p>
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
        <h3 className="text-lg font-semibold text-text-primary">{t('settingsTerms')}</h3>
        <p>{t('termsIntro')}</p>
        <p>• {t('noTracking')}</p>
        <p>• {t('noAds')}</p>
        <p>• {t('noLogs')}</p>
        <p>• {t('e2eeDefault')}</p>
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
    setBackupStatus(t('backupStarting'))
    
    try {
      const { data: backupData, size } = isLightBackup
        ? await createLightBackup(user.id, (progress, status) => { setBackupProgress(progress); setBackupStatus(status); })
        : await createBackup(user.id, backupSettings, (progress, status) => { setBackupProgress(progress); setBackupStatus(status); })
      
      setBackupStatus(t('backupEncrypting'))
      await exportBackupAsFile(backupData, backupPassword)
      
      const now = new Date()
      setLastBackupDate(now)
      setLastBackupSize(size)
      saveBackupMetadata({ lastBackupDate: now.toISOString(), lastBackupSize: size, backupCount: (getBackupMetadata().backupCount || 0) + 1 })
      updateBackupSettings({ lastBackupDate: now.toISOString(), lastBackupSize: size })
      
      setBackupPassword('')
      setShowPasswordInput(false)
      alert(t('backupSuccessAlert'))
    } catch (err: any) {
      console.error('Backup error:', err)
      alert(t('backupErrorAlert', { message: err.message || t('pleaseTryAgain') }))
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
    setBackupStatus(t('restoreReading'))
    
    try {
      const backupData = await importBackupFromFile(file, backupPassword)
      
      if (!backupData) throw new Error(t('restoreReadError'))
      
      const confirmRestore = confirm(
        t('restoreConfirm', {
          date: new Date(backupData.createdAt).toLocaleDateString(getLocale()),
          messages: backupData.messages.length,
          conversations: backupData.conversations.length,
        })
      )
      
      if (!confirmRestore) { setIsRestoring(false); return }
      
      const result = await restoreBackup(backupData, user.id, (progress, status) => { setBackupProgress(progress); setBackupStatus(status); })
      
      if (result.success) {
        setBackupPassword('')
        setShowPasswordInput(false)
        alert(t('restoreSuccessAlert'))
        globalThis.location.reload()
      } else {
        throw new Error(result.error || t('restoreError'))
      }
    } catch (err: any) {
      console.error('Restore error:', err)
      alert(t('restoreErrorAlert', { message: err.message || t('pleaseTryAgain') }))
    } finally {
      setIsRestoring(false)
      setBackupProgress(0)
      setBackupStatus('')
    }
  }

  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.neph')) { alert(t('invalidBackupFileAlert')); return }
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
            <h3 className="text-accent font-medium mb-2">{t('backupSettingsTitle')}</h3>
            <p>
              {t('backupSettingsDesc')}
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
            <CloudUpload size={20} />{t('createFullBackup')}
          </button>
          <button
            onClick={() => { setPasswordAction('light-backup'); setShowPasswordInput(true); }}
            disabled={isBackingUp || isRestoring}
            className={`w-full py-3 rounded-2xl font-medium transition-colors flex items-center justify-center gap-2 ${isBackingUp || isRestoring ? 'bg-bg-surface/50 text-text-secondary cursor-not-allowed' : 'bg-bg-surface hover:bg-bg-hover text-text-primary'}`}
          >
            <FileText size={20} />{t('lightBackup')}
          </button>
          <p className="text-xs text-text-secondary text-center">
            {t('lightBackupNote')}
          </p>
        </div>

        <div className="px-6 py-2">
          <input 
            type="file" 
            accept=".neph" 
            onChange={handleRestoreFileSelect} 
            className="hidden" 
            ref={restoreFileRef}
            aria-label={t('selectBackupFile')}
          />
          <button 
            onClick={() => restoreFileRef.current?.click()} 
            disabled={isBackingUp || isRestoring} 
            className={`w-full py-3 rounded-2xl font-medium transition-colors flex items-center justify-center gap-2 ${isBackingUp || isRestoring ? 'bg-bg-surface/50 text-text-secondary cursor-not-allowed' : 'bg-bg-surface hover:bg-bg-hover text-text-primary'}`}
          >
            <DownloadCloud size={20} />{t('restoreBackupAction')}
          </button>
        </div>

        <ProtonDriveRecommendationComponent />

        <div className="px-6 py-4 border-t border-bg-hover">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-text-primary">{t('reminderFrequency')}</div>
              <div className="text-text-secondary text-sm">
                {(() => {
                  if (backupSettings.frequency === 'daily') return t('freqDaily')
                  if (backupSettings.frequency === 'weekly') return t('freqWeekly')
                  return t('freqMonthly')
                })()}
              </div>
            </div>
            <select 
              value={backupSettings.frequency} 
              onChange={(e) => updateBackupSettings({ frequency: e.target.value as 'daily' | 'weekly' | 'monthly' })} 
              className="bg-bg-surface text-text-primary px-3 py-2 rounded-xl border border-bg-hover focus:outline-none focus:border-accent"
              aria-label={t('reminderFrequency')}
            >
              <option value="daily">{t('freqDaily')}</option>
              <option value="weekly">{t('freqWeekly')}</option>
              <option value="monthly">{t('freqMonthly')}</option>
            </select>
          </div>
        </div>

        <BackupSettingToggleComponent
          label={t('includeImages')}
          description={t('includeImagesDesc')}
          value={backupSettings.includeImages}
          onChange={(v) => updateBackupSettings({ includeImages: v })}
        />

        <BackupSettingToggleComponent
          label={t('includeVideos')}
          description={t('includeVideosDesc')}
          value={backupSettings.includeVideos}
          onChange={(v) => updateBackupSettings({ includeVideos: v })}
        />

        <BackupSettingToggleComponent
          label={t('includeVoice')}
          description={t('includeVoiceDesc')}
          value={backupSettings.includeAudio}
          onChange={(v) => updateBackupSettings({ includeAudio: v })}
        />

        <BackupSettingToggleComponent
          label={t('includeFilesBackup')}
          description={t('includeFilesBackupDesc')}
          value={backupSettings.includeFiles}
          onChange={(v) => updateBackupSettings({ includeFiles: v })}
        />

        <BackupSecurityInfoComponent />
      </div>
    </div>
  )

  const renderLanguageView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4 space-y-4">
          <div>
            <div className="text-text-primary">{t('languageLabel')}</div>
            <div className="text-sm text-text-secondary">{t('languageDescription')}</div>
          </div>
          <LanguageSelector />
        </div>
      </div>
    </div>
  )

  const views: Record<SettingsView, () => JSX.Element | null> = {
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
    calls: renderCallsView,
    downloads: renderDownloadsView,
    devices: renderDevicesView,
    help: renderHelpView,
    faq: renderFAQView,
    contact: renderContactView,
    terms: renderTermsView,
    backup: renderBackupView,
    language: renderLanguageView,
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
          <h1 className="text-xl font-medium text-text-primary">{getViewTitle(currentView, t)}</h1>
        </div>
        {views[currentView]()}
      </div>
    </MainLayout>
  )
}
