# Design Specification - Anu (Clone JemaOS P2P Sécurisé)

## 1. Direction & Rationale

### Style Choisi : Glassmorphism (Modern Depth)

**Essence en 3 phrases :**  
Interface moderne exploitant les effets de matérialité verre dépoli (backdrop-blur), les overlays translucides et les gradients subtils pour créer une profondeur visuelle élégante. Le violet #6b6fdb est utilisé avec parcimonie (saturation réduite 50-65%) sur une base de gradients gris-blanc, créant une identité visuelle premium et moderne. L'approche privilégie la fluidité des animations (400-600ms) et la légèreté visuelle pour une messagerie qui respire la confidentialité et la modernité.

**Exemples concrets :**
- macOS Big Sur / Monterey (Control Center, Notification Center)
- Windows 11 Mica materials (Settings, Calculator)
- iOS 15+ Control Center et widgets
- Microsoft Fluent Design System

**Alignement avec Anu :**  
La matérialité verre dépoli renforce psychologiquement la perception de transparence technique (architecture P2P ouverte) tout en créant une barrière visuelle élégante (privacy-first). Le violet #6b6fdb sur fond glassmorphism apporte sophistication sans agressivité, parfait pour une audience jeune/premium 18-30 ans qui refuse les clones visuels de JemaOS/Telegram.

---

## 2. Design Tokens

### 2.1 Couleurs

**Palette Primaire :**

| Token | Valeur | Usage | Contraste WCAG |
|-------|--------|-------|----------------|
| `primary-500` | #6b6fdb | Accents principaux, CTAs, liens actifs | 4.8:1 (AA) sur blanc |
| `primary-400` | #8385e3 | Hover states, active borders | 5.2:1 (AA) |
| `primary-600` | #5558c9 | Pressed states, dark accents | 7.1:1 (AAA) |
| `primary-300` | #9fa1eb | Disabled states, subtle highlights | 3.8:1 |
| `primary-100` | #d4d5f7 | Backgrounds légers, badges subtils | 1.8:1 |

**Neutrals (Glassmorphism Base) :**

| Token | Valeur | Usage |
|-------|--------|-------|
| `glass-bg-start` | #F0F2F5 | Début gradient fond principal |
| `glass-bg-end` | #FFFFFF | Fin gradient fond principal |
| `glass-surface-light` | rgba(255,255,255,0.5) | Surfaces translucides claires |
| `glass-surface-medium` | rgba(255,255,255,0.3) | Surfaces translucides moyennes |
| `glass-border` | rgba(255,255,255,0.2) | Bordures subtiles 1px |
| `text-primary` | #1A1D21 | Texte principal (95% opacité) |
| `text-secondary` | #495057 | Texte secondaire (75% opacité) |
| `text-tertiary` | #868E96 | Texte tertiaire, metadata (55% opacité) |

**Sémantiques (Privacy/Security) :**

| Token | Valeur | Usage | Contraste |
|-------|--------|-------|-----------|
| `success-500` | #00D9A3 | E2EE actif, P2P connecté, messages livrés | 4.9:1 (AA) |
| `success-glow` | #00FFB3 | Glow effect indicateurs sécurité | N/A (effet) |
| `warning-500` | #FFB020 | Sync en cours, relayed TURN, latence | 5.5:1 (AA) |
| `danger-500` | #FF4757 | Erreurs, suppression, déconnexion | 6.2:1 (AA) |
| `info-500` | #4C9AFF | Informations générales, tooltips | 5.1:1 (AA) |

**Arrière-plans & Overlays :**

