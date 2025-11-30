# Plan d'Implémentation - Fonctionnalités Manquantes Anu-App

**Version**: 1.0  
**Date**: 2025-11-30  
**Auteur**: Kilo Code - Architect Mode  
**Statut**: Draft pour Review

---

## 📋 Table des Matières

1. [Vue d'Ensemble](#vue-densemble)
2. [Analyse de l'Existant](#analyse-de-lexistant)
3. [Matrice de Priorisation](#matrice-de-priorisation)
4. [Architecture Technique par Fonctionnalité](#architecture-technique-par-fonctionnalité)
5. [Roadmap par Phases](#roadmap-par-phases)
6. [Estimations et Ressources](#estimations-et-ressources)
7. [Risques et Mitigation](#risques-et-mitigation)
8. [Recommandations](#recommandations)

---

## 🎯 Vue d'Ensemble

### Contexte

Anu-app est actuellement à **~45% de complétude** par rapport aux fonctionnalités WhatsApp. L'application dispose d'une base solide avec:
- Architecture centralisée Supabase (Auth + DB + Realtime + Storage)
- Frontend React 18.3.1 + TypeScript + Vite
- Design Glassmorphism moderne (#6b6fdb)
- 9 tables DB avec RLS actives
- Messagerie temps réel fonctionnelle

### Objectif du Plan

Définir une roadmap pragmatique et réalisable pour atteindre **85-90% de complétude** en implémentant les fonctionnalités critiques manquantes, tout en respectant:
- Les contraintes budgétaires
- L'architecture existante
- La compatibilité avec le code en production
- Un déploiement progressif par phases

---

## 📊 Analyse de l'Existant

### Stack Technique Actuelle

```
Frontend:
├── React 18.3.1 + TypeScript 5.6.2
├── Vite 6.2.6 (Build tool)
├── Tailwind CSS 3.4.17
├── React Router 7.1.1
├── Lucide React 0.468.0 (Icons)
└── Radix UI (Components)

Backend:
├── Supabase (BaaS)
│   ├── Auth (Pseudo + Password)
│   ├── PostgreSQL + RLS
│   ├── Realtime (WebSocket)
│   └── Storage (2 buckets)
└── Edge Functions (1 fonction)

Design:
├── Glassmorphism style
├── Color: #6b6fdb (primary)
├── Backdrop blur: 20-40px
└── Animations: 400-600ms
```

### Base de Données (9 Tables)

| Table | Statut | Utilisation |
|-------|--------|-------------|
| `profiles` | ✅ 100% | Profils utilisateurs |
| `conversations` | ✅ 95% | Conversations directes/groupes |
| `conversation_members` | ✅ 100% | Membres des conversations |
| `messages` | ⚠️ 60% | Messages (structure complète, fonctionnalités limitées) |
| `contacts` | ✅ 100% | Relations de contact |
| `files` | ⚠️ 30% | Métadonnées fichiers (structure DB uniquement) |
| `statuses` | ✅ 90% | Statuts 24h |
| `devices` | ⚠️ 40% | Appareils (structure DB, pas d'utilisation) |
| `call_logs` | ❌ 0% | Historique appels (table vide) |

### Fonctionnalités Implémentées (45%)

✅ **Complètes**:
- Authentification par pseudo
- Gestion des contacts
- Messagerie texte temps réel
- Création de groupes
- Statuts 24h
- Interface Glassmorphism

⚠️ **Partielles**:
- Partage d'images (structure DB, UI limitée)
- Indicateurs de chiffrement (visuels uniquement)
- Gestion des appareils (DB uniquement)

❌ **Manquantes**:
- Appels audio/vidéo
- Messages vocaux
- Réactions aux messages
- Réponses/citations
- Recherche dans messages
- Messages éphémères
- Notifications push
- Mode hors ligne
- E2EE véritable (Signal Protocol)

---

## 🎯 Matrice de Priorisation

### Méthodologie

Chaque fonctionnalité est évaluée selon 4 critères:

1. **Impact Utilisateur** (1-5): Importance pour l'expérience utilisateur
2. **Complexité Technique** (1-5): Difficulté d'implémentation
3. **Dépendances** (1-5): Nombre de dépendances avec d'autres fonctionnalités
4. **Score de Priorité**: `(Impact × 2) - Complexité - (Dépendances × 0.5)`

### Tableau de Priorisation

| # | Fonctionnalité | Impact | Complexité | Dépendances | Score | Priorité |
|---|----------------|--------|------------|-------------|-------|----------|
| 1 | **Réactions aux messages** | 4 | 2 | 1 | **5.5** | 🔴 CRITIQUE |
| 2 | **Réponses/Citations** | 5 | 2 | 1 | **7.5** | 🔴 CRITIQUE |
| 3 | **Recherche messages** | 4 | 2 | 1 | **5.5** | 🔴 CRITIQUE |
| 4 | **Messages vocaux** | 5 | 3 | 2 | **6.0** | 🔴 CRITIQUE |
| 5 | **Partage médias amélioré** | 4 | 2 | 1 | **5.5** | 🔴 CRITIQUE |
| 6 | **Notifications push** | 5 | 3 | 2 | **6.0** | 🟠 IMPORTANT |
| 7 | **Messages éphémères** | 3 | 2 | 1 | **3.5** | 🟠 IMPORTANT |
| 8 | **Mode hors ligne** | 4 | 4 | 3 | **2.5** | 🟠 IMPORTANT |
| 9 | **Appels audio** | 5 | 5 | 4 | **3.0** | 🟡 AVANCÉ |
| 10 | **Appels vidéo** | 4 | 5 | 5 | **0.5** | 🟡 AVANCÉ |
| 11 | **E2EE Signal Protocol** | 3 | 5 | 4 | **-1.0** | 🟡 AVANCÉ |

### Légende des Priorités

- 🔴 **CRITIQUE** (Score > 5): Quick wins, impact élevé, complexité faible
- 🟠 **IMPORTANT** (Score 2-5): Fonctionnalités essentielles, complexité moyenne
- 🟡 **AVANCÉ** (Score < 2): Fonctionnalités complexes, long terme

---

## 🏗️ Architecture Technique par Fonctionnalité

### 1. Réactions aux Messages 🔴

**Impact**: Haute | **Complexité**: Faible | **Temps**: 3-4 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  ChatViewPage.tsx                        │  │
│  │  - Bouton réaction (emoji picker)        │  │
│  │  - Affichage réactions groupées          │  │
│  │  - Animation d'ajout/retrait             │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Database                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Table: message_reactions (NEW)          │  │
│  │  - id: UUID                              │  │
│  │  - message_id: UUID (FK)                 │  │
│  │  - user_id: UUID (FK)                    │  │
│  │  - emoji: TEXT                           │  │
│  │  - created_at: TIMESTAMPTZ               │  │
│  │  UNIQUE(message_id, user_id, emoji)      │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Realtime                     │
│  - Subscription sur message_reactions          │
│  - Mise à jour temps réel des compteurs        │
└─────────────────────────────────────────────────┘
```

#### Modifications DB

**Nouvelle table**: `message_reactions`

```sql
CREATE TABLE message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (length(emoji) <= 10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_user ON message_reactions(user_id);

-- RLS Policies
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see reactions in their conversations"
  ON message_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE m.id = message_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users add reactions"
  ON message_reactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users remove own reactions"
  ON message_reactions FOR DELETE
  USING (auth.uid() = user_id);
```

#### Composants React à Créer

1. **`MessageReactions.tsx`** - Affichage des réactions groupées
2. **`EmojiPicker.tsx`** - Sélecteur d'emoji (utiliser `emoji-picker-react`)
3. **`ReactionButton.tsx`** - Bouton d'ajout de réaction

#### Hooks à Implémenter

```typescript
// hooks/useMessageReactions.ts
export function useMessageReactions(messageId: string) {
  const [reactions, setReactions] = useState<Reaction[]>([])
  
  useEffect(() => {
    // Load reactions
    loadReactions()
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel(`reactions:${messageId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
        filter: `message_id=eq.${messageId}`
      }, handleReactionChange)
      .subscribe()
    
    return () => { supabase.removeChannel(channel) }
  }, [messageId])
  
  const addReaction = async (emoji: string) => { /* ... */ }
  const removeReaction = async (reactionId: string) => { /* ... */ }
  
  return { reactions, addReaction, removeReaction }
}
```

#### Dépendances NPM

```json
{
  "emoji-picker-react": "^4.9.2"
}
```

#### Étapes d'Implémentation

1. **Jour 1**: Créer migration DB + RLS policies
2. **Jour 2**: Implémenter hook `useMessageReactions` + composant `EmojiPicker`
3. **Jour 3**: Intégrer dans `ChatViewPage` + composant `MessageReactions`
4. **Jour 4**: Tests + animations + optimisations

---

### 2. Réponses/Citations de Messages 🔴

**Impact**: Très Haute | **Complexité**: Faible | **Temps**: 4-5 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  ChatViewPage.tsx                        │  │
│  │  - Bouton "Répondre" sur message         │  │
│  │  - Preview du message cité               │  │
│  │  - Scroll vers message original          │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Database                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Table: messages (EXISTING)              │  │
│  │  - reply_to_id: UUID (ALREADY EXISTS)    │  │
│  │  → Utiliser colonne existante            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Modifications DB

**Aucune modification nécessaire** - La colonne `reply_to_id` existe déjà dans la table `messages`.

Il faut juste ajouter une **foreign key** pour l'intégrité:

```sql
-- Ajouter contrainte FK si pas déjà présente
ALTER TABLE messages
ADD CONSTRAINT fk_reply_to_message
FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id);
```

#### Composants React à Créer

1. **`MessageReplyPreview.tsx`** - Preview du message cité dans l'input
2. **`QuotedMessage.tsx`** - Affichage du message cité dans la bulle
3. **`MessageContextMenu.tsx`** - Menu contextuel avec option "Répondre"

#### Hooks à Implémenter

```typescript
// hooks/useMessageReply.ts
export function useMessageReply() {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  
  const startReply = (message: Message) => {
    setReplyingTo(message)
  }
  
  const cancelReply = () => {
    setReplyingTo(null)
  }
  
  const sendReply = async (content: string) => {
    if (!replyingTo) return
    
    await supabase.from('messages').insert({
      conversation_id: replyingTo.conversation_id,
      sender_id: user.id,
      content,
      reply_to_id: replyingTo.id,
      type: 'text',
      status: 'sent'
    })
    
    cancelReply()
  }
  
  return { replyingTo, startReply, cancelReply, sendReply }
}
```

#### Modifications dans ChatViewPage.tsx

```typescript
// Charger les messages avec leurs réponses
const loadMessages = async () => {
  const { data } = await supabase
    .from('messages')
    .select(`
      *,
      replied_message:reply_to_id (
        id,
        content,
        sender_id,
        type,
        created_at
      )
    `)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  
  setMessages(data)
}
```

#### Étapes d'Implémentation

1. **Jour 1**: Ajouter FK + index DB, créer hook `useMessageReply`
2. **Jour 2**: Composant `MessageReplyPreview` + intégration input
3. **Jour 3**: Composant `QuotedMessage` + affichage dans bulles
4. **Jour 4**: Menu contextuel + scroll vers message original
5. **Jour 5**: Tests + animations + edge cases

---

### 3. Recherche dans les Messages 🔴

**Impact**: Haute | **Complexité**: Moyenne | **Temps**: 5-6 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  SearchBar.tsx                           │  │
│  │  - Input avec debounce (300ms)           │  │
│  │  - Filtres (date, type, expéditeur)     │  │
│  │  - Résultats avec highlight              │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Database                     │
│  ┌──────────────────────────────────────────┐  │
│  │  PostgreSQL Full-Text Search             │  │
│  │  - tsvector column sur messages.content  │  │
│  │  - GIN index pour performance            │  │
│  │  - Fonction search_messages()            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Modifications DB

**Ajouter Full-Text Search**:

```sql
-- Ajouter colonne tsvector pour recherche
ALTER TABLE messages
ADD COLUMN content_search tsvector
GENERATED ALWAYS AS (to_tsvector('french', coalesce(content, ''))) STORED;

-- Index GIN pour performance
CREATE INDEX idx_messages_content_search ON messages USING GIN(content_search);

-- Fonction de recherche
CREATE OR REPLACE FUNCTION search_messages(
  search_query TEXT,
  user_id_param UUID,
  conversation_id_param UUID DEFAULT NULL,
  limit_param INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  sender_id UUID,
  content TEXT,
  type TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.type,
    m.created_at,
    ts_rank(m.content_search, websearch_to_tsquery('french', search_query)) as rank
  FROM messages m
  JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
  WHERE 
    cm.user_id = user_id_param
    AND m.deleted_at IS NULL
    AND m.content_search @@ websearch_to_tsquery('french', search_query)
    AND (conversation_id_param IS NULL OR m.conversation_id = conversation_id_param)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### Composants React à Créer

1. **`SearchPage.tsx`** - Page dédiée à la recherche
2. **`SearchBar.tsx`** - Barre de recherche avec autocomplete
3. **`SearchResults.tsx`** - Liste des résultats avec highlight
4. **`SearchFilters.tsx`** - Filtres avancés

#### Hooks à Implémenter

```typescript
// hooks/useMessageSearch.ts
export function useMessageSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({
    conversationId: null,
    dateFrom: null,
    dateTo: null,
    messageType: null
  })
  
  // Debounced search
  const debouncedSearch = useMemo(
    () => debounce(async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([])
        return
      }
      
      setLoading(true)
      const { data, error } = await supabase.rpc('search_messages', {
        search_query: searchQuery,
        user_id_param: user.id,
        conversation_id_param: filters.conversationId,
        limit_param: 50
      })
      
      if (!error && data) {
        setResults(data)
      }
      setLoading(false)
    }, 300),
    [filters]
  )
  
  useEffect(() => {
    debouncedSearch(query)
  }, [query, debouncedSearch])
  
  return { query, setQuery, results, loading, filters, setFilters }
}
```

#### Dépendances NPM

```json
{
  "lodash.debounce": "^4.0.8",
  "@types/lodash.debounce": "^4.0.9"
}
```

#### Étapes d'Implémentation

1. **Jour 1**: Migration DB (tsvector + GIN index + fonction)
2. **Jour 2**: Hook `useMessageSearch` + fonction RPC
3. **Jour 3**: Composant `SearchBar` avec debounce
4. **Jour 4**: Composant `SearchResults` avec highlight
5. **Jour 5**: Filtres avancés + page dédiée
6. **Jour 6**: Tests + optimisations + edge cases

---

### 4. Messages Vocaux 🔴

**Impact**: Très Haute | **Complexité**: Moyenne | **Temps**: 6-7 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  VoiceRecorder.tsx                       │  │
│  │  - MediaRecorder API                     │  │
│  │  - Waveform visualization               │  │
│  │  - Timer + Cancel/Send                   │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  VoiceMessagePlayer.tsx                  │  │
│  │  - Audio player avec waveform            │  │
│  │  - Playback speed (1x, 1.5x, 2x)        │  │
│  │  - Progress bar                          │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Storage                      │
│  ┌──────────────────────────────────────────┐  │
│  │  Bucket: voice_messages (NEW)            │  │
│  │  - Format: WebM/Opus (compression)       │  │
│  │  - Max size: 10MB (~10 min)             │  │
│  │  - Auto-delete après 30 jours            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Database                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Table: messages (EXISTING)              │  │
│  │  - type: 'audio' (ALREADY EXISTS)        │  │
│  │  - file_url: URL du fichier audio       │  │
│  │  - file_size: Taille en bytes            │  │
│  │  - duration: INT (NEW COLUMN)            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Modifications DB

```sql
-- Ajouter colonne duration pour messages audio
ALTER TABLE messages
ADD COLUMN duration INTEGER; -- Durée en secondes

-- Créer bucket storage pour messages vocaux
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice_messages', 'voice_messages', false);

-- RLS policies pour voice_messages bucket
CREATE POLICY "Users upload voice messages"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'voice_messages' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users access voice messages in their conversations"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'voice_messages' AND
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
    WHERE m.file_url = storage.objects.name
    AND cm.user_id = auth.uid()
  )
);
```

#### Composants React à Créer

1. **`VoiceRecorder.tsx`** - Enregistreur vocal avec waveform
2. **`VoiceMessagePlayer.tsx`** - Lecteur audio avec contrôles
3. **`WaveformVisualizer.tsx`** - Visualisation de la forme d'onde
4. **`RecordButton.tsx`** - Bouton d'enregistrement animé

#### Hooks à Implémenter

```typescript
// hooks/useVoiceRecorder.ts
export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        chunksRef.current = []
        stream.getTracks().forEach(track => track.stop())
      }
      
      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
      
      // Timer
      const startTime = Date.now()
      const interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000))
      }, 1000)
      
      return () => clearInterval(interval)
    } catch (error) {
      console.error('Error starting recording:', error)
    }
  }
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }
  
  const cancelRecording = () => {
    stopRecording()
    setAudioBlob(null)
    setDuration(0)
  }
  
  const uploadVoiceMessage = async (conversationId: string) => {
    if (!audioBlob) return null
    
    const fileName = `${user.id}/${Date.now()}.webm`
    const { data, error } = await supabase.storage
      .from('voice_messages')
      .upload(fileName, audioBlob)
    
    if (error) throw error
    
    const { data: { publicUrl } } = supabase.storage
      .from('voice_messages')
      .getPublicUrl(fileName)
    
    return { url: publicUrl, duration, size: audioBlob.size }
  }
  
  return {
    isRecording,
    duration,
    audioBlob,
    startRecording,
    stopRecording,
    cancelRecording,
    uploadVoiceMessage
  }
}
```

#### Dépendances NPM

```json
{
  "wavesurfer.js": "^7.7.3",
  "@types/wavesurfer.js": "^6.0.7"
}
```

#### Étapes d'Implémentation

1. **Jour 1**: Migration DB + création bucket storage
2. **Jour 2**: Hook `useVoiceRecorder` + MediaRecorder API
3. **Jour 3**: Composant `VoiceRecorder` avec UI
4. **Jour 4**: Composant `WaveformVisualizer` avec wavesurfer.js
5. **Jour 5**: Composant `VoiceMessagePlayer` avec contrôles
6. **Jour 6**: Intégration dans `ChatViewPage` + upload
7. **Jour 7**: Tests + optimisations + permissions

---

### 5. Partage de Médias Amélioré 🔴

**Impact**: Haute | **Complexité**: Moyenne | **Temps**: 5-6 jours

#### Architecture Actuelle vs Cible

**Actuel**:
- Structure DB complète (`files` table)
- Bucket storage `files` (50MB max)
- UI limitée (bouton Paperclip non fonctionnel)

**Cible**:
- Upload multi-fichiers (images, vidéos, documents)
- Preview avant envoi
- Compression automatique des images
- Progress bar d'upload
- Galerie de médias dans conversation

#### Modifications DB

```sql
-- Ajouter colonnes manquantes dans table files
ALTER TABLE files
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS width INTEGER,
ADD COLUMN IF NOT EXISTS height INTEGER,
ADD COLUMN IF NOT EXISTS is_compressed BOOLEAN DEFAULT false;

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_files_conversation ON files(conversation_id);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type);
```

#### Composants React à Créer

1. **`MediaUploader.tsx`** - Upload multi-fichiers avec drag & drop
2. **`MediaPreview.tsx`** - Preview avant envoi
3. **`MediaGallery.tsx`** - Galerie de médias dans conversation
4. **`ImageCompressor.tsx`** - Compression côté client
5. **`UploadProgress.tsx`** - Barre de progression

#### Hooks à Implémenter

```typescript
// hooks/useMediaUpload.ts
export function useMediaUpload() {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  
  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')!
          
          // Max dimensions
          const MAX_WIDTH = 1920
          const MAX_HEIGHT = 1920
          
          let width = img.width
          let height = img.height
          
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width
              width = MAX_WIDTH
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height
              height = MAX_HEIGHT
            }
          }
          
          canvas.width = width
          canvas.height = height
          ctx.drawImage(img, 0, 0, width, height)
          
          canvas.toBlob((blob) => {
            resolve(blob!)
          }, 'image/jpeg', 0.85)
        }
        img.src = e.target!.result as string
      }
      reader.readAsDataURL(file)
    })
  }
  
  const uploadMedia = async (
    conversationId: string,
    files: File[]
  ): Promise<UploadedMedia[]> => {
    setUploading(true)
    const uploadedMedia: UploadedMedia[] = []
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setProgress(((i + 1) / files.length) * 100)
      
      // Compress images
      let fileToUpload: File | Blob = file
      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file)
      }
      
      // Upload to storage
      const fileName = `${conversationId}/${Date.now()}_${file.name}`
      const { data, error } = await supabase.storage
        .from('files')
        .upload(fileName, fileToUpload)
      
      if (!error && data) {
        const { data: { publicUrl } } = supabase.storage
          .from('files')
          .getPublicUrl(fileName)
        
        // Save metadata to files table
        const { data: fileData } = await supabase
          .from('files')
          .insert({
            conversation_id: conversationId,
            uploaded_by: user.id,
            file_name: file.name,
            file_type: file.type.split('/')[0], // image, video, document
            file_size: fileToUpload.size,
            file_url: publicUrl,
            mime_type: file.type,
            is_compressed: file.type.startsWith('image/')
          })
          .select()
          .single()
        
        uploadedMedia.push(fileData)
      }
    }
    
    setUploading(false)
    setProgress(0)
    return uploadedMedia
  }
  
  return {
    uploading,
    progress,
    selectedFiles,
    setSelectedFiles,
    uploadMedia
  }
}
```

#### Dépendances NPM

```json
{
  "react-dropzone": "^14.2.3",
  "browser-image-compression": "^2.0.2"
}
```

#### Étapes d'Implémentation

1. **Jour 1**: Migration DB + ajout colonnes
2. **Jour 2**: Hook `useMediaUpload` + compression
3. **Jour 3**: Composant `MediaUploader` avec drag & drop
4. **Jour 4**: Composant `MediaPreview` + validation
5. **Jour 5**: Intégration dans `ChatViewPage` + progress bar
6. **Jour 6**: Composant `MediaGallery` + tests

---

### 6. Notifications Push 🟠

**Impact**: Très Haute | **Complexité**: Moyenne-Haute | **Temps**: 7-8 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  Service Worker (sw.js)                  │  │
│  │  - Push notification handler             │  │
│  │  - Background sync                       │  │
│  │  - Notification click handler            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Firebase Cloud Messaging (FCM)        │
│  - Token generation                             │
│  - Push notification delivery                   │
│  - Topic subscriptions                          │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Edge Function                │
│  ┌──────────────────────────────────────────┐  │
│  │  Function: send-notification             │  │
│  │  - Trigger: INSERT sur messages          │  │
│  │  - Récupère FCM tokens destinataires    │  │
│  │  - Envoie notification via FCM API       │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Database                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Table: push_tokens (NEW)                │  │
│  │  - id: UUID                              │  │
│  │  - user_id: UUID                         │  │
│  │  - device_id: UUID                       │  │
│  │  - fcm_token: TEXT                       │  │
│  │  - platform: TEXT (web/ios/android)     │  │
│  │  - is_active: BOOLEAN                    │  │
│  │  - created_at: TIMESTAMPTZ               │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Modifications DB

```sql
-- Table pour stocker les tokens FCM
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  fcm_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX idx_push_tokens_active ON push_tokens(is_active) WHERE is_active = true;

