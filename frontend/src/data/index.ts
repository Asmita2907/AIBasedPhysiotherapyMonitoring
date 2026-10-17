import { DemoBackend } from './demoBackend'
import { SupabaseBackend } from './supabaseBackend'
import type { DataBackend } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const apiUrl = import.meta.env.VITE_API_URL as string | undefined

export const backend: DataBackend = url && anonKey ? new SupabaseBackend(url, anonKey, apiUrl) : new DemoBackend()

export * from './types'
