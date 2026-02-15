// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { CallProvider } from './context/CallContext'
import { OfflineIndicator } from './components/OfflineIndicator'
import { PersistentCallScreen } from './components/PersistentCallScreen'
import { useSupabaseReconnect } from './hooks/useSupabaseReconnect'
import { useKeepAlive } from './hooks/useKeepAlive'
import { startConnectionMonitoring, stopConnectionMonitoring } from './lib/supabase'
import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'

// Create a QueryClient with optimized caching for instant user profile display
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // Profiles don't change often, cache indefinitely until page refresh
      gcTime: 1000 * 60 * 30, // Keep unused data for 30 minutes
      refetchOnWindowFocus: false, // Don't refetch when window regains focus (prevents flickering)
      retry: 1, // Only retry once on failure
    },
  },
})

const AuthPage = lazy(() => import('./pages/AuthPage').then(module => ({ default: module.AuthPage })))
const ChatsPage = lazy(() => import('./pages/ChatsPage').then(module => ({ default: module.ChatsPage })))
const ChatViewPage = lazy(() => import('./pages/ChatViewPage').then(module => ({ default: module.ChatViewPage })))
const ContactsPage = lazy(() => import('./pages/ContactsPage').then(module => ({ default: module.ContactsPage })))
const GroupsPage = lazy(() => import('./pages/GroupsPage').then(module => ({ default: module.GroupsPage })))
const CallsPage = lazy(() => import('./pages/CallsPage').then(module => ({ default: module.CallsPage })))
const ArchivedPage = lazy(() => import('./pages/ArchivedPage').then(module => ({ default: module.ArchivedPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })))

// Optimized loading component that shows quickly and doesn't block
function LoadingScreen({ message = 'Chargement...' }: { readonly message?: string }) {
  const [showSlowWarning, setShowSlowWarning] = useState(false);
  
  useEffect(() => {
    // Show warning if loading takes more than 3 seconds
    const timer = setTimeout(() => {
      setShowSlowWarning(true);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, []);
  
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-background-primary">
      <div className="w-16 h-16 rounded-full border-4 border-primary-500 border-t-transparent animate-spin mb-4" />
      <p className="text-text-secondary text-sm">{message}</p>
      {showSlowWarning && (
        <p className="text-text-tertiary text-xs mt-2 text-center px-4">
          La connexion est lente. Vérifiez votre réseau.
        </p>
      )}
    </div>
  );
}

function PrivateRoute({ children }: { readonly children: React.ReactNode }) {
  const { user, loading, isOffline } = useAuth()
  
  // Show loading only briefly - if we have cached user, show content immediately
  if (loading && !user) {
    return <LoadingScreen message="Connexion en cours..." />;
  }
  
  // If offline and no user, show offline message instead of redirect
  if (!user && isOffline) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background-primary p-4">
        <div className="text-4xl mb-4">📡</div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">Mode hors ligne</h2>
        <p className="text-text-secondary text-center mb-4">
          Connectez-vous à Internet pour accéder à l'application.
        </p>
        <button
          onClick={() => globalThis.location.reload()}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          Réessayer
        </button>
      </div>
    );
  }
  
  return user ? <>{children}</> : <Navigate to="/auth" />
}

// Component to handle Supabase reconnection for PWA
function SupabaseReconnectHandler() {
  const { user } = useAuth()
  
  // Use the reconnect hook - it handles all the visibility/focus events
  const { reconnect } = useSupabaseReconnect(user?.id || null)
  
  // Callback for keep-alive reconnect requests
  const handleKeepAliveReconnect = useCallback(() => {
    console.log('[App] Keep-alive requested reconnect')
    reconnect()
  }, [reconnect])
  
  // Use keep-alive hook for PWA - maintains connection with Web Worker + Wake Lock
  // Also includes auto-reload as last resort for stuck connections
  const { markConnectionSuccess } = useKeepAlive(handleKeepAliveReconnect, !!user)
  
  // Start connection monitoring when user is logged in
  useEffect(() => {
    if (user) {
      // Start monitoring connection health
      startConnectionMonitoring()
      
      // Listen for connection lost events
      const handleConnectionLost = () => {
        console.log('[App] Connection lost detected, triggering reconnect...')
        reconnect()
      }
      
      // Listen for successful data loads to mark connection as healthy
      const handleConnectionSuccess = () => {
        console.log('[App] Connection success detected')
        markConnectionSuccess()
      }
      
      globalThis.addEventListener('supabase-connection-lost', handleConnectionLost)
      globalThis.addEventListener('supabase-connection-success', handleConnectionSuccess)
      
      return () => {
        stopConnectionMonitoring()
        globalThis.removeEventListener('supabase-connection-lost', handleConnectionLost)
        globalThis.removeEventListener('supabase-connection-success', handleConnectionSuccess)
      }
    }
  }, [user, reconnect, markConnectionSuccess])
  
  return null // This component doesn't render anything
}

function PublicRoute({ children }: { readonly children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  // Show loading only briefly
  if (loading && !user) {
    return <LoadingScreen />;
  }
  
  return user ? <Navigate to="/chats" /> : <>{children}</>
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/auth" element={
          <PublicRoute>
            <AuthPage />
          </PublicRoute>
        } />
        
        <Route path="/chats" element={
          <PrivateRoute>
            <ChatsPage />
          </PrivateRoute>
        } />
        
        <Route path="/chat/:conversationId" element={
          <PrivateRoute>
            <ChatViewPage />
          </PrivateRoute>
        } />
        
        <Route path="/contacts" element={
          <PrivateRoute>
            <ContactsPage />
          </PrivateRoute>
        } />
        
        <Route path="/groups/new" element={
          <PrivateRoute>
            <GroupsPage />
          </PrivateRoute>
        } />
        
        <Route path="/calls" element={
          <PrivateRoute>
            <CallsPage />
          </PrivateRoute>
        } />
        
        <Route path="/archived" element={
          <PrivateRoute>
            <ArchivedPage />
          </PrivateRoute>
        } />
        
        <Route path="/settings" element={
          <PrivateRoute>
            <SettingsPage />
          </PrivateRoute>
        } />
        
          <Route path="/" element={<Navigate to="/chats" />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <CallProvider>
              <SupabaseReconnectHandler />
              <OfflineIndicator />
              <PersistentCallScreen />
              <AppRoutes />
            </CallProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  )
}

export default App