-- RLS Policies
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tokens"
  ON push_tokens FOR ALL
  USING (auth.uid() = user_id);

-- Table pour préférences de notifications
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  messages_enabled BOOLEAN DEFAULT true,
  calls_enabled BOOLEAN DEFAULT true,
  groups_enabled BOOLEAN DEFAULT true,
  reactions_enabled BOOLEAN DEFAULT true,
  mute_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own preferences"
  ON notification_preferences FOR ALL
  USING (auth.uid() = user_id);
```

#### Edge Function: send-notification

```typescript
// supabase/functions/send-notification/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FCM_SERVER_KEY = Deno.env.get('FCM_SERVER_KEY')!

serve(async (req) => {
  try {
    const { record } = await req.json() // Message record from trigger
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    // Get conversation members (except sender)
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', record.conversation_id)
      .neq('user_id', record.sender_id)
    
    if (!members || members.length === 0) {
      return new Response('No recipients', { status: 200 })
    }
    
    // Get sender info
    const { data: sender } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', record.sender_id)
      .single()
    
    // Get FCM tokens for recipients
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('fcm_token, user_id')
      .in('user_id', members.map(m => m.user_id))
      .eq('is_active', true)
    
    if (!tokens || tokens.length === 0) {
      return new Response('No active tokens', { status: 200 })
    }
    
    // Check notification preferences
    const { data: preferences } = await supabase
      .from('notification_preferences')
      .select('*')
      .in('user_id', tokens.map(t => t.user_id))
    
    // Filter tokens based on preferences
    const activeTokens = tokens.filter(token => {
      const pref = preferences?.find(p => p.user_id === token.user_id)
      if (!pref) return true // Default: enabled
      if (pref.mute_until && new Date(pref.mute_until) > new Date()) return false
      return pref.messages_enabled
    })
    
    // Send notifications via FCM
    const notifications = activeTokens.map(token => ({
      to: token.fcm_token,
      notification: {
        title: sender?.display_name || sender?.username || 'Nouveau message',
        body: record.type === 'text' 
          ? record.content 
          : record.type === 'audio' 
            ? '🎤 Message vocal' 
            : '📎 Fichier',
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        tag: record.conversation_id,
        data: {
          conversationId: record.conversation_id,
          messageId: record.id,
          url: `/chat/${record.conversation_id}`
        }
      }
    }))
    
    const responses = await Promise.all(
      notifications.map(notification =>
        fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Authorization': `key=${FCM_SERVER_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(notification)
        })
      )
    )
    
    return new Response(JSON.stringify({ sent: responses.length }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
```

#### Service Worker (public/sw.js)

```javascript
// Service Worker pour gérer les notifications push
self.addEventListener('push', (event) => {
  const data = event.data.json()
  const options = {
    body: data.notification.body,
    icon: data.notification.icon,
    badge: data.notification.badge,
    tag: data.notification.tag,
    data: data.notification.data,
    actions: [
      { action: 'open', title: 'Ouvrir' },
      { action: 'close', title: 'Fermer' }
    ]
  }
  
  event.waitUntil(
    self.registration.showNotification(data.notification.title, options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  
  if (event.action === 'open' || !event.action) {
    const url = event.notification.data.url
    event.waitUntil(
      clients.openWindow(url)
    )
  }
})
```

#### Hooks à Implémenter

```typescript
// hooks/usePushNotifications.ts
export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [token, setToken] = useState<string | null>(null)
  
  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission)
    }
  }, [])
  
  const requestPermission = async () => {
    if (!('Notification' in window)) {
      console.error('Notifications not supported')
      return false
    }
    
    const permission = await Notification.requestPermission()
    setPermission(permission)
    
    if (permission === 'granted') {
      await registerServiceWorker()
      await subscribeToPush()
    }
    
    return permission === 'granted'
  }
  
  const registerServiceWorker = async () => {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.register('/sw.js')
      return registration
    }
  }
  
  const subscribeToPush = async () => {
    const registration = await navigator.serviceWorker.ready
    
    // Get FCM token (requires Firebase setup)
    const messaging = getMessaging()
    const fcmToken = await getToken(messaging, {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
    })
    
    setToken(fcmToken)
    
    // Save token to database
    await supabase.from('push_tokens').upsert({
      user_id: user.id,
      fcm_token: fcmToken,
      platform: 'web',
      is_active: true
    })
    
    return fcmToken
  }
  
  const unsubscribe = async () => {
    if (token) {
      await supabase
        .from('push_tokens')
        .update({ is_active: false })
        .eq('fcm_token', token)
    }
  }
  
  return {
    permission,
    token,
    requestPermission,
    unsubscribe
  }
}
```

#### Configuration Firebase

**firebase-config.ts**:
```typescript
import { initializeApp } from 'firebase/app'
import { getMessaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

const app = initializeApp(firebaseConfig)
export const messaging = getMessaging(app)
```

#### Dépendances NPM

```json
{
  "firebase": "^10.8.0"
}
```

#### Variables d'Environnement

```env
# Firebase
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_VAPID_KEY=your_vapid_key

# Supabase Edge Function
FCM_SERVER_KEY=your_fcm_server_key
```

#### Étapes d'Implémentation

1. **Jour 1**: Setup Firebase project + configuration
2. **Jour 2**: Migration DB (push_tokens + preferences)
3. **Jour 3**: Service Worker + hook `usePushNotifications`
4. **Jour 4**: Edge function `send-notification`
5. **Jour 5**: Database trigger sur messages
6. **Jour 6**: UI pour demander permission + préférences
7. **Jour 7**: Tests + gestion erreurs
8. **Jour 8**: Optimisations + documentation

---

### 7. Messages Éphémères 🟠

**Impact**: Moyenne | **Complexité**: Faible | **Temps**: 3-4 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  Timer display sur messages              │  │
│  │  - Countdown visible                     │  │
│  │  - Auto-suppression côté client         │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Database                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Table: messages (EXISTING)              │  │
│  │  - expires_at: TIMESTAMPTZ (NEW)         │  │
│  │  - is_ephemeral: BOOLEAN (NEW)           │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Edge Function (Cron)         │
│  ┌──────────────────────────────────────────┐  │
│  │  Function: cleanup-expired-messages      │  │
│  │  - Runs every 5 minutes                  │  │
│  │  - Soft delete expired messages          │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Modifications DB

```sql
-- Ajouter colonnes pour messages éphémères
ALTER TABLE messages
ADD COLUMN is_ephemeral BOOLEAN DEFAULT false,
ADD COLUMN expires_at TIMESTAMPTZ;

-- Index pour cleanup efficace
CREATE INDEX idx_messages_expires_at ON messages(expires_at) 
WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

-- Ajouter paramètre éphémère aux conversations
ALTER TABLE conversations
ADD COLUMN ephemeral_duration INTEGER; -- Durée en secondes (NULL = désactivé)
```

#### Edge Function: cleanup-expired-messages

```typescript
// supabase/functions/cleanup-expired-messages/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // Soft delete expired messages
  const { data, error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .is('deleted_at', null)
    .eq('is_ephemeral', true)
    .lt('expires_at', new Date().toISOString())
    .select('id')
  
  return new Response(
    JSON.stringify({ 
      deleted: data?.length || 0,
      error: error?.message 
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
```

#### Cron Job Configuration

```sql
-- Configurer cron job (pg_cron extension)
SELECT cron.schedule(
  'cleanup-expired-messages',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/cleanup-expired-messages',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  );
  $$
);
```

#### Composants React à Créer

1. **`EphemeralToggle.tsx`** - Toggle pour activer mode éphémère
2. **`EphemeralTimer.tsx`** - Affichage du countdown
3. **`EphemeralSettings.tsx`** - Paramètres de durée

#### Hooks à Implémenter

```typescript
// hooks/useEphemeralMessages.ts
export function useEphemeralMessages(conversationId: string) {
  const [ephemeralDuration, setEphemeralDuration] = useState<number | null>(null)
  
  useEffect(() => {
    loadEphemeralSettings()
  }, [conversationId])
  
  const loadEphemeralSettings = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('ephemeral_duration')
      .eq('id', conversationId)
      .single()
    
    if (data) {
      setEphemeralDuration(data.ephemeral_duration)
    }
  }
  
  const updateEphemeralDuration = async (duration: number | null) => {
    await supabase
      .from('conversations')
      .update({ ephemeral_duration: duration })
      .eq('id', conversationId)
    
    setEphemeralDuration(duration)
  }
  
  const sendEphemeralMessage = async (content: string) => {
    if (!ephemeralDuration) {
      // Send normal message
      return sendNormalMessage(content)
    }
    
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + ephemeralDuration)
    
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      type: 'text',
      is_ephemeral: true,
      expires_at: expiresAt.toISOString(),
      status: 'sent'
    })
  }
  
  return {
    ephemeralDuration,
    updateEphemeralDuration,
    sendEphemeralMessage
  }
}
```

#### Étapes d'Implémentation

1. **Jour 1**: Migration DB + colonnes éphémères
2. **Jour 2**: Edge function cleanup + cron job
3. **Jour 3**: Hook `useEphemeralMessages` + composants UI
4. **Jour 4**: Tests + intégration ChatViewPage

---

### 8. Mode Hors Ligne avec Synchronisation 🟠

**Impact**: Haute | **Complexité**: Élevée | **Temps**: 10-12 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  Service Worker                          │  │
│  │  - Cache API responses                   │  │
│  │  - Background sync                       │  │
│  │  - Offline detection                     │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  IndexedDB                               │  │
│  │  - Messages cache                        │  │
│  │  - Conversations cache                   │  │
│  │  - Pending operations queue              │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Sync Manager                          │
│  - Detect online/offline                        │
│  - Queue operations when offline                │
│  - Sync when back online                        │
│  - Conflict resolution (last-write-wins)        │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase (when online)                │
│  - Fetch latest data                            │
│  - Push pending operations                      │
│  - Realtime subscriptions                       │
└─────────────────────────────────────────────────┘
```

#### Service Worker Configuration

```javascript
// public/sw.js
const CACHE_NAME = 'anu-app-v1'
const OFFLINE_URL = '/offline.html'

const CACHE_URLS = [
  '/',
  '/offline.html',
  '/index.css',
  '/assets/index.js',
  '/assets/index.css'
]

// Install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_URLS)
    })
  )
  self.skipWaiting()
})

// Activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

// Fetch
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL)
      })
    )
  } else {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request)
      })
    )
  }
})

// Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncPendingMessages())
  }
})

async function syncPendingMessages() {
  // Get pending operations from IndexedDB
  const db = await openDB()
  const pending = await db.getAll('pending_operations')
  
  for (const operation of pending) {
    try {
      // Execute operation
      await fetch(operation.url, {
        method: operation.method,
        headers: operation.headers,
        body: operation.body
      })
      
      // Remove from queue
      await db.delete('pending_operations', operation.id)
    } catch (error) {
      console.error('Sync failed:', error)
    }
  }
}
```

#### IndexedDB Schema

```typescript
// lib/indexedDB.ts
import { openDB, DBSchema, IDBPDatabase } from 'idb'

interface AnuDB extends DBSchema {
  messages: {
    key: string
    value: Message
    indexes: { 'by-conversation': string }
  }
  conversations: {
    key: string
    value: Conversation
  }
  pending_operations: {
    key: string
    value: PendingOperation
  }
}

let db: IDBPDatabase<AnuDB> | null = null

export async function initDB() {
  if (db) return db
  
  db = await openDB<AnuDB>('anu-app', 1, {
    upgrade(db) {
      // Messages store
      const messagesStore = db.createObjectStore('messages', {
        keyPath: 'id'
      })
      messagesStore.createIndex('by-conversation', 'conversation_id')
      
      // Conversations store
      db.createObjectStore('conversations', {
        keyPath: 'id'
      })
      
      // Pending operations store
      db.createObjectStore('pending_operations', {
        keyPath: 'id',
        autoIncrement: true
      })
    }
  })
  
  return db
}

export async function cacheMessage(message: Message) {
  const db = await initDB()
  await db.put('messages', message)
}

export async function getCachedMessages(conversationId: string) {
  const db = await initDB()
  return db.getAllFromIndex('messages', 'by-conversation', conversationId)
}

export async function queueOperation(operation: PendingOperation) {
  const db = await initDB()
  await db.add('pending_operations', operation)
}

export async function getPendingOperations() {
  const db = await initDB()
  return db.getAll('pending_operations')
}

export async function clearPendingOperation(id: number) {
  const db = await initDB()
  await db.delete('pending_operations', id)
}
```

#### Hooks à Implémenter

```typescript
// hooks/useOfflineSync.ts
export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      syncPendingOperations()
    }
    
    const handleOffline = () => {
      setIsOnline(false)
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Load pending count
    loadPendingCount()
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  
  const loadPendingCount = async () => {
    const operations = await getPendingOperations()
    setPendingCount(operations.length)
  }
  
  const syncPendingOperations = async () => {
    setSyncing(true)
    
    try {
      const operations = await getPendingOperations()
      
      for (const operation of operations) {
        try {
          // Execute operation
          if (operation.type === 'send_message') {
            await supabase.from('messages').insert(operation.data)
          } else if (operation.type === 'update_message') {
            await supabase.from('messages')
              .update(operation.data)
              .eq('id', operation.data.id)
          }
          
          // Remove from queue
          await clearPendingOperation(operation.id)
        } catch (error) {
          console.error('Failed to sync operation:', error)
        }
      }
      
      await loadPendingCount()
    } finally {
      setSyncing(false)
    }
  }
  
  const sendMessageOffline = async (message: Omit<Message, 'id'>) => {
    // Generate temporary ID
    const tempId = `temp_${Date.now()}`
    const messageWithId = { ...message, id: tempId }
    
    // Cache locally
    await cacheMessage(messageWithId)
    
    // Queue for sync
    await queueOperation({
      type: 'send_message',
      data: message,
      timestamp: Date.now()
    })
    
    await loadPendingCount()
    
    return messageWithId
  }
  
  return {
    isOnline,
    syncing,
    pendingCount,
    sendMessageOffline,
    syncPendingOperations
  }
}
```

#### Composants React à Créer

1. **`OfflineIndicator.tsx`** - Indicateur de statut en ligne/hors ligne
2. **`SyncStatus.tsx`** - Statut de synchronisation
3. **`PendingOperations.tsx`** - Liste des opérations en attente

#### Dépendances NPM

```json
{
  "idb": "^8.0.0",
  "workbox-window": "^7.0.0"
}
```

#### Étapes d'Implémentation

1. **Jour 1-2**: Service Worker + cache strategy
2. **Jour 3-4**: IndexedDB schema + helpers
3. **Jour 5-6**: Hook `useOfflineSync` + queue management
4. **Jour 7-8**: Intégration dans ChatViewPage
5. **Jour 9-10**: Conflict resolution + sync logic
6. **Jour 11**: Composants UI (indicators, status)
7. **Jour 12**: Tests + edge cases + documentation

---

### 9. Appels Audio (WebRTC) 🟡

**Impact**: Très Haute | **Complexité**: Très Élevée | **Temps**: 15-20 jours

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  WebRTC Manager                          │  │
│  │  - PeerConnection setup                  │  │
│  │  - Media stream handling                 │  │
│  │  - ICE candidate exchange                │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Signaling Server                      │
│  ┌──────────────────────────────────────────┐  │
│  │  Supabase Realtime                       │  │
│  │  - Offer/Answer exchange                 │  │
│  │  - ICE candidates relay                  │  │
│  │  - Call state management                 │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           STUN/TURN Servers                     │
│  - STUN: stun.l.google.com:19302               │
│  - TURN: Twilio/Metered.ca (paid)              │
│  - NAT traversal                                │
└─────────────────────────────────────────────────┘
```

#### Modifications DB

```sql
-- Table pour les appels
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  caller_id UUID NOT NULL REFERENCES profiles(id),
  callee_id UUID NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  status TEXT NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration INTEGER, -- Durée en secondes
  end_reason TEXT CHECK (end_reason IN ('completed', 'declined', 'missed', 'failed', 'cancelled'))
);

