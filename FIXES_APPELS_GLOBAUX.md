# Correction - Système d'Appels Global

## Problème Résolu

**Problème Initial** : Quand un utilisateur appelait depuis un smartphone vers un laptop, le laptop ne recevait pas les notifications d'appel. L'écran d'appel n'apparaissait pas.

**Cause Racine** : Le hook [`useWebRTCCall`](src/hooks/useWebRTCCall.ts) n'était actif que dans la page de chat ouverte ([`ChatViewPage`](src/pages/ChatViewPage.tsx)). Si l'utilisateur était sur une autre page (liste des chats, contacts, paramètres, etc.), le hook n'était pas monté et ne pouvait pas recevoir les signaux d'appel entrant.

## Solution Implémentée

### 1. Création d'un Contexte Global d'Appels ✅

**Fichier** : [`src/context/CallContext.tsx`](src/context/CallContext.tsx)

Un nouveau contexte React a été créé pour gérer les appels de manière globale dans toute l'application :

```typescript
export function CallProvider({ children }: { children: ReactNode }) {
  // États globaux pour les appels
  const [isInCall, setIsInCall] = useState(false)
  const [isRinging, setIsRinging] = useState(false)
  const [isCalling, setIsCalling] = useState(false)
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)

  // Souscription GLOBALE aux signaux d'appel
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('global-webrtc-signals')
      .on('broadcast', { event: 'call-signal' }, async (payload) => {
        const signal = payload.payload as CallSignal
        
        // Traiter les signaux d'appel entrant
        if (signal.to === user.id) {
          handleIncomingSignal(signal)
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user])
}
```

**Avantages** :
- ✅ Le contexte est monté au niveau de l'application entière
- ✅ Écoute les appels entrants sur TOUTES les pages
- ✅ Gère l'état des appels de manière centralisée
- ✅ Envoie des notifications système quand un appel arrive

### 2. Composant d'Écran d'Appel Global ✅

**Fichier** : [`src/components/GlobalCallScreen.tsx`](src/components/GlobalCallScreen.tsx)

Un composant qui affiche l'écran d'appel au-dessus de toutes les pages :

```typescript
export function GlobalCallScreen() {
  const {
    isInCall, isRinging, isCalling,
    localStream, remoteStream,
    incomingCall,
    answerCall, rejectCall, endCall,
    toggleAudio, toggleVideo,
  } = useCall()

  // N'afficher que si un appel est actif
  if (!isInCall && !isRinging && !isCalling) {
    return null
  }

  return <CallScreen {...props} />
}
```

**Caractéristiques** :
- ✅ S'affiche en overlay (z-index élevé)
- ✅ Visible sur toutes les pages
- ✅ Affiche les informations de l'appelant
- ✅ Boutons Répondre/Rejeter pour les appels entrants

### 3. Intégration dans l'Application ✅

**Fichier** : [`src/App.tsx`](src/App.tsx)

Le `CallProvider` et `GlobalCallScreen` ont été ajoutés au niveau racine :

```typescript
function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CallProvider>              {/* ← Contexte global */}
            <OfflineIndicator />
            <GlobalCallScreen />       {/* ← Écran d'appel global */}
            <AppRoutes />
          </CallProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
```

### 4. Mise à Jour de ChatViewPage ✅

**Fichier** : [`src/pages/ChatViewPage.tsx`](src/pages/ChatViewPage.tsx)

La page de chat utilise maintenant le contexte global au lieu du hook local :

```typescript
// Avant
const { startCall, answerCall, endCall, ... } = useWebRTCCall(user?.id || '')

// Après
const { startCall } = useCall()  // Utilise le contexte global
```

**Changements** :
- ✅ Suppression du hook local `useWebRTCCall`
- ✅ Utilisation du contexte global `useCall`
- ✅ Suppression de l'écran d'appel local (géré globalement)

## Fonctionnement

### Scénario : Appel Smartphone → Laptop

