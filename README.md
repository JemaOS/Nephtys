# Nephtys

**Nephtys** is a secure, modern communication platform developed by **Jematechnology**. Built with privacy and performance in mind, it offers real-time messaging, voice/video calls, and secure file sharing.

## Features

- **Secure Messaging**: End-to-end encrypted messaging ensuring privacy.
- **Real-time Communication**: Instant messaging and presence updates.
- **Voice & Video Calls**: High-quality WebRTC-based audio and video calling.
- **File Sharing**: Secure media and document sharing with preview capabilities.
- **Responsive Design**: Optimized for both desktop and mobile devices.
- **Group Management**: Create and manage group conversations easily.

## Tech Stack

- **Frontend**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/)
- **Backend/Database**: [Supabase](https://supabase.com/)
- **Testing**: [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Jematechnology/nephtys.git
   cd nephtys
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add your Supabase credentials and other necessary configuration.

### Running the Application

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`.

## Scripts

- `npm run dev`: Start the development server.
- `npm run build`: Build the application for production.
- `npm run preview`: Preview the production build locally.
- `npm run lint`: Run ESLint to check for code quality issues.
- `npm run test`: Run unit tests with Vitest.
- `npm run test:e2e`: Run end-to-end tests with Playwright.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL v3)**. See the [LICENSE](LICENSE) file for details.

---

Copyright © 2025 Jematechnology. All rights reserved.