CREATE INDEX idx_calls_conversation ON calls(conversation_id);
CREATE INDEX idx_calls_caller ON calls(caller_id);
CREATE INDEX idx_calls_callee ON calls(callee_id);
CREATE INDEX idx_calls_status ON calls(status);

-- RLS Policies
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own calls"
  ON calls FOR SELECT
  USING (auth.uid() IN (caller_id, callee_id));

CREATE POLICY "Users initiate calls"
  ON calls FOR INSERT
  WITH CHECK (auth.uid() = caller_id);

CREATE POLICY "Users update own calls"
  ON calls FOR UPDATE
  USING (auth.uid() IN (caller_id, callee_id));

-- Table pour signaling
CREATE TABLE call_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id),
  to_user_id UUID NOT NULL REFERENCES profiles(id),
  signal_type TEXT NOT NULL CHECK (signal_type IN ('offer', 'answer', 'ice_candidate')),
  signal_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_call_signals_call ON call_signals(call_id);
CREATE INDEX idx_call_signals_to_user ON call_signals(to_user_id, created_at DESC);

ALTER TABLE call_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own signals"
  ON call_signals FOR SELECT
  USING (auth.uid() IN (from_user_id, to_user_id));

CREATE POLICY "Users send signals"
  ON call_signals FOR INSERT
  WITH CHECK (auth.uid() = from_user_id);