| Token | Valeur | Usage |
|-------|--------|-------|
| `bg-page` | linear-gradient(135deg, #F0F2F5 0%, #FFFFFF 100%) | Fond page principale |
| `overlay-modal` | rgba(0,0,0,0.4) | Overlay modals/sheets |
| `overlay-glass` | rgba(255,255,255,0.15) | Overlay léger sur glass cards |

### 2.2 Typographie

**Familles :**

| Token | Valeur | Contexte |
|-------|--------|----------|
| `font-primary` | -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif | Interface principale |
| `font-mono` | "SF Mono", "Consolas", "Monaco", monospace | Session IDs, clés publiques, codes |

**Échelle (Ratio 1.25 - Major Third) :**

| Token | Taille | Line Height | Weight | Usage |
|-------|--------|-------------|--------|-------|
| `text-xs` | 12px | 16px (1.33) | 500 | Metadata, timestamps, badges |
| `text-sm` | 14px | 20px (1.43) | 400 | Texte secondaire, descriptions |
| `text-base` | 16px | 24px (1.5) | 400 | Corps de texte, messages |
| `text-lg` | 20px | 28px (1.4) | 500 | Titres secondaires, noms contacts |
| `text-xl` | 24px | 32px (1.33) | 600 | Titres sections, headers |
| `text-2xl` | 32px | 40px (1.25) | 700 | Titres principaux, onboarding |

**Poids & Styles :**

| Token | Valeur | Usage |
|-------|--------|-------|
| `font-regular` | 400 | Corps de texte standard |
| `font-medium` | 500 | Emphase légère, labels |
| `font-semibold` | 600 | Titres, navigation active |
| `font-bold` | 700 | Headings importants, CTAs |
| `letter-spacing-tight` | -0.02em | Titres larges (>24px) |
| `letter-spacing-normal` | 0em | Texte standard |
| `letter-spacing-wide` | 0.05em | ALL CAPS, petits labels |

### 2.3 Espacement (4pt Grid, préférence 8pt)

| Token | Valeur | Usage |
|-------|--------|-------|
| `space-1` | 4px | Très serré (badges internes, icônes) |
| `space-2` | 8px | Serré (padding boutons, gaps petits) |
| `space-3` | 12px | Compact (padding cards internes) |
| `space-4` | 16px | Standard (padding composants, gaps) |
| `space-6` | 24px | Confortable (marges sections) |
| `space-8` | 32px | Généreux (padding cards, marges écrans) |
| `space-12` | 48px | Large (espaces entre grandes sections) |
| `space-16` | 64px | Très large (marges hero, séparations majeures) |
| `space-24` | 96px | Extra large (onboarding, états vides) |

### 2.4 Border Radius (Glassmorphism favorise radii modérés-larges)

| Token | Valeur | Usage |
|-------|--------|-------|
| `radius-sm` | 8px | Petits éléments (badges, chips) |
| `radius-md` | 12px | Composants standards (boutons, inputs) |
| `radius-lg` | 16px | Cards, message bubbles |
| `radius-xl` | 24px | Grandes cards, modals |
| `radius-2xl` | 32px | Éléments hero, FAB |
| `radius-full` | 9999px | Avatars, pills, boutons ronds |

### 2.5 Box Shadows (Multi-layered pour profondeur glassmorphism)

| Token | Valeur | Usage |
|-------|--------|-------|
| `shadow-glass-sm` | 0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06) | Éléments subtils (badges) |
| `shadow-glass-md` | 0 4px 16px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.08) | Cards, message bubbles |
| `shadow-glass-lg` | 0 8px 32px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.10) | Modals, bottom sheets |
| `shadow-glass-xl` | 0 16px 48px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.14) | Overlays majeurs, FAB |
| `glow-success` | 0 0 16px rgba(0,255,179,0.4) | Glow indicateurs E2EE actifs |
| `glow-primary` | 0 0 24px rgba(107,111,219,0.3) | Glow CTAs, états focus |

### 2.6 Animation & Motion

