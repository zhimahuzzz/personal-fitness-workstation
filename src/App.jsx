import React from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import TabBar from './components/TabBar'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Training from './pages/Training'
import Diet from './pages/Diet'
import BodyStatus from './pages/BodyStatus'
import Profile from './pages/Profile'

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div className="empty" style={{ paddingTop: '40vh' }}>加载中…</div>
  if (!user) return <Login />
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/training" element={<Training />} />
        <Route path="/diet" element={<Diet />} />
        <Route path="/body" element={<BodyStatus />} />
        <Route path="/me" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar />
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </HashRouter>
    </AuthProvider>
  )
}