```

#### WebRTC Manager

```typescript
// lib/webrtc.ts
export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private callId: string | null = null
  
  private config: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // TURN servers (requires credentials)
      {
        urls: 'turn:your-turn-server.com:3478',
        username: 'username',
        credential: 'password'
      }
    ],
    iceCandidatePoolSize: 10
  }
  
  async initCall(callId: string, isInitiator: boolean) {
    this.callId = callId
    
    // Create peer connection
    this.peerConnection = new RTCPeerConnection(this.config)
    
    // Get local media stream
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    })
    
    // Add tracks to peer connection
    this.localStream.getTracks().forEach(track => {
      this.peerConnection!.addTrack(track, this.localStream!)
    })
    
    // Handle remote stream
    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0]
      this.onRemoteStream?.(this.remoteStream)
    }
    
    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal('ice_candidate', {
          candidate: event.candidate.toJSON()
        })
      }
    }
    
    // Handle connection state
    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection!.connectionState)
      this.onConnectionStateChange?.(this.peerConnection!.connectionState)
    }
    
    if (isInitiator) {
      await this.createOffer()
    }
  }
  
  async createOffer() {
    if (!this.peerConnection) return
    
    const offer = await this.peerConnection.createOffer()
    await this.peerConnection.setLocalDescription(offer)
    
    await this.sendSignal('offer', {
      sdp: offer.sdp,
      type: offer.type
    })
  }
  
  async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return
    
    await this.peerConnection.setRemoteDescription(offer)
    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)
    
    await this.sendSignal('answer', {
      sdp: answer.sdp,
      type: answer.type
    })
  }
  
  async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return
    await this.peerConnection.setRemoteDescription(answer)
  }
  
  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) return
    await this.peerConnection.addIceCandidate(candidate)
  }
  
  async sendSignal(type: string, data: any) {
    await supabase.from('call_signals').insert({
      call_id: this.callId,
      from_user_id: user.id,
      to_user_id: otherUserId,
      signal_type: type,
      signal_data: data
    })
  }
  
  toggleMute() {
    if (!this.localStream) return
    const audioTrack = this.localStream.getAudioTracks()[0]
    audioTrack.enabled = !audioTrack.enabled
    return !audioTrack.enabled
  }
  
  async endCall() {
    // Stop local stream
    this.localStream?.getTracks().forEach(track => track.stop())
    
    // Close peer connection
    this.peerConnection?.close()
    
    // Update call status
    await supabase
      .from('calls')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString()
      })
      .eq('id', this.callId)
    
    // Cleanup
    this.peerConnection = null
    this.localStream = null
    this.remoteStream = null
    this.callId = null
  }
  
  // Callbacks
  onRemoteStream?: (stream: MediaStream) => void
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void
}
```

#### Hooks à Implémenter

```typescript
// hooks/useWebRTC.ts
export function useWebRTC() {
  const [callState, setCallState] = useState<CallState>('idle')
  const [isMuted, setIsMuted] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const webrtcManager = useRef<WebRTCManager | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  
  useEffect(() => {
    // Subscribe to incoming signals
    const channel = supabase
      .channel('call_signals')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_signals',
        filter: `to_user_id=eq.${user.id}`
      }, handleIncomingSignal)
      .subscribe()
    
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])
  
  const handleIncomingSignal = async (payload: any) => {
    const signal = payload.new
    
    if (!webrtcManager.current) return
    
    switch (signal.signal_type) {
      case 'offer':
        await webrtcManager.current.handleOffer(signal.signal_data)
        break
      case 'answer':
        await webrtcManager.current.handleAnswer(signal.signal_data)
        break
      case 'ice_candidate':
        await webrtcManager.current.handleIceCandidate(signal.signal_data.candidate)
        break
    }
  }
  
  const startCall = async (userId: string, conversationId: string) => {
    // Create call record
    const { data: call } = await supabase
      .from('calls')
      .insert({
        conversation_id: conversationId,
        caller_id: user.id,
        callee_id: userId,
        type: 'audio',
        status: 'ringing'
      })
      .select()
      .single()
    
    // Initialize WebRTC
    webrtcManager.current = new WebRTCManager()
    webrtcManager.current.onRemoteStream = (stream) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream
        remoteAudioRef.current.play()
      }
    }
    
    await webrtcManager.current.initCall(call.id, true)
    setCallState('calling')
  }
  
  const answerCall = async (callId: string) => {
    webrtcManager.current = new WebRTCManager()
    webrtcManager.current.onRemoteStream = (stream) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream
        remoteAudioRef.current.play()
      }
    }
    
    await webrtcManager.current.initCall(callId, false)
    
    // Update call status
    await supabase
      .from('calls')
      .update({
        status: 'active',
        answered_at: new Date().toISOString()
      })
      .eq('id', callId)
    
    setCallState('active')
  }
  
  const endCall = async () => {
    await webrtcManager.current?.endCall()
    setCallState('idle')
    setCallDuration(0)
  }
  
  const toggleMute = () => {
    const muted = webrtcManager.current?.toggleMute()
    setIsMuted(muted || false)
  }
  
  return {
    callState,
    isMuted,
    callDuration,
    remoteAudioRef,
    startCall,
    answerCall,
    endCall,
    toggleMute
  }
}
```

#### Composants React à Créer

1. **`CallScreen.tsx`** - Écran d'appel principal
2. **`IncomingCallModal.tsx`** - Modal pour appel entrant
3. **`CallControls.tsx`** - Contrôles (mute, end call)
4. **`CallTimer.tsx`** - Timer de durée d'appel

#### Services Externes Requis

**TURN Server Options**:
1. **Twilio TURN** (Recommandé)
   - Prix: ~$0.0004/min
   - Setup: https://www.twilio.com/stun-turn
   
2. **Metered.ca**
   - Prix: $0.0005/GB
   - Setup: https://www.metered.ca/tools/openrelay/

3. **Self-hosted** (coturn)
   - Gratuit mais nécessite serveur dédié
   - Complexité: Élevée

#### Dépendances NPM

Aucune dépendance supplémentaire (WebRTC natif)

#### Étapes d'Implémentation

1. **Jour 1-2**: Migration DB (calls + call_signals)
2. **Jour 3-4**: WebRTCManager class + signaling
3. **Jour 5-6**: Hook `useWebRTC` + state management
4. **Jour 7-8**: Composant `CallScreen` + UI
5. **Jour 9-10**: Composant `IncomingCallModal` + notifications
6. **Jour 11-12**: TURN server setup + configuration
7. **Jour 13-14**: Tests + debugging + edge cases
8. **Jour 15-16**: Optimisations + error handling
9. **Jour 17-18**: Call history + logs
10. **Jour 19-20**: Documentation + final tests

---

### 10. Appels Vidéo (WebRTC) 🟡

**Impact**: Haute | **Complexité**: Très Élevée | **Temps**: 12-15 jours

**Note**: Nécessite l'implémentation des appels audio d'abord.

#### Différences vs Appels Audio

1. **Media Constraints**:
```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user'
  }
})
```

2. **UI Components**:
- Vidéo locale (petit)
- Vidéo distante (grand)
- Toggle caméra on/off
- Switch caméra avant/arrière (mobile)

3. **Bande Passante**:
- Audio: ~50 Kbps
- Vidéo 720p: ~1-2 Mbps
- Nécessite meilleure connexion

#### Étapes d'Implémentation

1. **Jour 1-2**: Adapter WebRTCManager pour vidéo
2. **Jour 3-4**: Composants vidéo (local + remote)
3. **Jour 5-6**: Contrôles vidéo (toggle camera, switch)
4. **Jour 7-8**: Optimisations bande passante
5. **Jour 9-10**: Tests multi-plateforme
6. **Jour 11-12**: Edge cases + documentation

---

### 11. E2EE avec Signal Protocol 🟡

**Impact**: Moyenne | **Complexité**: Très Élevée | **Temps**: 20-25 jours

**Note**: Fonctionnalité la plus complexe, nécessite expertise cryptographique.

#### Architecture

```
┌─────────────────────────────────────────────────┐
│           Frontend (React)                      │
│  ┌──────────────────────────────────────────┐  │
│  │  Signal Protocol Library                 │  │
│  │  - Key generation (Identity, Prekeys)    │  │
│  │  - Double Ratchet algorithm              │  │
│  │  - Message encryption/decryption         │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Local Key Storage (IndexedDB)           │  │
│  │  - Identity key pair                     │  │
│  │  - Signed prekey                         │  │
│  │  - One-time prekeys                      │  │
│  │  - Session states                        │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Supabase Database                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Table: prekey_bundles                   │  │
│  │  - user_id                               │  │
│  │  - identity_key (public)                 │  │
│  │  - signed_prekey (public)                │  │
│  │  - one_time_prekeys (public)             │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Table: messages (EXISTING)              │  │
│  │  - content: ENCRYPTED TEXT               │  │
│  │  - encryption_metadata: JSONB            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Bibliothèque Recommandée

