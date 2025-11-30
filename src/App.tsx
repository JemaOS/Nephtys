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
import { CallScreenWrapper } from './components/CallScreenWrapper'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-16 h-16 rounded-full border-4 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }
  
  return user ? <>{children}</> : <Navigate to="/auth" />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-16 h-16 rounded-full border-4 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
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
            <CallScreenWrapper />
            <AppRoutes />
          </CallProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