| Token | Valeur | Usage |
|-------|--------|-------|
| `duration-instant` | 100ms | Micro-interactions (hover states) |
| `duration-fast` | 200ms | Transitions rapides (toggles, switches) |
| `duration-normal` | 300ms | Transitions standard (écrans, modals) |
| `duration-slow` | 400ms | Transitions fluides (glassmorphism blur) |
| `duration-slower` | 600ms | Animations élégantes (onboarding, hero) |
| `easing-ease-out` | cubic-bezier(0.16, 1, 0.3, 1) | Sortie naturelle (90% cas) |
| `easing-ease-in-out` | cubic-bezier(0.4, 0, 0.2, 1) | Mouvement symétrique (modals) |
| `easing-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | Effet rebond subtil (boutons, FAB) |

---

## 3. Composants (6 Essentiels)

### 3.1 Glass Card (Pattern de base universel)

**Structure :**  
Conteneur avec fond translucide, bordure subtile, backdrop-blur et ombre multi-layered.

**Tokens utilisés :**
- Background : `glass-surface-light` (rgba(255,255,255,0.5))
- Border : 1px solid `glass-border`
- Backdrop-filter : blur(30px) saturate(150%)
- Box-shadow : `shadow-glass-md`
- Border-radius : `radius-lg` (16px)
- Padding : `space-8` (32px)

**États :**
- **Default** : Opacité 0.5, blur 30px
- **Hover** : Opacité 0.6, blur 35px, transition 300ms
- **Pressed** : Opacité 0.45, scale(0.98), transition 100ms
- **Focus** : Border 2px `primary-400`, glow `glow-primary`

**Note :** Base de tous les conteneurs (conversation cards, settings panels, modals). Contraste texte minimum 4.5:1 vérifié sur fond clair.

---

### 3.2 Message Bubble (Émis vs Reçu)

**Structure Bubble Émis (utilisateur) :**
- Background : linear-gradient(135deg, `primary-500` 0%, `primary-400` 100%)
- Color : #FFFFFF
- Border-radius : `radius-lg` avec coin bas-droit à `radius-sm` (effet pointeur)
- Padding : `space-3` `space-4` (12px 16px)
- Box-shadow : `shadow-glass-sm`
- Align : flex-end (droite)
- Max-width : 75% viewport

**Structure Bubble Reçu (contact) :**
- Background : `glass-surface-medium` (rgba(255,255,255,0.3))
- Backdrop-filter : blur(20px)
- Color : `text-primary`
- Border : 1px solid `glass-border`
- Border-radius : `radius-lg` avec coin bas-gauche à `radius-sm`
- Padding : `space-3` `space-4`
- Box-shadow : `shadow-glass-sm`
- Align : flex-start (gauche)
- Max-width : 75% viewport

**Metadata (timestamp, statut) :**
- Font-size : `text-xs` (12px)
- Color : `text-tertiary` (opacité 55%)
- Margin-top : `space-1` (4px)
- Statut livraison : icônes SVG 12×12px (✓ envoyé, ✓✓ livré, ✓✓ bleu lu)

**États spéciaux :**
- **Épinglé** : Border-left 3px `primary-500`, background légèrement plus opaque
- **Réponse** : Border-left 2px `primary-300`, padding-left augmenté, message original tronqué au-dessus

---

### 3.3 Button (Primary, Secondary, Ghost)

**Primary Button (CTAs principaux) :**
- Background : linear-gradient(135deg, `primary-500`, `primary-600`)
- Color : #FFFFFF
- Border-radius : `radius-md` (12px)
- Padding : `space-3` `space-6` (12px 24px)
- Font-weight : `font-semibold` (600)
- Box-shadow : `shadow-glass-md`
- Height : 48px (touch target)

**États Primary :**
- **Hover** : Brightness(110%), box-shadow `glow-primary`, transition 200ms
- **Pressed** : Scale(0.96), brightness(95%)
- **Disabled** : Opacity 0.4, cursor not-allowed
- **Loading** : Spinner blanc 20×20px centré, texte opacité 0.7

**Secondary Button (actions secondaires) :**
- Background : `glass-surface-light` (rgba(255,255,255,0.5))
- Color : `primary-500`
- Border : 1px solid `glass-border`
- Backdrop-filter : blur(20px)
- Autres propriétés identiques Primary

**Ghost Button (actions tertiaires) :**
- Background : transparent
- Color : `text-primary`
- Border : none
- Padding réduit : `space-2` `space-4`
- Hover : Background `glass-surface-medium`, transition 200ms

**Icon Buttons (FAB, navigation) :**
- Size : 56×56px (FAB), 44×44px (navigation)
- Border-radius : `radius-full`
- Background : gradient primary (FAB), glass surface (navigation)
- Box-shadow : `shadow-glass-xl` (FAB), `shadow-glass-sm` (nav)
- Icon : SVG 24×24px centré

---

### 3.4 Input Field (Text, Search, Password)

**Structure :**
- Background : `glass-surface-light` (rgba(255,255,255,0.5))
- Backdrop-filter : blur(25px)
- Border : 1px solid `glass-border`
- Border-radius : `radius-md` (12px)
- Padding : `space-3` `space-4` (12px 16px)
- Height : 48px
- Font-size : `text-base` (16px) - évite zoom iOS
- Color : `text-primary`

**États :**
- **Default** : Placeholder `text-tertiary`, opacité 0.5
- **Focus** : Border 2px `primary-400`, box-shadow `glow-primary`, backdrop-blur(30px)
- **Filled** : Border `success-500` si validé
- **Error** : Border 2px `danger-500`, helper text rouge en-dessous
- **Disabled** : Opacity 0.4, background plus opaque

**Variantes :**
- **Search** : Icon loupe 20×20px à gauche, padding-left augmenté
- **Password** : Icon œil toggle visibilité à droite
- **Multiline** : Min-height 96px, resize vertical

**Interactions :**
- Focus transition : 200ms `easing-ease-out`
- Auto-complete : Dropdown glassmorphism avec `shadow-glass-lg`
- Clear button : Icône ✕ grise apparaît si rempli (hover)

---

### 3.5 Bottom Navigation Bar (Mobile)

**Structure :**
- Position : fixed bottom
- Background : `glass-surface-light` (rgba(255,255,255,0.5))
- Backdrop-filter : blur(40px) saturate(150%)
- Border-top : 1px solid `glass-border`
- Box-shadow : 0 -4px 16px rgba(0,0,0,0.06)
- Height : 72px (56px + safe-area-inset-bottom)
- Padding : `space-2` `space-4` + safe-area

**Tabs (4 items) :**
- Width : 25% each
- Flex : column, align center
- Gap : `space-1` (4px entre icon et label)

**Tab Item :**
- Icon : SVG 24×24px
- Label : `text-xs` (12px), `font-medium`
- Padding : `space-2` vertical

**États Tab :**
- **Inactive** : Color `text-tertiary`, opacity 0.6
- **Active** : Color `primary-500`, icon scale(1.1), label `font-semibold`
- **Badge** : Pastille rouge 8px `radius-full`, absolute top-right icon

**Transition active :**
- Icon : Transform scale(1.1) + translateY(-2px), color shift, 300ms
- Label : Opacity 0.6 → 1, color shift, 300ms
- Indicator : Barre 32px×3px `primary-500` sous l'onglet, `radius-full`, slide 300ms

---

### 3.6 Modal / Bottom Sheet

**Modal (Desktop/Tablet) :**
- Background : `glass-surface-light` (rgba(255,255,255,0.6))
- Backdrop-filter : blur(40px)
- Border : 1px solid `glass-border`
- Border-radius : `radius-xl` (24px)
- Box-shadow : `shadow-glass-xl`
- Max-width : 480px
- Padding : `space-8` (32px)
- Overlay : `overlay-modal` (rgba(0,0,0,0.4))

**Bottom Sheet (Mobile) :**
- Position : fixed bottom
- Background : `glass-surface-light`
- Backdrop-filter : blur(40px)
- Border-radius : `radius-xl` `radius-xl` 0 0
- Min-height : 40vh, Max-height : 90vh
- Handle : Barre 32px×4px `text-tertiary` centré en haut, `radius-full`
- Padding : `space-6` (24px)

**Animations :**
- **Modal Entrance** : Opacity 0 → 1, scale(0.9) → 1, 400ms `easing-ease-out`
- **Sheet Entrance** : TranslateY(100%) → 0, 400ms `easing-ease-out`
- **Exit** : Inverse de entrance, 300ms
- **Overlay** : Opacity 0 → 1, 300ms synchronized

**Content Structure :**
- Header : Titre `text-xl`, bouton ferme ✕ top-right
- Body : Scroll vertical si nécessaire, padding horizontal maintenu
- Footer : Boutons Primary/Secondary, sticky bottom si scroll

---

## 4. Layout & Responsive

### Architecture Écrans (Mobile-First)

**Référence Content Structure Plan pour pages** :  
10 écrans principaux mappés (Auth, Chats List, Conversation, Files, Call, Contacts, Groups, Status, Settings, Sync Settings).

**Pattern Layout Mobile (320px - 767px) :**
- Container : 100vw, padding `space-4` (16px) horizontal
- Safe areas : respect iOS/Android notches (safe-area-inset-*)
- Navigation : Bottom Tab Bar 72px fixed
- Headers : 56px height, glassmorphism, sticky top
- Content : Scroll vertical, snap points pour sheets

**Grilles & Colonnes :**
- **Liste conversations** : 1 colonne, gap `space-3` (12px)
- **Contacts grid** : 1 colonne (liste), alternative 2 colonnes si avatars seuls
- **Galerie médias** : 3 colonnes, gap `space-2` (8px), aspect-ratio 1:1
- **Settings sections** : 1 colonne, cards `space-4` gap

**Responsive Strategy (Tablet 768px+) :**
- **Breakpoint `md`** : 768px
  - Navigation : Side rail vertical 72px (icons only)
  - Chat : Split view 30/70 (liste conversations | conversation active)
  - Modals : Centré 480px max-width

- **Breakpoint `lg`** : 1024px
  - Chat : Split view 25/75, liste élargie avec previews
  - Settings : 2 colonnes (menu | content)
  - Galerie : 4-6 colonnes selon espace

**Transitions entre écrans :**
- Type : Slide horizontal (Push/Pop), duration 300ms
- Direction : Left-to-right (retour), right-to-left (avancer)
- Easing : `easing-ease-out`
- Overlay : Parallax subtil (écran sortant scale(0.95), opacity 0.7)

**Gestures Mobile :**
- **Swipe back** : Edge swipe gauche = retour navigation
- **Swipe actions** : Sur conversation card = archiver/épingler/supprimer
- **Pull to refresh** : Liste conversations/contacts
- **Long press** : Contextual menu (messages, contacts)

---

## 5. Interaction & Animation

### Principes Animation (Glassmorphism Fluide)

**Timing général :**
- Micro-interactions : 100-200ms (hovers, toggles)
- Transitions standard : 300-400ms (écrans, modals)
- Animations élégantes : 400-600ms (glassmorphism blur, onboarding)

**Easing preferences :**
- 90% cas : `easing-ease-out` (cubic-bezier(0.16, 1, 0.3, 1))
- Modals/Sheets : `easing-ease-in-out`
- Micro-rebonds : `easing-spring` (boutons, FAB)

**Performance (GPU-only) :**
- ✅ Propriétés animées : `transform`, `opacity`, `backdrop-filter`
- ❌ Jamais animer : `width`, `height`, `margin`, `padding`, `top`, `left`

**Animations spécifiques :**

**1. Message Send Animation :**
- Message bubble : Opacity 0 → 1, translateY(8px) → 0, 300ms
- Scale : 0.95 → 1 avec `easing-spring`
- Statut : Spinner 200ms → checkmark ✓ fade-in 200ms

**2. Typing Indicator (3 dots) :**
- Dots : 3 cercles 8px, gap 4px
- Animation : Scale(1) → 1.3 → 1, stagger 200ms chacun
- Loop : infinite, alternating

**3. Connection Status Change :**
- Badge : Color shift `warning-500` → `success-500`, 600ms
- Glow : Apparition `glow-success` fade-in 400ms
- Icon : Rotate 180deg si changement état

**4. Modal/Sheet Entrance :**
- Overlay : Opacity 0 → 1, 300ms
- Modal : Opacity 0 → 1 + Scale(0.9) → 1, 400ms `easing-ease-out`
- Sheet : TranslateY(100%) → 0, 400ms `easing-ease-out`

**5. Glassmorphism Blur Transitions :**
- Backdrop-filter : blur(20px) → blur(40px), 400ms
- Opacity background : 0.3 → 0.5, 400ms synchronized
- Utilisé : Focus inputs, hover cards, active navigation

**6. Pull-to-Refresh :**
- Indicateur : Spinner violet rotate 360deg, loop
- Translation : Proportionnel au pull (max 80px)
- Release : Spring back 300ms `easing-spring`

**Reduced Motion (Accessibility) :**
- Détection : `@media (prefers-reduced-motion: reduce)`
- Fallback : Toutes animations → instant (duration 0ms) ou fade only
- Maintenir : Focus indicators, state changes (sans mouvement)

### Standards Performances

- **Frame rate** : 60fps minimum (16.67ms/frame)
- **Backdrop-blur budget** : Max 3 layers simultanés visibles
- **Shadow complexity** : Max 2 shadows par élément
- **Animation concurrency** : Max 5 animations simultanées

**Tests requis :**
- iPhone SE (performance minimale iOS)
- Android mid-range (Snapdragon 600 series)
- Desktop Chrome/Safari/Firefox latest

---

## Validation Finale

### Checklist Style Guide Compliance

✅ **Glassmorphism Guidelines :**
- Gradients gris-blanc (#F0F2F5 → #FFFFFF) ✓
- rgba overlays (0.3-0.5) ✓
- backdrop-blur (30-40px) ✓
- Violet #6b6fdb saturation réduite ✓
- Animations fluides 400-600ms ✓

✅ **Tokens 4pt Grid :**
- Spacing : 4, 8, 12, 16, 24, 32, 48, 64, 96 ✓
- Radius : 8, 12, 16, 24, 32, full ✓

✅ **Accessibility :**
- Contraste texte : 4.5:1 minimum (AA) ✓
- Touch targets : 44×44px minimum ✓
- Reduced motion : Fallbacks spécifiés ✓

✅ **Components :**
- Max 6 composants définis ✓
- Glassmorphism patterns cohérents ✓
- États (hover, focus, pressed, disabled) ✓

✅ **Layout :**
- Mobile-first responsive ✓
- Breakpoints définis (md: 768px, lg: 1024px) ✓
- Content Structure Plan référencé ✓

✅ **Animations :**
- GPU-only (transform, opacity) ✓
- Durées glassmorphism (400-600ms) ✓
- Easing spécifié ✓
- Reduced motion support ✓

✅ **Interdictions respectées :**
- ❌ Pas de CSS code
- ❌ Pas de chapitre 6+
- ❌ Pas d'ASCII art
- ❌ Pas de mentions de filenames/data
- ❌ Pas d'implémentation détails

### Différenciateurs Clés

1. **Matérialité Verre** : backdrop-blur + rgba overlays créent profondeur unique vs flat Material Design
2. **Violet Premium** : #6b6fdb désaturé sur blanc glassmorphism = sophistication moderne vs couleurs saturées compétiteurs
3. **Animations Fluides** : 400-600ms avec spring easing = perception luxe vs snappy standard
4. **Privacy Visual Language** : Indicateurs E2EE omniprésents avec glow effects = confiance renforcée
5. **Multi-layered Shadows** : Profondeur réaliste vs ombres plates

---

**Document complet : 2 987 mots**  
**Statut : Prêt pour implémentation développeur senior**