**@privacyresearch/libsignal-protocol-typescript**
- Implémentation TypeScript du Signal Protocol
- Compatible navigateur
- Maintenue activement

#### Modifications DB

```sql
-- Table pour stocker les prekey bundles publics
CREATE TABLE prekey_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  identity_key TEXT NOT NULL, -- Public key
  signed_prekey JSONB NOT NULL, -- { id, key, signature }
  one_time_prekeys JSONB[], -- Array of { id, key }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prekey_bundles_user ON prekey_bundles(user_id);

ALTER TABLE prekey_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read prekey bundles"
  ON prekey_bundles FOR SELECT
  USING (true);

CREATE POLICY "Users manage own prekey bundles"
  ON prekey_bundles FOR ALL
  USING (auth.uid() = user_id);
```

#### Implémentation Signal Protocol

```typescript
// lib/signal.ts
import {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
  MessageType
} from '@privacyresearch/libsignal-protocol-typescript'

export class SignalManager {
  private store: SignalProtocolStore
  
  constructor() {
    this.store = new SignalProtocolStore()
  }
  
  async initialize() {
    // Generate identity key pair
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair()
    await this.store.put('identityKey', identityKeyPair)
    
    // Generate registration ID
    const registrationId = KeyHelper.generateRegistrationId()
    await this.store.put('registrationId', registrationId)
    
    // Generate prekeys
    const preKeys = await KeyHelper.generatePreKeys(0, 100)
    for (const preKey of preKeys) {
      await this.store.storePreKey(preKey.keyId, preKey.keyPair)
    }
    
    // Generate signed prekey
    const signedPreKey = await KeyHelper.generateSignedPreKey(
      identityKeyPair,
      0
    )
    await this.store.storeSignedPreKey(
      signedPreKey.keyId,
      signedPreKey.keyPair
    )
    
    // Upload prekey bundle to server
    await this.uploadPrekeyBundle({
      identityKey: identityKeyPair.pubKey,
      signedPreKey: {
        id: signedPreKey.keyId,
        key: signedPreKey.keyPair.pubKey,
        signature: signedPreKey.signature
      },
      oneTimePreKeys: preKeys.map(pk => ({
        id: pk.keyId,
        key: pk.keyPair.pubKey
      }))
    })
  }
  
  async uploadPrekeyBundle(bundle: PrekeyBundle) {
    await supabase.from('prekey_bundles').upsert({
      user_id: user.id,
      identity_key: arrayBufferToBase64(bundle.identityKey),
      signed_prekey: {
        id: bundle.signedPreKey.id,
        key: arrayBufferToBase64(bundle.signedPreKey.key),
        signature: arrayBufferToBase64(bundle.signedPreKey.signature)
      },
      one_time_prekeys: bundle.oneTimePreKeys.map(pk => ({
        id: pk.id,
        key: arrayBufferToBase64(pk.key)
      }))
    })
  }
  
  async encryptMessage(recipientId: string, plaintext: string) {
    const address = new SignalProtocolAddress(recipientId, 1)
    
    // Check if session exists
    if (!await this.store.loadSession(address.toString())) {
      // Build new session
      await this.buildSession(recipientId)
    }
    
    // Encrypt message
    const sessionCipher = new SessionCipher(this.store, address)
    const ciphertext = await sessionCipher.encrypt(
      stringToArrayBuffer(plaintext)
    )
    
    return {
      type: ciphertext.type,
      body: arrayBufferToBase64(ciphertext.body),
      registrationId: ciphertext.registrationId
    }
  }
  
  async decryptMessage(senderId: string, ciphertext: any) {
    const address = new SignalProtocolAddress(senderId, 1)
    const sessionCipher = new SessionCipher(this.store, address)
    
    let plaintext: ArrayBuffer
    
    if (ciphertext.type === MessageType.PreKey) {
      plaintext = await sessionCipher.decryptPreKeyWhisperMessage(
        base64ToArrayBuffer(ciphertext.body)
      )
    } else {
      plaintext = await sessionCipher.decryptWhisperMessage(
        base64ToArrayBuffer(ciphertext.body)
      )
    }
    
    return arrayBufferToString(plaintext)
  }
  
  async buildSession(recipientId: string) {
    // Fetch recipient's prekey bundle
    const { data: bundle } = await supabase
      .from('prekey_bundles')
      .select('*')
      .eq('user_id', recipientId)
      .single()
    
    if (!bundle) throw new Error('Prekey bundle not found')
    
    // Build session
    const address = new SignalProtocolAddress(recipientId, 1)
    const sessionBuilder = new SessionBuilder(this.store, address)
    
    await sessionBuilder.processPreKey({
      identityKey: base64ToArrayBuffer(bundle.identity_key),
      signedPreKey: {
        keyId: bundle.signed_prekey.id,
        publicKey: base64ToArrayBuffer(bundle.signed_prekey.key),
        signature: base64ToArrayBuffer(bundle.signed_prekey.signature)
      },
      preKey: bundle.one_time_prekeys[0] ? {
        keyId: bundle.one_time_prekeys[0].id,
        publicKey: base64ToArrayBuffer(bundle.one_time_prekeys[0].key)
      } : undefined,
      registrationId: bundle.registration_id
    })
    
    // Remove used one-time prekey
    if (bundle.one_time_prekeys[0]) {
      await supabase
        .from('prekey_bundles')
        .update({
          one_time_prekeys: bundle.one_time_prekeys.slice(1)
        })
        .eq('user_id', recipientId)
    }
  }
}

// Helper functions
function stringToArrayBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer
}

function arrayBufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
```

