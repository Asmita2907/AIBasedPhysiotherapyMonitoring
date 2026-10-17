import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { backend, type RepRecord, type SessionRecord } from '../data'
import { formatDate, pct } from './format'

function ReviewCell({ rep }: { rep: RepRecord }) {
  if (rep.review_status === 'not_required') return <span className="muted">Not needed</span>
  if (!rep.review) return <span className="badge pending">Waiting for physiotherapist</span>
  return (
    <div>
      <span className={`badge ${rep.review.verdict === 'correct' ? 'ok' : 'bad'}`}>
        Physio: {rep.review.verdict === 'correct' ? 'Correct' : 'Incorrect'}
      </span>
      {rep.review.comment && <p className="small comment">"{rep.review.comment}"</p>}
    </div>
  )
}

export default function SessionPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const [data, setData] = useState<{ session: SessionRecord; reps: RepRecord[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (id) backend.getSession(id).then(setData).catch((e) => setError(e.message))
  }, [id])

  if (error) return <p className="page error">{error}</p>
  if (!data) return <p className="page muted">Loading...</p>
  const { session, reps } = data

  return (
    <div className="page">
      <h1>{params.get('new') ? 'Set complete!' : 'Session summary'}</h1>
      <p className="muted">Bicep curl, {session.side} arm - {formatDate(session.started_at)}</p>
      <div className="stats">
        <div className="stat"><span>{session.total_reps}</span>Total reps</div>
        <div className="stat ok"><span>{session.correct_reps}</span>Correct reps</div>
        <div className="stat warn"><span>{session.flagged_reps}</span>Sent to physiotherapist</div>
        <div className="stat"><span>{session.avg_confidence === null ? '-' : pct(session.avg_confidence)}</span>Avg. confidence</div>
      </div>

      <section className="card">
        <h2>Tips for next time</h2>
        <ul>{session.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>

      <h2>Reps</h2>
      <table className="table">
        <thead>
          <tr><th>#</th><th>App result</th><th>Feedback</th><th>Confidence</th><th>Physiotherapist review</th></tr>
        </thead>
        <tbody>
          {reps.map((r) => (
            <tr key={r.id}>
              <td>{r.rep_index}</td>
              <td><span className={`badge ${r.is_correct ? 'ok' : 'bad'}`}>{r.is_correct ? 'Correct' : 'Needs work'}</span></td>
              <td className="small">{r.feedback.map((f) => f.message).join(' ')}</td>
              <td>{pct(r.confidence)}</td>
              <td><ReviewCell rep={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="actions">
        <Link to="/exercise/bicep-curl" className="button primary">Do another set</Link>
        <Link to="/home" className="button">Back to history</Link>
      </p>
    </div>
  )
}
