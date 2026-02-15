// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';

const searilizeError = (error: any) => {
  if (error instanceof Error) {
    return error.message + '\n' + error.stack;
  }
  return JSON.stringify(error, null, 2);
};

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any) {
    // Handle chunk loading errors by reloading the page
    if (error?.message?.includes('Failed to fetch dynamically imported module') ||
        error?.message?.includes('Importing a module script failed')) {
      console.log('Chunk load error detected, reloading...');
      // Prevent infinite reload loops
      const lastReload = sessionStorage.getItem('chunk_reload_time');
      const now = Date.now();
      
      if (!lastReload || (now - Number.parseInt(lastReload)) > 10000) {
        sessionStorage.setItem('chunk_reload_time', String(now));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      // If it's a chunk error and we are reloading, show loading
      if (this.state.error?.message?.includes('Failed to fetch dynamically imported module') ||
          this.state.error?.message?.includes('Importing a module script failed')) {
        return (
          <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p>Mise à jour de l'application...</p>
            </div>
          </div>
        );
      }

      return (
        <div className="p-4 border border-red-500 rounded bg-gray-900 text-white h-screen flex flex-col items-center justify-center">
          <h2 className="text-red-500 text-xl font-bold mb-4">Une erreur est survenue</h2>
          <p className="mb-4 text-gray-300">Veuillez rafraîchir la page.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary-500 rounded hover:bg-primary-600 transition-colors"
          >
            Rafraîchir
          </button>
          <pre className="mt-8 text-xs text-gray-500 max-w-lg overflow-auto p-4 bg-black/50 rounded">
            {searilizeError(this.state.error)}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}