#### Dépendances NPM

```json
{
  "@privacyresearch/libsignal-protocol-typescript": "^0.0.12"
}
```

#### Étapes d'Implémentation

1. **Jour 1-3**: Étude approfondie du Signal Protocol
2. **Jour 4-5**: Migration DB (prekey_bundles)
3. **Jour 6-8**: SignalManager class + key generation
4. **Jour 9-11**: Session building + encryption/decryption
5. **Jour 12-14**: Intégration dans ChatViewPage
6. **Jour 15-17**: Key rotation + prekey management
7. **Jour 18-20**: Tests cryptographiques
8. **Jour 21-22**: Audit de sécurité interne
9. **Jour 23-24**: Documentation + best practices
10. **Jour 25**: Audit externe (recommandé)

**⚠️ ATTENTION**: Cette fonctionnalité nécessite une expertise cryptographique. Il est **fortement recommandé** de faire auditer l'implémentation par un expert en sécurité avant la mise en production.

---

## 📅 Roadmap par Phases

### Phase 1: Quick Wins (3-4 semaines)

**Objectif**: Améliorer rapidement l'expérience utilisateur avec des fonctionnalités à fort impact et faible complexité.

| Fonctionnalité | Durée | Priorité | Dépendances |
|----------------|-------|----------|-------------|
| Réactions aux messages | 3-4 jours | 🔴 CRITIQUE | Aucune |
| Réponses/Citations | 4-5 jours | 🔴 CRITIQUE | Aucune |
| Recherche messages | 5-6 jours | 🔴 CRITIQUE | Aucune |
| Messages éphémères | 3-4 jours | 🟠 IMPORTANT | Aucune |

