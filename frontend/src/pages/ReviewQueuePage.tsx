import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { backend, type QueueItem } from '../data'
import { formatDate, pct } from './format'

export default function ReviewQueuePage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending')
  const [mineOnly, setMineOnly] = useState(false)
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setItems(null)
    backend.listReviewQueue(tab).then(setItems).catch((e) => setError(e.message))
  }, [tab])

  const shown = items?.filter((i) => !mineOnly || i.rep.assigned_physio_id === profile?.id)

  return (
    <div className="page">
      <h1>Review queue</h1>
      <p className="muted">Reps the app was not sure about. Patients already got live feedback; your verdict appears in their history.</p>
      <div className="toolbar">
        <div className="tabs">
          <button type="button" className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>To review</button>
          <button type="button" className={tab === 'reviewed' ? 'active' : ''} onClick={() => setTab('reviewed')}>Reviewed</button>
        </div>
        <label className="inline">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Assigned to me only
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="muted">Loading...</p>}
      {shown?.length === 0 && <p className="muted">{tab === 'pending' ? 'Nothing to review right now.' : 'No reviewed reps yet.'}</p>}
      {!!shown?.length && (
        <table className="table">
          <thead>
            <tr><th>Patient</th><th>Exercise</th><th>Rep</th><th>App result</th><th>Confidence</th><th>Flagged</th><th>Assigned</th><th /></tr>
          </thead>
          <tbody>
            {shown.map(({ rep, session, patient }) => (
              <tr key={rep.id}>
                <td>{patient.full_name || patient.email}</td>
                <td>Bicep curl ({session.side})</td>
                <td>#{rep.rep_index}</td>
                <td><span className={`badge ${rep.is_correct ? 'ok' : 'bad'}`}>{rep.is_correct ? 'Correct' : 'Needs work'}</span></td>
                <td>{pct(rep.confidence)}</td>
                <td>{formatDate(rep.created_at)}</td>
                <td>{rep.assigned_physio_id ? (rep.assigned_physio_id === profile?.id ? 'Me' : 'Colleague') : <span className="muted">Unassigned</span>}</td>
                <td>
                  <Link to={`/review/${rep.id}`}>{tab === 'pending' ? 'Review' : 'View'}</Link>
                  {rep.review && <span className={`badge ${rep.review.verdict === 'correct' ? 'ok' : 'bad'}`}>{rep.review.verdict}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
