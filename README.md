# Nephtys - Messagerie Sécurisée

Nephtys est une application de messagerie sécurisée avec chiffrement de bout en bout, conçue pour JemaOS.

## Fonctionnalités

- 💬 Messagerie instantanée en temps réel
- 🔒 Chiffrement de bout en bout (E2EE)
- 📞 Appels audio/vidéo WebRTC
- 👥 Groupes et conversations
- 📱 Design Glassmorphism moderne
- 🌙 Mode sombre natif
- 📴 Support hors-ligne (PWA)

## Technologies

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + Glassmorphism
- **Backend**: Supabase (Auth, Database, Realtime, Storage)
- **Communication**: WebRTC pour P2P

## Installation

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Structure du projet

```
src/
├── components/     # Composants React réutilisables
├── context/        # Contextes React (Auth, Theme, Call)
├── hooks/          # Hooks personnalisés
├── lib/            # Utilitaires et services
├── pages/          # Pages de l'application
└── types/          # Types TypeScript
```

## Licence

© 2025 Nephtys. Tous droits réservés.