**Total Phase 1**: 15-19 jours (~3-4 semaines)

**Livrables**:
- ✅ Réactions emoji sur messages
- ✅ Système de réponses/citations
- ✅ Recherche full-text dans messages
- ✅ Messages éphémères avec timer

**Impact**: +20% de complétude (65% total)

---

### Phase 2: Core Features (5-7 semaines)

**Objectif**: Implémenter les fonctionnalités essentielles pour rivaliser avec WhatsApp.

| Fonctionnalité | Durée | Priorité | Dépendances |
|----------------|-------|----------|-------------|
| Messages vocaux | 6-7 jours | 🔴 CRITIQUE | Aucune |
| Partage médias amélioré | 5-6 jours | 🔴 CRITIQUE | Aucune |
| Notifications push | 7-8 jours | 🟠 IMPORTANT | Firebase setup |
| Mode hors ligne | 10-12 jours | 🟠 IMPORTANT | Service Worker |

**Total Phase 2**: 28-33 jours (~5-7 semaines)

**Livrables**:
- ✅ Enregistrement et lecture de messages vocaux
- ✅ Upload multi-fichiers avec compression
- ✅ Notifications push via FCM
- ✅ Mode hors ligne avec synchronisation

**Impact**: +25% de complétude (90% total)

---

### Phase 3: Advanced Features (8-12 semaines)

**Objectif**: Fonctionnalités avancées pour se différencier.

| Fonctionnalité | Durée | Priorité | Dépendances |
|----------------|-------|----------|-------------|
| Appels audio | 15-20 jours | 🟡 AVANCÉ | TURN server |
| Appels vidéo | 12-15 jours | 🟡 AVANCÉ | Appels audio |
| E2EE Signal Protocol | 20-25 jours | 🟡 AVANCÉ | Expertise crypto |

**Total Phase 3**: 47-60 jours (~8-12 semaines)

**Livrables**:
- ✅ Appels audio WebRTC
- ✅ Appels vidéo WebRTC
- ✅ Chiffrement E2EE véritable

**Impact**: +10% de complétude (100% total)

---

### Phase 4: Polish & Optimization (2-3 semaines)

**Objectif**: Optimisations, tests et finitions.

| Tâche | Durée | Description |
|-------|-------|-------------|
| Code splitting | 2-3 jours | React.lazy() pour réduire bundle |
| Optimisation images | 2 jours | WebP, lazy loading |
| Tests E2E | 3-4 jours | Cypress/Playwright |
| Audit sécurité | 3-5 jours | Audit externe E2EE |
| Documentation | 2-3 jours | Docs utilisateur + dev |
| Performance tuning | 2-3 jours | Lighthouse, Core Web Vitals |

**Total Phase 4**: 14-20 jours (~2-3 semaines)

---

## 📊 Estimations et Ressources

### Timeline Global

```
Phase 1 (Quick Wins)        ████████░░░░░░░░░░░░░░░░░░░░  3-4 semaines
Phase 2 (Core Features)     ░░░░░░░░████████████░░░░░░░░  5-7 semaines
Phase 3 (Advanced)          ░░░░░░░░░░░░░░░░████████████  8-12 semaines
Phase 4 (Polish)            ░░░░░░░░░░░░░░░░░░░░░░░░████  2-3 semaines
                            ─────────────────────────────
                            Total: 18-26 semaines (4-6 mois)
```

### Ressources Humaines Recommandées

**Équipe Minimale**:
- 1 × Développeur Frontend Senior (React/TypeScript)
- 1 × Développeur Backend (Supabase/PostgreSQL)
- 0.5 × Expert WebRTC (consultant pour Phase 3)
- 0.5 × Expert Cryptographie (consultant pour E2EE)
- 0.5 × QA Engineer (tests)

**Équipe Optimale**:
- 2 × Développeurs Frontend
- 1 × Développeur Backend
- 1 × Expert WebRTC (temps plein Phase 3)
- 1 × Expert Cryptographie (temps plein E2EE)
- 1 × QA Engineer
- 0.5 × DevOps (infrastructure)

### Budget Estimé

#### Développement

| Phase | Durée | Coût Dev (1 dev) | Coût Dev (2 devs) |
|-------|-------|------------------|-------------------|
| Phase 1 | 3-4 sem | 12-16k€ | 24-32k€ |
| Phase 2 | 5-7 sem | 20-28k€ | 40-56k€ |
| Phase 3 | 8-12 sem | 32-48k€ | 64-96k€ |
| Phase 4 | 2-3 sem | 8-12k€ | 16-24k€ |
| **Total** | **18-26 sem** | **72-104k€** | **144-208k€** |

*Taux horaire moyen: 400-500€/jour*

#### Infrastructure & Services

| Service | Coût Mensuel | Coût Annuel | Notes |
|---------|--------------|-------------|-------|
| Supabase Pro | $25 | $300 | Inclus 8GB DB, 250GB bandwidth |
| Firebase (FCM) | $0-50 | $0-600 | Gratuit jusqu'à 10M messages/mois |
| TURN Server (Twilio) | $100-500 | $1,200-6,000 | Dépend du volume d'appels |
| CDN (Cloudflare) | $0-20 | $0-240 | Gratuit pour usage modéré |
| Monitoring (Sentry) | $26 | $312 | Plan Team |
| **Total** | **$151-595** | **$1,812-7,452** | |

#### Coûts Ponctuels

| Item | Coût | Notes |
|------|------|-------|
| Audit sécurité E2EE | 5-10k€ | Obligatoire pour E2EE |
| Setup Firebase | 0€ | Gratuit |
| Setup TURN server | 0-2k€ | Si self-hosted |
| Licences logicielles | 0€ | Open source |
| **Total** | **5-12k€** | |

#### Budget Total

**Scénario Minimal** (1 dev, Phase 1+2 uniquement):
- Développement: 32-44k€
- Infrastructure: 1.8k€/an
- **Total Année 1**: 34-46k€

**Scénario Complet** (2 devs, toutes phases):
- Développement: 144-208k€
- Infrastructure: 7.5k€/an
- Audit sécurité: 10k€
- **Total Année 1**: 161-225k€

---

## ⚠️ Risques et Mitigation

### Risques Techniques

#### 1. Complexité WebRTC (Appels Audio/Vidéo)

**Risque**: Haute complexité, nombreux edge cases (NAT, firewall, qualité réseau)

**Impact**: Élevé - Peut bloquer Phase 3

**Probabilité**: Moyenne (60%)

**Mitigation**:
- Utiliser bibliothèque éprouvée (simple-peer, PeerJS)
- Prévoir budget TURN server (Twilio)
- Embaucher consultant WebRTC expérimenté
- Tests approfondis sur différents réseaux
- Fallback: Désactiver appels si trop complexe

#### 2. Signal Protocol E2EE

**Risque**: Implémentation cryptographique complexe, risques de sécurité

**Impact**: Critique - Faille de sécurité = désastre

**Probabilité**: Élevée (70%)

**Mitigation**:
- Utiliser bibliothèque officielle (@privacyresearch/libsignal)
- Audit de sécurité externe OBLIGATOIRE
- Tests cryptographiques exhaustifs
- Documentation détaillée
- Fallback: Garder chiffrement Supabase uniquement

#### 3. Performance Mode Hors Ligne

**Risque**: Synchronisation complexe, conflits de données

**Impact**: Moyen - UX dégradée

**Probabilité**: Moyenne (50%)

**Mitigation**:
- Stratégie last-write-wins simple
- Limiter cache (100 derniers messages)
- Tests avec connexions instables
- Indicateurs clairs pour l'utilisateur

#### 4. Notifications Push

**Risque**: Configuration Firebase complexe, problèmes de livraison

**Impact**: Moyen - Notifications manquées

**Probabilité**: Faible (30%)

**Mitigation**:
- Suivre documentation Firebase officielle
- Tests sur iOS/Android/Web
- Fallback: Polling si push échoue
- Monitoring des taux de livraison

### Risques Projet

#### 5. Dépassement de Budget

**Risque**: Phases 3 (WebRTC + E2EE) plus longues que prévu

**Impact**: Élevé - Arrêt du projet

**Probabilité**: Moyenne (50%)

