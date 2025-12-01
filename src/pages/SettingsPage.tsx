import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft, User, Lock, Bell, MessageSquare, Video, Palette,
  Globe, Database, HelpCircle, Info, LogOut, ChevronRight,
  Moon, Sun, Monitor, Check, Camera, Edit2, Shield, Key, Trash2,
  Eye, EyeOff, Download, Wifi, WifiOff, Mail
} from 'lucide-react'

type SettingsView = 'main' | 'profile' | 'account' | 'privacy' | 'security' | '2fa' | 'delete' | 
                     'discussions' | 'wallpaper' | 'notifications' | 'message-notif' | 'call-notif' |
                     'storage' | 'network' | 'help' | 'faq' | 'contact' | 'terms'

export function SettingsPage() {
  const { profile, signOut, user } = useAuth()
  const { theme, wallpaper, setTheme, setWallpaper } = useTheme()
  const navigate = useNavigate()
  const [currentView, setCurrentView] = useState<SettingsView>('main')
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState(profile?.display_name || '')
  const [editingBio, setEditingBio] = useState(false)
  const [newBio, setNewBio] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [showLastSeen, setShowLastSeen] = useState(true)
  const [showProfilePhoto, setShowProfilePhoto] = useState(true)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [enterToSend, setEnterToSend] = useState(true)
  const [autoDownload, setAutoDownload] = useState(true)


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
            <input type="text" placeholder="Ajouter une info..." value={editingBio ? newBio : ''} onChange={(e) => setNewBio(e.target.value)} onFocus={() => setEditingBio(true)} className="flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-secondary" />
            {editingBio ? <button onClick={handleUpdateBio} className="text-accent"><Check size={18} /></button> : <Edit2 size={18} className="text-text-secondary" />}
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

  const renderStorageView = () => (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="py-2">
        <div className="px-6 py-4 bg-bg-surface mx-4 rounded-2xl mb-4">
          <div className="text-center space-y-2">
            <Database size={48} className="mx-auto text-accent" />
            <div className="text-2xl font-bold text-text-primary">125 MB</div>
            <div className="text-sm text-text-secondary">Espace utilisé</div>
          </div>
        </div>
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
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-text-primary">Téléchargement automatique</div>
          <div className="text-sm text-text-secondary">Photos, vidéos et fichiers</div>
        </div>
        <button onClick={() => setAutoDownload(!autoDownload)} className={`w-12 h-6 rounded-full relative transition-colors ${autoDownload ? 'bg-accent' : 'bg-[#8696a0]'}`}>
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoDownload ? 'right-1' : 'left-1'}`}></div>
        </button>
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
    'message-notif': renderNotificationsView,
    'call-notif': renderNotificationsView,
    storage: renderStorageView,
    network: renderNetworkView,
    help: renderHelpView,
    faq: renderFAQView,
    contact: renderContactView,
    terms: renderTermsView,
  }

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-20 md:pb-0 overflow-hidden">
        <div className="bg-bg-surface px-4 py-3 flex items-center gap-4">
          {currentView !== 'main' && (
            <button onClick={() => setCurrentView('main')} className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
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