1. **Utilisateur A (Smartphone)** : Clique sur le bouton d'appel vidéo
2. **Signal Envoyé** : Un signal `offer` est envoyé via Supabase Realtime
3. **Laptop (Utilisateur B)** : 
   - Le `CallContext` reçoit le signal (peu importe la page)
   - Met `isRinging` à `true`
   - Récupère le nom de l'appelant depuis la base de données
   - Envoie une notification système
   - Fait vibrer l'appareil (si supporté)
4. **Affichage** : Le `GlobalCallScreen` s'affiche automatiquement
5. **Utilisateur B** : Peut répondre ou rejeter l'appel

### Logs de Débogage

Le système inclut des logs détaillés pour le débogage :

```typescript
console.log('🔔 CallContext: Setting up global call listener for user:', user.id)
console.log('🔔 CallContext: Received signal:', signal.type, 'from:', signal.from)
console.log('🔔 CallContext: Incoming call offer')
console.log('📞 Starting call to:', userId)
```

## Notifications Système

Quand un appel arrive, une notification système est envoyée :

```typescript
if ('Notification' in window && Notification.permission === 'granted') {
  const callType = isVideo ? '📹 Appel vidéo' : '📞 Appel audio'
  
  registration.showNotification(`${callType} entrant`, {
    body: `${callerName} vous appelle...`,
    icon: '/icon-192.png',
    requireInteraction: true,
    actions: [
      { action: 'answer', title: 'Répondre' },
      { action: 'reject', title: 'Refuser' },
    ],
  })
}
```

## Fichiers Modifiés

1. ✅ **Nouveau** : [`src/context/CallContext.tsx`](src/context/CallContext.tsx) - Contexte global des appels
2. ✅ **Nouveau** : [`src/components/GlobalCallScreen.tsx`](src/components/GlobalCallScreen.tsx) - Écran d'appel global
3. ✅ **Modifié** : [`src/App.tsx`](src/App.tsx) - Intégration du CallProvider
4. ✅ **Modifié** : [`src/pages/ChatViewPage.tsx`](src/pages/ChatViewPage.tsx) - Utilisation du contexte global

## Tests Recommandés

### Test 1 : Appel depuis Smartphone vers Laptop
1. Ouvrir l'app sur smartphone (Utilisateur A)
2. Ouvrir l'app sur laptop (Utilisateur B) - sur n'importe quelle page
3. Utilisateur A lance un appel vidéo vers Utilisateur B
4. **Résultat attendu** : Le laptop affiche l'écran d'appel avec notification

### Test 2 : Appel sur Différentes Pages
1. Utilisateur B est sur la page des paramètres
2. Utilisateur A appelle Utilisateur B
3. **Résultat attendu** : L'écran d'appel s'affiche par-dessus les paramètres

### Test 3 : Notifications
1. Utilisateur B a l'onglet en arrière-plan
2. Utilisateur A appelle Utilisateur B
3. **Résultat attendu** : Notification système + vibration

## Déploiement

**Commit** : `31c5e1a` - "Fix: Global call system - receive calls on any page (laptop notifications)"

**URL Production** : https://anu-9d3os2sc9-jema-s-projects.vercel.app

**Build** : Réussi en 13 secondes

## Avantages de la Solution

✅ **Réception Universelle** : Les appels sont reçus sur toutes les pages
✅ **Notifications Système** : Alertes même si l'onglet est en arrière-plan
✅ **État Centralisé** : Un seul point de gestion des appels
✅ **Performance** : Pas de duplication de connexions WebRTC
✅ **Expérience Utilisateur** : Interface cohérente sur toutes les pages
✅ **Débogage Facile** : Logs détaillés pour identifier les problèmes

## Notes Techniques

### Supabase Realtime
- Canal unique : `global-webrtc-signals`
- Événement : `call-signal`
- Broadcast pour la communication peer-to-peer

### WebRTC
- Utilise le `webrtcManager` singleton
- Serveurs STUN : Google STUN servers
- Support audio et vidéo

### React Context
- Provider au niveau racine
- Hook `useCall()` accessible partout
- Nettoyage automatique des ressources