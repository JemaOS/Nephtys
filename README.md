# Nephtys

<p align="center">
  <img src="public/icon.svg" alt="Nephtys Logo" width="120" height="120">
</p>

<p align="center">
  <strong>Privacy-First Decentralized Messaging for JemaOS</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#security">Security</a> •
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#license">License</a>
</p>

---

## Overview

Nephtys is a modern, privacy-focused messaging application built for JemaOS. It provides end-to-end encrypted communications with a beautiful, responsive interface that works seamlessly across desktop and mobile devices as a Progressive Web App (PWA).

**Key Principles:**
- 🔒 **End-to-End Encryption** - All messages are encrypted using the Signal Protocol
- 🌐 **Decentralized Architecture** - Peer-to-peer communication when possible
- 🚫 **Zero Data Collection** - No tracking, no ads, no logs
- 📱 **PWA Support** - Install on any device, works offline

## Features

### Messaging
- **Real-time messaging** with instant delivery and read receipts
- **Group chats** with unlimited participants
- **Voice messages** with waveform visualization
- **Media sharing** - Photos, videos, documents, and files
- **GIF & Sticker support** via GIPHY integration
- **Link previews** with automatic metadata extraction
- **Message reactions** with emoji support
- **Reply & Forward** messages across conversations
- **Pin messages** for quick access
- **Ephemeral messages** with auto-delete timer
- **Message search** across all conversations

### Calls
- **Voice calls** with WebRTC
- **Video calls** with HD quality
- **Group calls** supporting multiple participants
- **End-to-end encrypted** audio and video streams
- **Picture-in-picture** mode for multitasking

### Media
- **Image editor** with crop, rotate, and filters
- **Document preview** for PDF, Word, Excel, PowerPoint
- **Video player** with progress bar and speed control
- **Audio player** with modern waveform design
- **Media gallery** with grid view
- **Full-screen viewer** with zoom and pan

### Privacy & Security
- **Signal Protocol** implementation (X3DH + Double Ratchet)
- **Perfect Forward Secrecy** - Past messages remain secure
- **Security codes** for contact verification
- **Local encryption** of cached data
- **No server-side message storage** (messages transit only)

### User Experience
- **Dark/Light themes** with system preference detection
- **Responsive design** - Desktop, tablet, and mobile
- **Offline support** with message queue
- **Pull-to-refresh** on mobile
- **Keyboard shortcuts** for power users
- **Multi-language support** (French, English)

### PWA Features
- **Installable** on iOS, Android, Windows, macOS, Linux
- **Push notifications** for new messages
- **Background sync** for offline messages
- **Wake Lock API** to prevent sleep during calls
- **Service Worker** for offline functionality

## Security

### Encryption Architecture

Nephtys implements the Signal Protocol for end-to-end encryption:

```
┌─────────────────────────────────────────────────────────────┐
│                    Signal Protocol Stack                     │
├─────────────────────────────────────────────────────────────┤
│  X3DH (Extended Triple Diffie-Hellman)                      │
│  - Identity Key (long-term)                                 │
│  - Signed Pre-Key (medium-term)                             │
│  - One-Time Pre-Keys (single-use)                           │
├─────────────────────────────────────────────────────────────┤
│  Double Ratchet Algorithm                                   │
│  - Symmetric-key ratchet (per message)                      │
│  - Diffie-Hellman ratchet (per round-trip)                  │
├─────────────────────────────────────────────────────────────┤
│  HKDF (HMAC-based Key Derivation Function)                  │
│  - Derives encryption keys from shared secrets              │
├─────────────────────────────────────────────────────────────┤
│  AES-256-GCM                                                │
│  - Authenticated encryption for messages                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

| Feature | Implementation |
|---------|---------------|
| Key Exchange | X3DH (Curve25519) |
| Message Encryption | AES-256-GCM |
| Key Derivation | HKDF-SHA256 |
| Digital Signatures | Ed25519 |
| Forward Secrecy | Double Ratchet |
| Post-Compromise Security | DH Ratchet |

### Security Certifications

- All cryptographic operations use the Web Crypto API
- Keys are stored securely in IndexedDB with encryption
- No plaintext messages are ever stored on servers
- Security code verification prevents MITM attacks

## Installation

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm
- Supabase account for backend

### Quick Start

```bash
# Clone the repository
git clone https://github.com/johnkryptochain/Nephtys.git
cd Nephtys

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Supabase credentials

