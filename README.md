# ANU (Nephtys) - Secure Messaging Application

ANU (Nephtys) is a secure messaging application with **military-grade end-to-end encryption**, designed for JemaOS.

## 🔐 Security Highlights

ANU implements the **Signal Protocol** for end-to-end encryption, providing:

- **Perfect Forward Secrecy (PFS)**: Compromise of current keys doesn't reveal past messages
- **Post-Compromise Security**: System automatically recovers security after key compromise
- **Deniable Authentication**: Messages are authenticated but cannot be proven to third parties
- **Military-Grade Encryption**: AES-256-GCM, X25519, Ed25519, HKDF-SHA256

### Cryptographic Standards

| Component | Algorithm | Security Level |
|-----------|-----------|----------------|
| Key Exchange | X3DH + X25519 | 128-bit |
| Message Encryption | AES-256-GCM | 256-bit |
| Digital Signatures | Ed25519 | 128-bit |
| Key Derivation | HKDF-SHA256 | 256-bit |
| Forward Secrecy | Double Ratchet | Per-message |

### Compliance

- ✅ **ANSSI** (Agence Nationale de la Sécurité des Systèmes d'Information) recommendations
- ✅ **RGPD** (Règlement Général sur la Protection des Données) compliant
- ✅ **Signal Protocol** specification compliant

> 📄 For detailed security documentation, see [Security Certification](docs/SECURITY_CERTIFICATION_E2EE.md)

---

## Features

- 💬 Real-time instant messaging
- 🔒 Military-grade End-to-End Encryption (E2EE)
- 📞 Encrypted WebRTC audio/video calls
- 👥 Secure group conversations (Sender Keys protocol)
- 🔑 Encrypted key storage at rest
- 📱 Modern Glassmorphism design
- 🌙 Native dark mode
- 📴 Offline support (PWA)
- 🔄 Automatic key rotation
- ✅ Safety number verification

---

## Security Architecture

### End-to-End Encryption Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANU E2EE Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐    X3DH Key Agreement    ┌─────────┐              │
│  │  Alice  │◄─────────────────────────►│   Bob   │              │
│  └────┬────┘                          └────┬────┘              │
│       │                                    │                    │
│       │         Shared Secret              │                    │
│       └──────────────┬─────────────────────┘                    │
│                      │                                          │
│                      ▼                                          │
│            ┌─────────────────┐                                  │
│            │  Double Ratchet │                                  │
│            │    Algorithm    │                                  │
│            └────────┬────────┘                                  │
│                     │                                           │
│         ┌───────────┼───────────┐                               │
│         ▼           ▼           ▼                               │
│    ┌─────────┐ ┌─────────┐ ┌─────────┐                         │
│    │ Message │ │ Message │ │ Message │                         │
│    │  Key 1  │ │  Key 2  │ │  Key N  │                         │
│    └────┬────┘ └────┬────┘ └────┬────┘                         │
│         │           │           │                               │
│         ▼           ▼           ▼                               │
│    ┌─────────────────────────────────┐                         │
│    │        AES-256-GCM              │                         │
│    │   Authenticated Encryption      │                         │
│    └─────────────────────────────────┘                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Module | Purpose | Location |
|--------|---------|----------|
| X3DH | Asynchronous key agreement | `src/lib/crypto/x3dh.ts` |
| Double Ratchet | Forward-secure messaging | `src/lib/crypto/doubleRatchet.ts` |
| Key Storage | Encrypted key persistence | `src/lib/crypto/keyStorage.ts` |
| Messaging Service | High-level E2EE API | `src/lib/crypto/messagingService.ts` |
| Group Encryption | Sender Keys protocol | `src/lib/crypto/groupEncryption.ts` |
| WebRTC E2EE | Media stream encryption | `src/lib/crypto/webrtcE2EE.ts` |

> 📄 For API documentation, see [Crypto API Reference](docs/CRYPTO_API_REFERENCE.md)

---

## Technologies

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + Glassmorphism
- **Backend**: Supabase (Auth, Database, Realtime, Storage)
- **Communication**: WebRTC for P2P
- **Cryptography**:
  - `@noble/curves` - Ed25519, X25519 (audited by Cure53)
  - `@noble/hashes` - SHA-256, HMAC, HKDF (audited by Cure53)
  - `@noble/ciphers` - AES-256-GCM (audited by Cure53)

---

## Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Build

```bash
# Production build
npm run build

# Preview production build
npm run preview
```

## Testing

```bash
# Run security tests
npm run test

# Run tests with coverage
npm run test:coverage
```

---

## Project Structure

```
src/
├── components/          # Reusable React components
├── context/             # React contexts (Auth, Theme, Call)
├── hooks/               # Custom hooks
├── lib/
│   ├── crypto/          # 🔐 E2EE Implementation
│   │   ├── index.ts           # Main exports
│   │   ├── hkdf.ts            # Key derivation (RFC 5869)
│   │   ├── signatures.ts      # Ed25519 signatures
│   │   ├── x3dh.ts            # X3DH key agreement
│   │   ├── doubleRatchet.ts   # Double Ratchet algorithm
│   │   ├── keyStorage.ts      # Secure key storage
│   │   ├── messagingService.ts # High-level API
│   │   ├── groupEncryption.ts # Sender Keys protocol
│   │   ├── webrtcE2EE.ts      # WebRTC encryption
│   │   └── __tests__/         # Security tests
│   ├── supabase.ts      # Supabase client
│   └── utils.ts         # Utilities
├── pages/               # Application pages
└── types/               # TypeScript types
```

---

## Security Documentation

| Document | Description |
|----------|-------------|
| [Security Certification](docs/SECURITY_CERTIFICATION_E2EE.md) | Complete security certification for government review |
| [Crypto API Reference](docs/CRYPTO_API_REFERENCE.md) | Technical API documentation |

---

## Quick Start: E2EE Integration

```typescript
import { getMessagingService } from '@/lib/crypto';

// Initialize
const service = getMessagingService();
await service.initialize(userId, userPassword);

// Establish session
const recipientBundle = await fetchPublicKeyBundle(recipientId);
await service.establishSession(recipientId, recipientBundle);

// Send encrypted message
const encrypted = await service.encryptMessage(recipientId, "Hello!");

// Receive and decrypt
const plaintext = await service.decryptMessage(encryptedPayload);
```

---

## Security Best Practices

1. **Never log plaintext messages or private keys**
2. **Verify safety numbers** for sensitive conversations
3. **Keep the application updated** for security patches
4. **Use strong passwords** for key storage encryption
5. **Enable device security** (screen lock, encryption)

---

## License

© 2025 ANU/Nephtys. All rights reserved.

---

## Security Contact

For security vulnerabilities, please contact the security team directly.
Do not create public issues for security-related matters.
