import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { backend, type Profile } from '../data'

interface AuthState {
  profile: Profile | null
  loading: boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState>({ profile: null, loading: true, refresh: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setProfile(await backend.getCurrentProfile())
    } catch (err) {
      console.error(err)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    return backend.onAuthChange(refresh)
  }, [refresh])

  return <AuthContext.Provider value={{ profile, loading, refresh }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
