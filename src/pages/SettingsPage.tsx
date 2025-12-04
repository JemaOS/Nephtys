import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft, User, Lock, Bell, MessageSquare, Video, Palette,
  Globe, Database, HelpCircle, Info, LogOut, ChevronRight,
  Moon, Sun, Monitor, Check, Camera, Edit2, Shield, Key, Trash2,
  Eye, EyeOff, Download, Wifi, WifiOff, Mail, Image, FileText, Mic, Loader2,
  Cloud, CloudUpload, RefreshCw, Calendar, Upload, DownloadCloud
} from 'lucide-react'
import {
  createBackup,
  exportBackupAsFile,
  importBackupFromFile,
  restoreBackup,
  getBackupSettings,
  saveBackupSettings,
  getBackupMetadata,
  saveBackupMetadata,
  estimateBackupSize,
  type BackupSettings
} from '@/lib/backupService'

type SettingsView = 'main' | 'profile' | 'account' | 'privacy' | 'security' | '2fa' | 'delete' |
                     'discussions' | 'wallpaper' | 'notifications' | 'message-notif' | 'call-notif' |
                     'storage' | 'network' | 'help' | 'faq' | 'contact' | 'terms' | 'backup'

export function SettingsPage() {
  const { profile, signOut, user } = useAuth()
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
  const [enterToSend, setEnterToSend] = useState(true)
  const [autoDownloadWifi, setAutoDownloadWifi] = useState(true)
  const [autoDownloadMobile, setAutoDownloadMobile] = useState(false)
  const [autoDownloadPhotos, setAutoDownloadPhotos] = useState(true)
  const [autoDownloadVideos, setAutoDownloadVideos] = useState(false)
  const [autoDownloadFiles, setAutoDownloadFiles] = useState(true)
  const [autoDownloadAudio, setAutoDownloadAudio] = useState(true)
  
  // Storage stats
  const [storageStats, setStorageStats] = useState({
    total: 0,
    photos: 0,
    videos: 0,
    files: 0,
    audio: 0,
    loading: true
  })
  const [clearingStorage, setClearingStorage] = useState(false)
  
  // Backup settings
  const [backupSettings, setBackupSettingsState] = useState<BackupSettings>(getBackupSettings())
  const [lastBackupDate, setLastBackupDate] = useState<Date | null>(null)
  const [lastBackupSize, setLastBackupSize] = useState<number>(0)
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [backupProgress, setBackupProgress] = useState(0)
  const [backupStatus, setBackupStatus] = useState('')
  const [estimatedSize, setEstimatedSize] = useState<number>(0)
  const [backupPassword, setBackupPassword] = useState('')
  const [showPasswordInput, setShowPasswordInput] = useState(false)
  const [passwordAction, setPasswordAction] = useState<'backup' | 'restore'>('backup')
  const restoreFileRef = useRef<HTMLInputElement>(null)


  // Load storage stats and backup metadata
  useEffect(() => {
    loadStorageStats()
    loadBackupMetadata()
  }, [user])

  // Load backup metadata from localStorage
  const loadBackupMetadata = () => {
    const metadata = getBackupMetadata()
    if (metadata.lastBackupDate) {
      setLastBackupDate(new Date(metadata.lastBackupDate))
    }
    setLastBackupSize(metadata.lastBackupSize)
  }

  // Estimate backup size when settings change
  useEffect(() => {
    if (user) {
      estimateBackupSize(user.id, backupSettings).then(setEstimatedSize)
    }
  }, [user, backupSettings.includeVideos, backupSettings.includeImages, backupSettings.includeAudio, backupSettings.includeFiles])

  // Update backup settings
  const updateBackupSettings = (updates: Partial<BackupSettings>) => {
    const newSettings = { ...backupSettings, ...updates }
    setBackupSettingsState(newSettings)
    saveBackupSettings(newSettings)
  }

  const loadStorageStats = async () => {
    if (!user) return
    
    try {
      // Get all messages with media for this user's conversations
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
    } catch (err) {
      console.error('Error loading storage stats:', err)
      setStorageStats({ total: 0, photos: 0, videos: 0, files: 0, audio: 0, loading: false })
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const handleClearStorage = async (type: 'all' | 'photos' | 'videos' | 'files' | 'audio') => {
    if (!user) return
    
    const typeLabel = type === 'all' ? 'toutes les données' :
                      type === 'photos' ? 'les photos' :
                      type === 'videos' ? 'les vidéos' :
                      type === 'files' ? 'les fichiers' : 'les messages vocaux'
    
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
      
      if (type !== 'all') {
        const mediaType = type === 'photos' ? 'image' :
                         type === 'videos' ? 'video' :
                         type === 'audio' ? 'audio' : 'file'
        query = query.or(`media_type.eq.${mediaType},type.eq.${mediaType}`)
      }
      
      await query
      
      alert('✅ Cache vidé avec succès !')
      loadStorageStats()
    } catch (err) {
      console.error('Error clearing storage:', err)
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
    const { error } = await supabase.from('profiles').update({ display_name: newDisplayName.trim() }).eq('id', user.id)
    if (!error) {
      setEditingName(false)
      window.location.reload()
    }
  }

  const handleUpdateBio = async () => {
    if (!user) return
    const { error } = await supabase.from('profiles').update({ bio: newBio.trim() || null }).eq('id', user.id)
    if (!error) setEditingBio(false)
  }

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    
    // Vérifier la taille du fichier (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('❌ Fichier trop volumineux\n\nLa photo doit faire moins de 5 MB.')
      return
    }
    
    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
      alert('❌ Format invalide\n\nVeuillez sélectionner une image (JPG, PNG, etc.).')
      return
    }
    
    setUploadingPhoto(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `avatars/${user.id}/avatar-${Date.now()}.${fileExt}`
      
      // Utiliser le bucket 'media' qui existe déjà
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
      
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName)
      
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id)
      
      if (updateError) {
        console.error('Profile update error:', updateError)
        throw new Error('Erreur lors de la mise à jour du profil')
      }
      
      alert('✅ Photo de profil mise à jour !')
      window.location.reload()
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
    } catch (err) {
      alert('Erreur lors de la suppression du compte')
    }
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
      <div className="bg-bg-surface px-6 py-8 cursor-pointer hover:bg-bg-hover transition-colors" onClick={() => setCurrentView('profile')}>
        <div className="flex items-center gap-4">
          <div className="relative">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.username}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl">
                {profile?.username?.[0]?.toUpperCase()}
              </div>
            )}
            <label className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center cursor-pointer hover:bg-[#5a5ec9]">
              <Camera size={14} className="text-white" />
              <input type="file" accept="image/*" onChange={handleUploadPhoto} className="hidden" disabled={uploadingPhoto} />
            </label>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-medium text-text-primary">{profile?.display_name || profile?.username}</h2>
            <p className="text-sm text-text-secondary">@{profile?.username}</p>
            {profile?.bio && (
              <p className="text-sm text-text-secondary mt-1 italic">"{profile.bio}"</p>
            )}
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </div>
      </div>
      <div className="py-2">
        {mainSettings.map((setting, idx) => (
          <button key={idx} onClick={() => setCurrentView(setting.view)} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
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
        <p className="text-sm text-text-secondary">Nephtys pour JemaOS</p>
        <p className="text-xs text-text-secondary">Version 1.0.0</p>
      </div>
      <div className="px-6 pb-8">
        <button onClick={handleSignOut} className="w-full py-3 rounded-2xl bg-bg-surface hover:bg-bg-hover text-[#ea4335] font-medium transition-colors flex items-center justify-center gap-2">
          <LogOut size={20} />
          Se déconnecter
        </button>
      </div>
    </div>
  )

  const renderProfileView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="px-6 py-8 space-y-6">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.username}
                className="w-32 h-32 rounded-full object-cover"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-5xl">
                {profile?.username?.[0]?.toUpperCase()}
              </div>
            )}
            <label className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-accent flex items-center justify-center hover:bg-[#5a5ec9] transition-colors cursor-pointer">
              <Camera size={20} className="text-white" />
              <input type="file" accept="image/*" onChange={handleUploadPhoto} className="hidden" disabled={uploadingPhoto} />
            </label>
          </div>
          <p className="text-sm text-text-secondary">Modifier la photo de profil</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-accent">Nom</label>
          <div className="flex items-center gap-3 p-4 bg-bg-surface rounded-2xl">
            <input type="text" value={editingName ? newDisplayName : (profile?.display_name || profile?.username)} onChange={(e) => setNewDisplayName(e.target.value)} onFocus={() => setEditingName(true)} className="flex-1 bg-transparent text-text-primary outline-none" />
            {editingName ? <button onClick={handleUpdateDisplayName} className="text-accent"><Check size={18} /></button> : <Edit2 size={18} className="text-text-secondary" />}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-accent">Nom d'utilisateur</label>
          <div className="p-4 bg-bg-surface rounded-2xl">
            <p className="text-text-primary">@{profile?.username}</p>
          </div>
          <p className="text-xs text-text-secondary">Le nom d'utilisateur ne peut pas être modifié</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-accent">Info</label>
          <div className="flex items-center gap-3 p-4 bg-bg-surface rounded-2xl">
            <input
              type="text"
              placeholder="Ajouter une info..."
              value={editingBio ? newBio : (profile?.bio || '')}
              onChange={(e) => setNewBio(e.target.value)}
              onFocus={() => {
                setEditingBio(true)
                setNewBio(profile?.bio || '')
              }}
              className="flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-secondary"
            />
            {editingBio ? (
              <button onClick={handleUpdateBio} className="text-accent"><Check size={18} /></button>
            ) : (
              <Edit2 size={18} className="text-text-secondary" />
            )}
          </div>
          {profile?.bio && !editingBio && (
            <p className="text-xs text-text-secondary px-1">Votre info actuelle : "{profile.bio}"</p>
          )}
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
          <div className="flex items-center gap-2">
            <Check size={16} className="text-accent" />
            <span className="text-sm text-accent">Activé</span>
          </div>
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

  const render2FAView = () => (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="bg-bg-surface rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-text-primary font-medium">Authentification à deux facteurs</div>
            <div className="text-sm text-text-secondary">Protection supplémentaire de votre compte</div>
          </div>
          <button onClick={() => setTwoFactorEnabled(!twoFactorEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${twoFactorEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${twoFactorEnabled ? 'right-1' : 'left-1'}`}></div>
          </button>
        </div>
        {twoFactorEnabled && (
          <div className="pt-4 border-t border-bg-hover">
            <p className="text-sm text-text-secondary mb-3">Code de vérification requis à chaque connexion</p>
            <button className="w-full py-2 rounded-xl bg-accent hover:bg-[#5a5ec9] text-text-primary text-sm font-medium">
              Configurer l'application d'authentification
            </button>
          </div>
        )}
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
                wallpaper === option.value
                  ? 'border-accent ring-2 ring-accent/30'
                  : 'border-transparent hover:border-bg-hover'
              }`}
              style={option.value === 'default' ? { backgroundColor: 'var(--bg-surface)' } : option.style}
            >
              <span className={`text-sm font-medium ${
                option.value === 'dark' || option.value === 'gradient' ? 'text-white' : 'text-text-primary'
              }`}>
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
            <div>
              <div className="text-text-primary">Notifications de messages</div>
              <div className="text-sm text-text-secondary">Afficher les notifications pour les nouveaux messages</div>
            </div>
            <button onClick={() => setNotificationsEnabled(!notificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${notificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${notificationsEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Son de notification</div>
              <div className="text-sm text-text-secondary">Jouer un son pour les nouveaux messages</div>
            </div>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${soundEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${soundEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Vibration</div>
              <div className="text-sm text-text-secondary">Vibrer pour les nouveaux messages</div>
            </div>
            <button onClick={() => setVibrationEnabled(!vibrationEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${vibrationEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${vibrationEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Aperçu du message</div>
              <div className="text-sm text-text-secondary">Afficher le contenu dans la notification</div>
            </div>
            <button onClick={() => setMessagePreviewEnabled(!messagePreviewEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${messagePreviewEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${messagePreviewEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
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
            <div>
              <div className="text-text-primary">Notifications d'appels</div>
              <div className="text-sm text-text-secondary">Afficher les notifications pour les appels entrants</div>
            </div>
            <button onClick={() => setCallNotificationsEnabled(!callNotificationsEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${callNotificationsEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${callNotificationsEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Sonnerie</div>
              <div className="text-sm text-text-secondary">Jouer une sonnerie pour les appels entrants</div>
            </div>
            <button onClick={() => setRingtoneEnabled(!ringtoneEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${ringtoneEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${ringtoneEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Vibration</div>
              <div className="text-sm text-text-secondary">Vibrer pour les appels entrants</div>
            </div>
            <button onClick={() => setCallVibrationEnabled(!callVibrationEnabled)} className={`w-12 h-6 rounded-full relative transition-colors ${callVibrationEnabled ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${callVibrationEnabled ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Afficher le nom de l'appelant</div>
              <div className="text-sm text-text-secondary">Afficher qui appelle dans la notification</div>
            </div>
            <button onClick={() => setShowCallerName(!showCallerName)} className={`w-12 h-6 rounded-full relative transition-colors ${showCallerName ? 'bg-accent' : 'bg-[#8696a0]'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${showCallerName ? 'right-1' : 'left-1'}`}></div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderStorageView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        {/* Total storage card */}
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

        {/* Storage breakdown */}
        {!storageStats.loading && storageStats.total > 0 && (
          <div className="px-4 mb-4">
            <div className="bg-bg-surface rounded-2xl p-4 space-y-3">
              <h3 className="text-sm text-accent font-medium mb-3">Répartition</h3>
              
              {storageStats.photos > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Image size={20} className="text-blue-400" />
                    <span className="text-text-primary">Photos</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-text-secondary">{formatBytes(storageStats.photos)}</span>
                    <button
                      onClick={() => handleClearStorage('photos')}
                      disabled={clearingStorage}
                      className="text-xs text-accent hover:underline"
                    >
                      Vider
                    </button>
                  </div>
                </div>
              )}
              
              {storageStats.videos > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Video size={20} className="text-purple-400" />
                    <span className="text-text-primary">Vidéos</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-text-secondary">{formatBytes(storageStats.videos)}</span>
                    <button
                      onClick={() => handleClearStorage('videos')}
                      disabled={clearingStorage}
                      className="text-xs text-accent hover:underline"
                    >
                      Vider
                    </button>
                  </div>
                </div>
              )}
              
              {storageStats.audio > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Mic size={20} className="text-green-400" />
                    <span className="text-text-primary">Messages vocaux</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-text-secondary">{formatBytes(storageStats.audio)}</span>
                    <button
                      onClick={() => handleClearStorage('audio')}
                      disabled={clearingStorage}
                      className="text-xs text-accent hover:underline"
                    >
                      Vider
                    </button>
                  </div>
                </div>
              )}
              
              {storageStats.files > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText size={20} className="text-orange-400" />
                    <span className="text-text-primary">Fichiers</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-text-secondary">{formatBytes(storageStats.files)}</span>
                    <button
                      onClick={() => handleClearStorage('files')}
                      disabled={clearingStorage}
                      className="text-xs text-accent hover:underline"
                    >
                      Vider
                    </button>
                  </div>
                </div>
              )}
              
              <div className="pt-3 border-t border-bg-hover">
                <button
                  onClick={() => handleClearStorage('all')}
                  disabled={clearingStorage}
                  className="w-full py-2 rounded-xl bg-red-500/10 text-red-500 text-sm font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                >
                  {clearingStorage ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Suppression...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Vider tout le cache
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Network settings link */}
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
        {/* WiFi settings */}
        <div className="px-6 py-4">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2">
            <Wifi size={16} />
            Connexion Wi-Fi
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-primary">Téléchargement automatique</div>
                <div className="text-sm text-text-secondary">Télécharger les médias en Wi-Fi</div>
              </div>
              <button onClick={() => setAutoDownloadWifi(!autoDownloadWifi)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadWifi ? 'bg-accent' : 'bg-[#8696a0]'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadWifi ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile data settings */}
        <div className="px-6 py-4 border-t border-bg-hover">
          <h3 className="text-sm text-accent mb-4 flex items-center gap-2">
            <WifiOff size={16} />
            Données mobiles
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-primary">Téléchargement automatique</div>
                <div className="text-sm text-text-secondary">Télécharger avec données mobiles</div>
              </div>
              <button onClick={() => setAutoDownloadMobile(!autoDownloadMobile)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadMobile ? 'bg-accent' : 'bg-[#8696a0]'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadMobile ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
          </div>
        </div>

        {/* Media type settings */}
        <div className="px-6 py-4 border-t border-bg-hover">
          <h3 className="text-sm text-accent mb-4">Types de médias</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Image size={20} className="text-blue-400" />
                <span className="text-text-primary">Photos</span>
              </div>
              <button onClick={() => setAutoDownloadPhotos(!autoDownloadPhotos)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadPhotos ? 'bg-accent' : 'bg-[#8696a0]'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadPhotos ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Video size={20} className="text-purple-400" />
                <span className="text-text-primary">Vidéos</span>
              </div>
              <button onClick={() => setAutoDownloadVideos(!autoDownloadVideos)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadVideos ? 'bg-accent' : 'bg-[#8696a0]'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadVideos ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mic size={20} className="text-green-400" />
                <span className="text-text-primary">Messages vocaux</span>
              </div>
              <button onClick={() => setAutoDownloadAudio(!autoDownloadAudio)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadAudio ? 'bg-accent' : 'bg-[#8696a0]'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadAudio ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-orange-400" />
                <span className="text-text-primary">Fichiers</span>
              </div>
              <button onClick={() => setAutoDownloadFiles(!autoDownloadFiles)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownloadFiles ? 'bg-accent' : 'bg-[#8696a0]'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownloadFiles ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="px-6 py-4">
          <p className="text-xs text-text-secondary">
            Les paramètres de téléchargement automatique déterminent quand les médias sont téléchargés automatiquement.
            Désactivez le téléchargement automatique pour économiser des données.
          </p>
        </div>
      </div>
    </div>
  )

  const renderHelpView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <button onClick={() => setCurrentView('faq')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <HelpCircle size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">FAQ</div>
            <div className="text-sm text-text-secondary">Questions fréquentes</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('contact')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Mail size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Nous contacter</div>
            <div className="text-sm text-text-secondary">Support technique</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <button onClick={() => setCurrentView('terms')} className="w-full px-6 py-4 flex items-center gap-4 hover:bg-bg-surface transition-colors">
          <Info size={24} className="text-text-secondary" />
          <div className="flex-1 text-left">
            <div className="text-text-primary">Conditions et politique de confidentialité</div>
          </div>
          <ChevronRight size={20} className="text-text-secondary" />
        </button>
        <div className="px-6 py-8 text-center space-y-2">
          <p className="text-sm text-text-secondary">Nephtys pour JemaOS</p>
          <p className="text-xs text-text-secondary">Version 1.0.0</p>
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
      ].map((faq, idx) => (
        <div key={idx} className="bg-bg-surface rounded-2xl p-4">
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
          <a href="mailto:support@nephtys-app.com" className="block py-3 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium">
            support@nephtys-app.com
          </a>
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

  const handleBackup = async () => {
    if (!user) return
    
    if (!backupPassword) {
      setPasswordAction('backup')
      setShowPasswordInput(true)
      return
    }
    
    setIsBackingUp(true)
    setBackupProgress(0)
    setBackupStatus('Démarrage de la sauvegarde...')
    
    try {
      // Create backup
      const { data: backupData, size } = await createBackup(
        user.id,
        backupSettings,
        (progress, status) => {
          setBackupProgress(progress)
          setBackupStatus(status)
        }
      )
      
      // Export as encrypted file
      setBackupStatus('Chiffrement et téléchargement...')
      await exportBackupAsFile(backupData, backupPassword)
      
      // Update metadata
      const now = new Date()
      setLastBackupDate(now)
      setLastBackupSize(size)
      saveBackupMetadata({
        lastBackupDate: now.toISOString(),
        lastBackupSize: size,
        backupCount: (getBackupMetadata().backupCount || 0) + 1
      })
      
      // Update settings
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
      // Import and decrypt backup
      const backupData = await importBackupFromFile(file, backupPassword)
      
      if (!backupData) {
        throw new Error('Impossible de lire le fichier de sauvegarde')
      }
      
      // Confirm restore
      const confirmRestore = confirm(
        `Voulez-vous restaurer cette sauvegarde ?\n\n` +
        `Date de création : ${new Date(backupData.createdAt).toLocaleDateString('fr-FR')}\n` +
        `Messages : ${backupData.messages.length}\n` +
        `Conversations : ${backupData.conversations.length}\n` +
        `Contacts : ${backupData.contacts.length}\n\n` +
        `⚠️ Cette action peut écraser certaines données existantes.`
      )
      
      if (!confirmRestore) {
        setIsRestoring(false)
        return
      }
      
      // Restore backup
      const result = await restoreBackup(
        backupData,
        user.id,
        (progress, status) => {
          setBackupProgress(progress)
          setBackupStatus(status)
        }
      )
      
      if (result.success) {
        setBackupPassword('')
        setShowPasswordInput(false)
        alert('✅ Restauration terminée avec succès !\n\nVos données ont été restaurées.')
        window.location.reload()
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
      if (!file.name.endsWith('.neph')) {
        alert('❌ Format de fichier invalide\n\nVeuillez sélectionner un fichier .neph')
        return
      }
      handleRestore(file)
    }
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

  const renderBackupView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        {/* Password input modal */}
        {showPasswordInput && (
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
                  onClick={() => {
                    setShowPasswordInput(false)
                    setBackupPassword('')
                  }}
                  className="flex-1 py-3 rounded-xl bg-bg-hover text-text-primary font-medium"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    if (backupPassword.length >= 4) {
                      setShowPasswordInput(false)
                      if (passwordAction === 'backup') {
                        handleBackup()
                      } else if (restoreFileRef.current?.files?.[0]) {
                        handleRestore(restoreFileRef.current.files[0])
                      }
                    } else {
                      alert('Le mot de passe doit contenir au moins 4 caractères')
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
        )}

        {/* Progress indicator */}
        {(isBackingUp || isRestoring) && (
          <div className="px-6 py-4 bg-accent/10 mx-4 rounded-2xl mb-4">
            <div className="flex items-center gap-3 mb-2">
              <Loader2 size={20} className="animate-spin text-accent" />
              <span className="text-text-primary font-medium">
                {isBackingUp ? 'Sauvegarde en cours...' : 'Restauration en cours...'}
              </span>
            </div>
            <div className="text-sm text-text-secondary mb-2">{backupStatus}</div>
            <div className="w-full bg-bg-hover rounded-full h-2">
              <div
                className="bg-accent h-2 rounded-full transition-all duration-300"
                style={{ width: `${backupProgress}%` }}
              />
            </div>
            <div className="text-xs text-text-secondary mt-1 text-right">{backupProgress}%</div>
          </div>
        )}

        {/* Backup info header */}
        <div className="px-6 py-4">
          <div className="text-text-secondary text-sm mb-4">
            <h3 className="text-accent font-medium mb-2">Paramètres de la sauvegarde</h3>
            <p>
              Sauvegardez vos discussions et vos médias dans un fichier chiffré.
              Vous pourrez ensuite l'uploader sur Proton Drive et le restaurer sur un nouvel appareil.
            </p>
          </div>
        </div>

        {/* Last backup info */}
        <div className="px-6 py-4 bg-bg-surface mx-4 rounded-2xl mb-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <Calendar size={16} />
              <span>Dernière sauvegarde : {formatBackupDate(lastBackupDate)}</span>
            </div>
            {lastBackupSize > 0 && (
              <div className="flex items-center gap-2 text-text-secondary text-sm">
                <Database size={16} />
                <span>Taille : {formatBytes(lastBackupSize)}</span>
              </div>
            )}
            {estimatedSize > 0 && (
              <div className="flex items-center gap-2 text-text-secondary text-sm">
                <Database size={16} />
                <span>Taille estimée : {formatBytes(estimatedSize)}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-accent text-sm">
              <Lock size={16} />
              <span>Chiffrée de bout en bout</span>
            </div>
          </div>
        </div>

        {/* Backup button */}
        <div className="px-6 py-4">
          <button
            onClick={() => {
              setPasswordAction('backup')
              setShowPasswordInput(true)
            }}
            disabled={isBackingUp || isRestoring}
            className={`w-full py-3 rounded-2xl font-medium transition-colors flex items-center justify-center gap-2 ${
              isBackingUp || isRestoring
                ? 'bg-accent/50 text-white/70 cursor-not-allowed'
                : 'bg-accent hover:bg-[#5a5ec9] text-white'
            }`}
          >
            <CloudUpload size={20} />
            Créer une sauvegarde
          </button>
        </div>

        {/* Restore button */}
        <div className="px-6 py-2">
          <input
            ref={restoreFileRef}
            type="file"
            accept=".neph"
            onChange={handleRestoreFileSelect}
            className="hidden"
          />
          <button
            onClick={() => restoreFileRef.current?.click()}
            disabled={isBackingUp || isRestoring}
            className={`w-full py-3 rounded-2xl font-medium transition-colors flex items-center justify-center gap-2 ${
              isBackingUp || isRestoring
                ? 'bg-bg-surface/50 text-text-secondary cursor-not-allowed'
                : 'bg-bg-surface hover:bg-bg-hover text-text-primary'
            }`}
          >
            <DownloadCloud size={20} />
            Restaurer une sauvegarde
          </button>
        </div>

        {/* Proton Drive info */}
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
                <div className="text-text-secondary text-xs">
                  💡 Conseil : Gardez votre mot de passe de sauvegarde en lieu sûr
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Auto backup settings */}
        <div className="px-6 py-4 border-t border-bg-hover">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-text-primary">Fréquence de rappel</div>
              <div className="text-text-secondary text-sm">
                {backupSettings.frequency === 'daily' ? 'Tous les jours' :
                 backupSettings.frequency === 'weekly' ? 'Toutes les semaines' :
                 'Tous les mois'}
              </div>
            </div>
            <select
              value={backupSettings.frequency}
              onChange={(e) => updateBackupSettings({ frequency: e.target.value as 'daily' | 'weekly' | 'monthly' })}
              className="bg-bg-surface text-text-primary px-3 py-2 rounded-xl border border-bg-hover focus:outline-none focus:border-accent"
            >
              <option value="daily">Tous les jours</option>
              <option value="weekly">Toutes les semaines</option>
              <option value="monthly">Tous les mois</option>
            </select>
          </div>
        </div>

        {/* Include images toggle */}
        <div className="px-6 py-4 border-t border-bg-hover">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Inclure les images</div>
              <div className="text-text-secondary text-sm">
                Photos et images partagées
              </div>
            </div>
            <button
              onClick={() => updateBackupSettings({ includeImages: !backupSettings.includeImages })}
              className={`w-12 h-6 rounded-full relative transition-colors ${
                backupSettings.includeImages ? 'bg-accent' : 'bg-[#8696a0]'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                  backupSettings.includeImages ? 'right-1' : 'left-1'
                }`}
              ></div>
            </button>
          </div>
        </div>

        {/* Include videos toggle */}
        <div className="px-6 py-4 border-t border-bg-hover">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Inclure les vidéos</div>
              <div className="text-text-secondary text-sm">
                Les vidéos peuvent augmenter la taille de la sauvegarde
              </div>
            </div>
            <button
              onClick={() => updateBackupSettings({ includeVideos: !backupSettings.includeVideos })}
              className={`w-12 h-6 rounded-full relative transition-colors ${
                backupSettings.includeVideos ? 'bg-accent' : 'bg-[#8696a0]'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                  backupSettings.includeVideos ? 'right-1' : 'left-1'
                }`}
              ></div>
            </button>
          </div>
        </div>

        {/* Include audio toggle */}
        <div className="px-6 py-4 border-t border-bg-hover">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Inclure les messages vocaux</div>
              <div className="text-text-secondary text-sm">
                Messages vocaux et fichiers audio
              </div>
            </div>
            <button
              onClick={() => updateBackupSettings({ includeAudio: !backupSettings.includeAudio })}
              className={`w-12 h-6 rounded-full relative transition-colors ${
                backupSettings.includeAudio ? 'bg-accent' : 'bg-[#8696a0]'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                  backupSettings.includeAudio ? 'right-1' : 'left-1'
                }`}
              ></div>
            </button>
          </div>
        </div>

        {/* Include files toggle */}
        <div className="px-6 py-4 border-t border-bg-hover">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary">Inclure les fichiers</div>
              <div className="text-text-secondary text-sm">
                Documents, PDF et autres fichiers
              </div>
            </div>
            <button
              onClick={() => updateBackupSettings({ includeFiles: !backupSettings.includeFiles })}
              className={`w-12 h-6 rounded-full relative transition-colors ${
                backupSettings.includeFiles ? 'bg-accent' : 'bg-[#8696a0]'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                  backupSettings.includeFiles ? 'right-1' : 'left-1'
                }`}
              ></div>
            </button>
          </div>
        </div>

        {/* Info about encryption */}
        <div className="px-6 py-4">
          <div className="bg-bg-surface rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <Shield size={24} className="text-accent flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-text-primary font-medium mb-1">Sauvegarde chiffrée</div>
                <p className="text-text-secondary text-sm">
                  Vos sauvegardes sont chiffrées de bout en bout avec votre mot de passe personnel.
                  Personne ne peut accéder à vos données sans ce mot de passe.
                </p>
              </div>
            </div>
          </div>
        </div>
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

  // Define parent views for proper back navigation
  const getParentView = (view: SettingsView): SettingsView => {
    switch (view) {
      // Account sub-views
      case 'privacy':
      case 'security':
      case '2fa':
      case 'delete':
        return 'account'
      // Discussions sub-views
      case 'wallpaper':
        return 'discussions'
      // Notifications sub-views
      case 'message-notif':
      case 'call-notif':
        return 'notifications'
      // Storage sub-views
      case 'network':
        return 'storage'
      // Help sub-views
      case 'faq':
      case 'contact':
      case 'terms':
        return 'help'
      // All main menu items go back to main
      default:
        return 'main'
    }
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
          <h1 className="text-xl font-medium text-text-primary">
            {currentView === 'main' ? 'Paramètres' :
             currentView === 'profile' ? 'Profil' :
             currentView === 'account' ? 'Compte' :
             currentView === 'privacy' ? 'Confidentialité' :
             currentView === 'security' ? 'Sécurité' :
             currentView === '2fa' ? 'Authentification 2FA' :
             currentView === 'delete' ? 'Supprimer le compte' :
             currentView === 'discussions' ? 'Discussions' :
             currentView === 'wallpaper' ? 'Fond d\'écran' :
             currentView === 'notifications' ? 'Notifications' :
             currentView === 'message-notif' ? 'Notifications de messages' :
             currentView === 'call-notif' ? 'Notifications d\'appels' :
             currentView === 'storage' ? 'Stockage et données' :
             currentView === 'network' ? 'Utilisation des données' :
             currentView === 'backup' ? 'Sauvegarde des discussions' :
             currentView === 'faq' ? 'FAQ' :
             currentView === 'contact' ? 'Nous contacter' :
             currentView === 'terms' ? 'Politique de confidentialité' :
             'Aide'}
          </h1>
        </div>
        {views[currentView]()}
      </div>
    </MainLayout>
  )
}
