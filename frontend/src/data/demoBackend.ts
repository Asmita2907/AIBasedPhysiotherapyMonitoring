import type { DataBackend, NewRep, NewSession, Profile, QueueItem, RepRecord, Role, SessionRecord, Verdict } from './types'

/**
 * Browser-only stand-in for Supabase, used when no Supabase keys are
 * configured. Everything lives in localStorage on this device.
 */
interface DemoDb {
  users: (Profile & { password: string })[]
  sessions: SessionRecord[]
  reps: RepRecord[]
}

const KEY = 'physio-demo-db'
const CURRENT = 'physio-demo-user'

const uid = () => crypto.randomUUID()

const SEED: DemoDb = {
  users: [
    { id: 'demo-patient', email: 'patient@demo.local', full_name: 'Priya Patient', role: 'patient', password: 'password123' },
    { id: 'demo-physio', email: 'physio@demo.local', full_name: 'Dr. Rahul Physio', role: 'physio', password: 'password123' },
  ],
  sessions: [],
  reps: [],
}

export class DemoBackend implements DataBackend {
  readonly mode = 'demo' as const
  private listeners = new Set<() => void>()

  private load(): DemoDb {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DemoDb) : structuredClone(SEED)
  }

  private save(db: DemoDb) {
    localStorage.setItem(KEY, JSON.stringify(db))
  }

  private requireUser(): Profile {
    const id = localStorage.getItem(CURRENT)
    const user = this.load().users.find((u) => u.id === id)
    if (!user) throw new Error('Not signed in')
    return strip(user)
  }

  private emit() {
    this.listeners.forEach((cb) => cb())
  }

  async getCurrentProfile() {
    try {
      return this.requireUser()
    } catch {
      return null
    }
  }

  onAuthChange(cb: () => void) {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  async signIn(email: string, password: string) {
    const user = this.load().users.find((u) => u.email === email.trim().toLowerCase() && u.password === password)
    if (!user) throw new Error('Invalid email or password')
    localStorage.setItem(CURRENT, user.id)
    this.emit()
  }

  async signUp(email: string, password: string, fullName: string, role: Role) {
    const db = this.load()
    const normalized = email.trim().toLowerCase()
    if (db.users.some((u) => u.email === normalized)) throw new Error('An account with this email already exists')
    const user = { id: uid(), email: normalized, full_name: fullName, role, password }
    db.users.push(user)
    this.save(db)
    localStorage.setItem(CURRENT, user.id)
    this.emit()
    return { needsConfirmation: false }
  }

  async signOut() {
    localStorage.removeItem(CURRENT)
    this.emit()
  }

  async saveSession(session: NewSession, reps: NewRep[]) {
    const user = this.requireUser()
    const db = this.load()
    const record: SessionRecord = { ...session, id: uid(), patient_id: user.id }
    db.sessions.push(record)
    const now = new Date().toISOString()
    for (const r of reps) {
      db.reps.push({
        ...r,
        frames: r.needs_review ? r.frames : null,
        id: uid(),
        session_id: record.id,
        patient_id: user.id,
        review_status: r.needs_review ? 'pending' : 'not_required',
        assigned_physio_id: null,
        created_at: now,
        review: null,
      })
    }
    this.save(db)
    return record
  }

  async listMySessions() {
    const user = this.requireUser()
    return this.load()
      .sessions.filter((s) => s.patient_id === user.id)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
  }

  async getSession(id: string) {
    const user = this.requireUser()
    const db = this.load()
    const session = db.sessions.find((s) => s.id === id)
    if (!session || (session.patient_id !== user.id && user.role !== 'physio')) throw new Error('Session not found')
    const reps = db.reps.filter((r) => r.session_id === id).sort((a, b) => a.rep_index - b.rep_index)
    return { session, reps }
  }

  async listReviewQueue(status: 'pending' | 'reviewed') {
    this.requirePhysio()
    const db = this.load()
    return db.reps
      .filter((r) => r.needs_review && r.review_status === status)
      .sort((a, b) => (status === 'pending' ? 1 : -1) * a.created_at.localeCompare(b.created_at))
      .map((r) => this.queueItem(db, r))
  }

  async getQueueItem(repId: string) {
    this.requirePhysio()
    const db = this.load()
    const rep = db.reps.find((r) => r.id === repId && r.needs_review)
    if (!rep) throw new Error('Rep not found')
    return this.queueItem(db, rep)
  }

  async submitReview(repId: string, verdict: Verdict, comment: string) {
    const physio = this.requirePhysio()
    const db = this.load()
    const rep = db.reps.find((r) => r.id === repId && r.needs_review)
    if (!rep) throw new Error('Rep not found')
    if (rep.review) throw new Error('This rep has already been reviewed')
    rep.review = { id: uid(), rep_id: repId, physio_id: physio.id, verdict, comment, created_at: new Date().toISOString() }
    rep.review_status = 'reviewed'
    this.save(db)
  }

  private requirePhysio() {
    const user = this.requireUser()
    if (user.role !== 'physio') throw new Error('Only physiotherapists can review reps')
    return user
  }

  private queueItem(db: DemoDb, rep: RepRecord): QueueItem {
    const session = db.sessions.find((s) => s.id === rep.session_id)!
    const patient = db.users.find((u) => u.id === rep.patient_id)!
    return { rep, session, patient: strip(patient) }
  }
}

function strip(user: Profile & { password?: string }): Profile {
  const { password: _pw, ...profile } = user
  void _pw
  return profile
}
