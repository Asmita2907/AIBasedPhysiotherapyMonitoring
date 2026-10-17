import type { Feedback, RepFrame, RepMetrics, Side } from '../exercise/types'

export type Role = 'patient' | 'physio'
export type ReviewStatus = 'not_required' | 'pending' | 'reviewed'
export type Verdict = 'correct' | 'incorrect'

export interface Profile {
  id: string
  email: string | null
  full_name: string
  role: Role
}

export interface SessionRecord {
  id: string
  patient_id: string
  exercise: string
  side: Side
  confidence_threshold: number
  started_at: string
  ended_at: string
  total_reps: number
  correct_reps: number
  flagged_reps: number
  avg_confidence: number | null
  tips: string[]
}

export interface ReviewRecord {
  id: string
  rep_id: string
  physio_id: string
  verdict: Verdict
  comment: string
  created_at: string
}

export interface RepRecord {
  id: string
  session_id: string
  patient_id: string
  rep_index: number
  is_correct: boolean
  confidence: number
  needs_review: boolean
  feedback: Feedback[]
  metrics: RepMetrics
  frames: RepFrame[] | null
  review_status: ReviewStatus
  assigned_physio_id: string | null
  created_at: string
  review: ReviewRecord | null
}

export type NewSession = Omit<SessionRecord, 'id' | 'patient_id'>
export type NewRep = Pick<RepRecord, 'rep_index' | 'is_correct' | 'confidence' | 'needs_review' | 'feedback' | 'metrics' | 'frames'>

export interface QueueItem {
  rep: RepRecord
  session: SessionRecord
  patient: Profile
}

export interface DataBackend {
  readonly mode: 'supabase' | 'demo'
  getCurrentProfile(): Promise<Profile | null>
  onAuthChange(cb: () => void): () => void
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string, fullName: string, role: Role): Promise<{ needsConfirmation: boolean }>
  signOut(): Promise<void>
  saveSession(session: NewSession, reps: NewRep[]): Promise<SessionRecord>
  listMySessions(): Promise<SessionRecord[]>
  getSession(id: string): Promise<{ session: SessionRecord; reps: RepRecord[] }>
  listReviewQueue(status: 'pending' | 'reviewed'): Promise<QueueItem[]>
  getQueueItem(repId: string): Promise<QueueItem>
  submitReview(repId: string, verdict: Verdict, comment: string): Promise<void>
}
