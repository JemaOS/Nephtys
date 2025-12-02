import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { CallProvider } from './context/CallContext'
import { AuthPage } from './pages/AuthPage'
import { ChatsPage } from './pages/ChatsPage'
import { ChatViewPage } from './pages/ChatViewPage'
import { ContactsPage } from './pages/ContactsPage'
import { GroupsPage } from './pages/GroupsPage'
import { StatusPage } from './pages/StatusPage'
import { CallsPage } from './pages/CallsPage'
import { ArchivedPage } from './pages/ArchivedPage'
import { SettingsPage } from './pages/SettingsPage'
import { OfflineIndicator } from './components/OfflineIndicator'
import { PersistentCallScreen } from './components/PersistentCallScreen'
import { useEffect, useState } from 'react'

// Optimized loading component that shows quickly and doesn't block
function LoadingScreen({ message = 'Chargement...' }: { message?: string }) {
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

function PrivateRoute({ children }: { children: React.ReactNode }) {
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
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          Réessayer
        </button>
      </div>
    );
  }
  
  return user ? <>{children}</> : <Navigate to="/auth" />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  // Show loading only briefly
  if (loading && !user) {
    return <LoadingScreen />;
  }
  
  return !user ? <>{children}</> : <Navigate to="/chats" />
}

function AppRoutes() {
  return (
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
      
      <Route path="/status" element={
        <PrivateRoute>
          <StatusPage />
        </PrivateRoute>
      } />
      
      <Route path="/settings" element={
        <PrivateRoute>
          <SettingsPage />
        </PrivateRoute>
      } />
      
      <Route path="/" element={<Navigate to="/chats" />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CallProvider>
            <OfflineIndicator />
            <PersistentCallScreen />
            <AppRoutes />
          </CallProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
