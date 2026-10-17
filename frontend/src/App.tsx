import type { ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { backend, type Role } from './data'
import ExercisePage from './pages/ExercisePage'
import LoginPage from './pages/LoginPage'
import PatientHome from './pages/PatientHome'
import ReviewPage from './pages/ReviewPage'
import ReviewQueuePage from './pages/ReviewQueuePage'
import SessionPage from './pages/SessionPage'

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <p className="center muted">Loading...</p>
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== role) return <Navigate to="/" replace />
  return <>{children}</>
}

function Home() {
  const { profile, loading } = useAuth()
  if (loading) return <p className="center muted">Loading...</p>
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={profile.role === 'physio' ? '/queue' : '/home'} replace />
}

function Header() {
  const { profile } = useAuth()
  return (
    <header className="app-header">
      <Link to="/" className="brand">PhysioCam</Link>
      {backend.mode === 'demo' && <span className="badge demo" title="No Supabase keys configured: data is stored in this browser only">Demo mode</span>}
      <nav>
        {profile?.role === 'patient' && <Link to="/home">My exercises</Link>}
        {profile?.role === 'physio' && <Link to="/queue">Review queue</Link>}
        {profile && (
          <>
            <span className="muted">{profile.full_name || profile.email} ({profile.role === 'physio' ? 'Physiotherapist' : 'Patient'})</span>
            <button type="button" className="link" onClick={() => backend.signOut()}>Sign out</button>
          </>
        )}
      </nav>
    </header>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Header />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/home" element={<RequireRole role="patient"><PatientHome /></RequireRole>} />
            <Route path="/exercise/bicep-curl" element={<RequireRole role="patient"><ExercisePage /></RequireRole>} />
            <Route path="/sessions/:id" element={<RequireRole role="patient"><SessionPage /></RequireRole>} />
            <Route path="/queue" element={<RequireRole role="physio"><ReviewQueuePage /></RequireRole>} />
            <Route path="/review/:repId" element={<RequireRole role="physio"><ReviewPage /></RequireRole>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  )
}
