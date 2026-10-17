import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { backend, type SessionRecord } from '../data'
import { formatDate, pct } from './format'

export default function PatientHome() {
  const { profile } = useAuth()
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    backend.listMySessions().then(setSessions).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="page">
      <h1>Hello{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
      <section className="card exercise-card">
        <div>
          <h2>Bicep curl</h2>
          <p className="muted">Stand side-on or facing the camera with one arm in view. We count your reps and check your form after every rep.</p>
        </div>
        <Link to="/exercise/bicep-curl" className="button primary">Start exercise</Link>
      </section>

      <h2>History</h2>
      {error && <p className="error">{error}</p>}
      {!sessions && !error && <p className="muted">Loading...</p>}
      {sessions?.length === 0 && <p className="muted">No sessions yet. Your completed sets will show up here.</p>}
      {!!sessions?.length && (
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Exercise</th><th>Reps</th><th>Correct</th><th>Sent for review</th><th /></tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{formatDate(s.started_at)}</td>
                <td>Bicep curl ({s.side} arm)</td>
                <td>{s.total_reps}</td>
                <td>{s.correct_reps} ({pct(s.total_reps ? s.correct_reps / s.total_reps : 0)})</td>
                <td>{s.flagged_reps}</td>
                <td><Link to={`/sessions/${s.id}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
