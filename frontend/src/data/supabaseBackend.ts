import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DataBackend, NewRep, NewSession, Profile, QueueItem, RepRecord, Role, SessionRecord, Verdict } from './types'

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function toSession(row: Record<string, unknown>): SessionRecord {
  return {
    ...(row as unknown as SessionRecord),
    confidence_threshold: Number(row.confidence_threshold),
    avg_confidence: num(row.avg_confidence),
  }
}

function toRep(row: Record<string, unknown>): RepRecord {
  const reviews = row.reviews as RepRecord['review'] | RepRecord['review'][] | undefined
  const review = Array.isArray(reviews) ? (reviews[0] ?? null) : (reviews ?? null)
  const { reviews: _omit, ...rest } = row
  void _omit
  return { ...(rest as unknown as RepRecord), confidence: Number(row.confidence), review }
}

export class SupabaseBackend implements DataBackend {
  readonly mode = 'supabase' as const
  private client: SupabaseClient

  constructor(url: string, anonKey: string, private apiUrl?: string) {
    this.client = createClient(url, anonKey)
  }

  async getCurrentProfile(): Promise<Profile | null> {
    const { data } = await this.client.auth.getSession()
    const user = data.session?.user
    if (!user) return null
    const { data: profile, error } = await this.client.from('profiles').select('*').eq('id', user.id).single()
    if (error) throw error
    return profile as Profile
  }

  onAuthChange(cb: () => void) {
    const { data } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(cb, 0)
      }
    })
    return () => data.subscription.unsubscribe()
  }

  async signIn(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async signUp(email: string, password: string, fullName: string, _role: Role) {
    // Role is ignored: every new account is a patient. Physiotherapists are
    // promoted in the database (see supabase/migrations).
    void _role
    const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
    if (error) throw error
    return { needsConfirmation: !data.session }
  }

  async signOut() {
    await this.client.auth.signOut()
  }

  async saveSession(session: NewSession, reps: NewRep[]): Promise<SessionRecord> {
    const { data, error } = await this.client.from('exercise_sessions').insert(session).select().single()
    if (error) throw error
    if (reps.length) {
      const { error: repError } = await this.client
        .from('reps')
        .insert(reps.map((r) => ({ ...r, session_id: data.id, frames: r.needs_review ? r.frames : null })))
      if (repError) throw repError
    }
    if (reps.some((r) => r.needs_review)) await this.routeForReview(data.id)
    return toSession(data)
  }

  /** Asks the FastAPI service to assign flagged reps to a physiotherapist. */
  private async routeForReview(sessionId: string) {
    if (!this.apiUrl) return
    const { data } = await this.client.auth.getSession()
    try {
      const res = await fetch(`${this.apiUrl}/api/reviews/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!res.ok) console.warn('Review routing failed', res.status, await res.text())
    } catch (err) {
      // Unassigned reps still show up in every physiotherapist's queue.
      console.warn('Review routing service unreachable', err)
    }
  }

  async listMySessions(): Promise<SessionRecord[]> {
    const profile = await this.getCurrentProfile()
    const { data, error } = await this.client
      .from('exercise_sessions')
      .select('*')
      .eq('patient_id', profile?.id ?? '')
      .order('started_at', { ascending: false })
    if (error) throw error
    return data.map(toSession)
  }

  async getSession(id: string) {
    const { data: session, error } = await this.client.from('exercise_sessions').select('*').eq('id', id).single()
    if (error) throw error
    const { data: reps, error: repError } = await this.client
      .from('reps')
      .select('id, session_id, patient_id, rep_index, is_correct, confidence, needs_review, feedback, metrics, review_status, assigned_physio_id, created_at, reviews(*)')
      .eq('session_id', id)
      .order('rep_index')
    if (repError) throw repError
    return { session: toSession(session), reps: reps.map((r) => toRep({ ...r, frames: null })) }
  }

  async listReviewQueue(status: 'pending' | 'reviewed'): Promise<QueueItem[]> {
    const { data, error } = await this.client
      .from('reps')
      .select('id, session_id, patient_id, rep_index, is_correct, confidence, needs_review, feedback, metrics, review_status, assigned_physio_id, created_at, reviews(*), exercise_sessions(*), profiles!reps_patient_id_fkey(*)')
      .eq('needs_review', true)
      .eq('review_status', status)
      .order('created_at', { ascending: status === 'pending' })
      .limit(200)
    if (error) throw error
    return data.map((row) => this.toQueueItem({ ...row, frames: null }))
  }

  async getQueueItem(repId: string): Promise<QueueItem> {
    const { data, error } = await this.client
      .from('reps')
      .select('*, reviews(*), exercise_sessions(*), profiles!reps_patient_id_fkey(*)')
      .eq('id', repId)
      .single()
    if (error) throw error
    return this.toQueueItem(data)
  }

  private toQueueItem(row: Record<string, unknown>): QueueItem {
    const { exercise_sessions, profiles, ...rep } = row
    return {
      rep: toRep(rep),
      session: toSession(exercise_sessions as Record<string, unknown>),
      patient: profiles as Profile,
    }
  }

  async submitReview(repId: string, verdict: Verdict, comment: string) {
    const { error } = await this.client.from('reviews').insert({ rep_id: repId, verdict, comment })
    if (error) throw error
  }
}