# Start development server
pnpm dev
```

### Environment Variables

Create a `.env` file with the following:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Build for Production

```bash
# Build the application
pnpm build

# Preview production build
pnpm preview
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

## Development

### Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | React 18, TypeScript |
| Styling | Tailwind CSS |
| State Management | React Context + Hooks |
| Routing | React Router v6 |
| Backend | Supabase (PostgreSQL + Realtime) |
| Build Tool | Vite |
| PWA | Workbox, Service Worker |
| Encryption | Web Crypto API |

### Project Structure

```
src/
├── components/          # React components
│   ├── DocumentPreview/ # PDF/Document viewers
│   └── ...
├── context/            # React contexts
│   ├── AuthContext.tsx
│   ├── CallContext.tsx
│   └── ThemeContext.tsx
├── hooks/              # Custom React hooks
│   ├── useKeepAlive.ts
│   ├── usePresence.ts
│   ├── useSupabaseReconnect.ts
│   └── ...
├── lib/                # Utility libraries
│   ├── crypto/         # Encryption implementation
│   │   ├── x3dh.ts
│   │   ├── doubleRatchet.ts
│   │   └── ...
│   ├── supabase.ts
│   └── webrtc.ts
├── pages/              # Page components
│   ├── ChatsPage.tsx
│   ├── ChatViewPage.tsx
│   └── ...
└── workers/            # Web Workers
    └── keepalive.worker.ts
```

### Key Components

#### Encryption (`src/lib/crypto/`)
- `x3dh.ts` - X3DH key exchange protocol
- `doubleRatchet.ts` - Double Ratchet algorithm
- `hkdf.ts` - Key derivation functions
- `keyStorage.ts` - Secure key storage
- `messagingService.ts` - High-level encryption API

#### Real-time (`src/hooks/`)
- `useSupabaseReconnect.ts` - PWA reconnection handling
- `useKeepAlive.ts` - Background connection maintenance
- `usePresence.ts` - Online status tracking

#### Media (`src/components/`)
- `MediaViewer.tsx` - Full-screen media viewer
- `VoiceRecorder.tsx` - Voice message recording
- `DocumentPreview/` - Document preview system

### Running Tests

```bash
# Run unit tests
pnpm test

# Run security tests
pnpm test:security
```

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Client (PWA)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   React UI  │  │  Crypto Lib │  │   Service Worker    │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Supabase Backend                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  PostgreSQL │  │   Realtime  │  │      Storage        │  │
│  │  (metadata) │  │  (WebSocket)│  │   (encrypted files) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Message Sending:**
   - User composes message
   - Message encrypted with recipient's session key
   - Encrypted payload sent to Supabase
   - Realtime broadcasts to recipient
   - Recipient decrypts with their session key

2. **Key Exchange:**
   - New contact initiates X3DH
   - Pre-keys fetched from server
   - Shared secret computed locally
   - Double Ratchet session established

3. **Media Upload:**
   - File encrypted client-side
   - Uploaded to Supabase Storage
   - URL shared in encrypted message
   - Recipient downloads and decrypts

### Database Schema

```sql
-- Core tables (simplified)
profiles (id, username, display_name, avatar_url, public_key)
conversations (id, type, name, created_at)
conversation_members (conversation_id, user_id, is_admin)
messages (id, conversation_id, sender_id, content, type, created_at)
pre_keys (user_id, key_id, public_key, signature)
```

## PWA Optimizations

### Android PWA Handling

Nephtys includes special handling for Android PWA limitations:

- **Force Reload Strategy** - Automatically reloads after long background periods
- **Connection Health Monitoring** - Detects and recovers from stale connections
- **Wake Lock API** - Prevents device sleep during active calls
- **Service Worker Bypass** - Supabase requests bypass SW for reliability

### Offline Support

- Messages queued when offline
- Automatic sync when connection restored
- Cached conversations for instant loading
- Background sync for pending operations

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Guidelines

1. Follow TypeScript best practices
2. Write tests for new features
3. Update documentation as needed
4. Use conventional commits

## License

Copyright (c) 2025 Jema Technology.
Distributed under the license specified in the root directory of this project.

## Acknowledgments

- [Signal Protocol](https://signal.org/docs/) - Encryption protocol
- [Supabase](https://supabase.com/) - Backend infrastructure
- [React](https://react.dev/) - UI framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Vite](https://vitejs.dev/) - Build tool

---

<p align="center">
  Made with ❤️ by <a href="https://jematechnology.com">Jema Technology</a>
</p>