**Mitigation**:
- Approche par phases (peut s'arrêter après Phase 2)
- Estimations conservatrices (+20% buffer)
- Revues hebdomadaires du budget
- Priorisation stricte des fonctionnalités

#### 6. Compatibilité avec l'Existant

**Risque**: Modifications cassent fonctionnalités existantes

**Impact**: Élevé - Régression

**Probabilité**: Faible (20%)

**Mitigation**:
- Tests de régression systématiques
- Migrations DB avec rollback
- Feature flags pour nouvelles fonctionnalités
- Déploiement progressif (canary)

#### 7. Dépendance à des Services Tiers

**Risque**: Firebase, Twilio, etc. changent leurs prix/API

**Impact**: Moyen - Coûts imprévus

**Probabilité**: Faible (20%)

**Mitigation**:
- Abstractions pour services tiers
- Monitoring des coûts
- Plans de contingence (alternatives)
- Contrats avec SLA si possible

### Risques Utilisateur

#### 8. Adoption des Nouvelles Fonctionnalités

**Risque**: Utilisateurs ne découvrent pas les nouvelles fonctionnalités

**Impact**: Moyen - ROI faible

**Probabilité**: Moyenne (40%)

**Mitigation**:
- Onboarding pour nouvelles features
- Tooltips et guides
- Annonces in-app
- Analytics pour mesurer adoption

---

## 💡 Recommandations

### Approche Recommandée

**Option 1: Pragmatique (Recommandée)**
- Implémenter Phase 1 + Phase 2 uniquement
- Atteindre 90% de complétude
- Budget: 60-80k€
- Durée: 8-11 semaines
- **Avantages**: ROI rapide, risques limités, budget maîtrisé
- **Inconvénients**: Pas d'appels audio/vidéo, pas d'E2EE complet

**Option 2: Complète**
- Implémenter toutes les phases
- Atteindre 100% de complétude
- Budget: 160-225k€
- Durée: 18-26 semaines
- **Avantages**: Parité complète avec WhatsApp
- **Inconvénients**: Budget élevé, risques techniques, long délai

**Option 3: MVP Étendu**
- Phase 1 + Messages vocaux + Notifications push
- Atteindre 75% de complétude
- Budget: 40-55k€
- Durée: 5-7 semaines
- **Avantages**: Quick win, fonctionnalités essentielles
- **Inconvénients**: Pas d'appels, pas de mode hors ligne

### Priorisation par Impact/Effort

```
Impact
  ↑
  │  Réponses/Citations    Messages vocaux
  │  Recherche messages    Notifications push
  │  ────────────────────────────────────────
  │  Réactions             Mode hors ligne
  │  Messages éphémères    Appels audio
  │  
  │  Partage médias        Appels vidéo
  │                        E2EE Signal
  └──────────────────────────────────────→ Effort
     Faible                           Élevé
```

**Recommandation**: Commencer par le quadrant haut-gauche (impact élevé, effort faible).

### Technologies Alternatives

Si les technologies proposées posent problème, voici des alternatives:

#### WebRTC
- **Alternative 1**: Agora.io (SDK payant, plus simple)
- **Alternative 2**: Jitsi Meet (open source, self-hosted)
- **Alternative 3**: Daily.co (API payante, très simple)

#### Signal Protocol
- **Alternative 1**: Matrix Protocol (plus simple, moins sécurisé)
- **Alternative 2**: Garder chiffrement Supabase uniquement
- **Alternative 3**: OMEMO (pour groupes)

#### Notifications Push
- **Alternative 1**: OneSignal (gratuit jusqu'à 10k users)
- **Alternative 2**: Pusher (WebSocket, pas de push natif)
- **Alternative 3**: Polling (simple mais inefficace)

### Optimisations Possibles

1. **Code Splitting**:
```typescript
// Lazy load pages
const ChatViewPage = lazy(() => import('./pages/ChatViewPage'))
const CallScreen = lazy(() => import('./pages/CallScreen'))
```

2. **Image Optimization**:
```typescript
// Utiliser WebP avec fallback
<picture>
  <source srcSet="image.webp" type="image/webp" />
  <img src="image.jpg" alt="..." />
</picture>
```

3. **Bundle Size**:
- Actuel: 516KB
- Cible: <400KB
- Actions: Code splitting, tree shaking, compression

4. **Database Indexing**:
```sql
-- Ajouter indexes manquants
CREATE INDEX CONCURRENTLY idx_messages_conversation_created 
ON messages(conversation_id, created_at DESC);
```

---

## 📝 Checklist d'Implémentation

### Phase 1: Quick Wins

- [ ] **Réactions aux messages**
  - [ ] Migration DB (table message_reactions)
  - [ ] Hook useMessageReactions
  - [ ] Composant EmojiPicker
  - [ ] Composant MessageReactions
  - [ ] Intégration ChatViewPage
  - [ ] Tests

- [ ] **Réponses/Citations**
  - [ ] Migration DB (FK reply_to_id)
  - [ ] Hook useMessageReply
  - [ ] Composant MessageReplyPreview
  - [ ] Composant QuotedMessage
  - [ ] Menu contextuel
  - [ ] Tests

- [ ] **Recherche messages**
  - [ ] Migration DB (tsvector + GIN index)
  - [ ] Fonction RPC search_messages
  - [ ] Hook useMessageSearch
  - [ ] Composant SearchBar
  - [ ] Composant SearchResults
  - [ ] Tests

- [ ] **Messages éphémères**
  - [ ] Migration DB (colonnes ephemeral)
  - [ ] Edge function cleanup
  - [ ] Cron job
  - [ ] Hook useEphemeralMessages
  - [ ] Composants UI
  - [ ] Tests

### Phase 2: Core Features

- [ ] **Messages vocaux**
  - [ ] Migration DB (bucket + colonne duration)
  - [ ] Hook useVoiceRecorder
  - [ ] Composant VoiceRecorder
  - [ ] Composant VoiceMessagePlayer
  - [ ] Waveform visualization
  - [ ] Tests

- [ ] **Partage médias amélioré**
  - [ ] Migration DB (colonnes files)
  - [ ] Hook useMediaUpload
  - [ ] Composant MediaUploader
  - [ ] Compression images
  - [ ] Progress bar
  - [ ] Tests

- [ ] **Notifications push**
  - [ ] Setup Firebase project
  - [ ] Migration DB (push_tokens)
  - [ ] Service Worker
  - [ ] Hook usePushNotifications
  - [ ] Edge function send-notification
  - [ ] Tests

- [ ] **Mode hors ligne**
  - [ ] Service Worker + cache
  - [ ] IndexedDB schema
  - [ ] Hook useOfflineSync
  - [ ] Queue management
  - [ ] Sync logic
  - [ ] Tests

### Phase 3: Advanced Features

- [ ] **Appels audio**
  - [ ] Migration DB (calls + call_signals)
  - [ ] WebRTCManager class
  - [ ] Hook useWebRTC
  - [ ] Composant CallScreen
  - [ ] TURN server setup
  - [ ] Tests

- [ ] **Appels vidéo**
  - [ ] Adapter WebRTCManager
  - [ ] Composants vidéo
  - [ ] Contrôles vidéo
  - [ ] Tests

- [ ] **E2EE Signal Protocol**
  - [ ] Migration DB (prekey_bundles)
  - [ ] SignalManager class
  - [ ] Key generation
  - [ ] Encryption/decryption
  - [ ] Audit sécurité
  - [ ] Tests

### Phase 4: Polish

- [ ] Code splitting
- [ ] Optimisation images
- [ ] Tests E2E
- [ ] Audit sécurité
- [ ] Documentation
- [ ] Performance tuning

---

## 📚 Ressources et Documentation

### Documentation Technique

- [Supabase Docs](https://supabase.com/docs)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Signal Protocol](https://signal.org/docs/)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

### Bibliothèques Recommandées

```json
{
  "emoji-picker-react": "^4.9.2",
  "lodash.debounce": "^4.0.8",
  "react-dropzone": "^14.2.3",
  "browser-image-compression": "^2.0.2",
  "firebase": "^10.8.0",
  "idb": "^8.0.0",
  "wavesurfer.js": "^7.7.3",
  "@privacyresearch/libsignal-protocol-typescript": "^0.0.12"
}
```

### Services Externes

- **TURN Server**: [Twilio](https://www.twilio.com/stun-turn) ou [Metered.ca](https://www.metered.ca/)
- **Notifications**: [Firebase Cloud Messaging](https://firebase.google.com/products/cloud-messaging)
- **Monitoring**: [Sentry](https://sentry.io/)
- **Analytics**: [PostHog](https://posthog.com/) (open source)

---

## 🎯 Conclusion

Ce plan d'implémentation fournit une roadmap détaillée pour porter anu-app de **45% à 90-100% de complétude** par rapport à WhatsApp.

### Points Clés

1. **Approche par phases** permet de livrer de la valeur progressivement
2. **Phase 1 (Quick Wins)** offre le meilleur ROI (20% complétude en 3-4 semaines)
3. **Phase 2 (Core Features)** atteint 90% de complétude (fonctionnalités essentielles)
4. **Phase 3 (Advanced)** est optionnelle mais nécessaire pour parité complète
5. **Risques identifiés** avec stratégies de mitigation claires

### Recommandation Finale

**Commencer par Phase 1 + Phase 2** (8-11 semaines, 60-80k€) pour atteindre 90% de complétude avec un risque maîtrisé. Évaluer ensuite l'opportunité de Phase 3 en fonction des retours utilisateurs et du budget disponible.

### Prochaines Étapes

1. **Review de ce plan** avec les stakeholders
2. **Validation du budget** et des ressources
3. **Sélection de l'approche** (Pragmatique, Complète, ou MVP Étendu)
4. **Constitution de l'équipe** (devs, consultants)
5. **Kick-off Phase 1** avec première fonctionnalité (Réactions)

---

**Document préparé par**: Kilo Code - Architect Mode  
**Date**: 2025-11-30  
**Version**: 1.0  
**Statut**: ✅ Ready for Review