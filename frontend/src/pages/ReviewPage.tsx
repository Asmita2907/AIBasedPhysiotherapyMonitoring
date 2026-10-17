import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AngleChart from '../components/AngleChart'
import SkeletonReplay from '../components/SkeletonReplay'
import { DEFAULT_RULES } from '../exercise/bicepCurl'
import { backend, type QueueItem, type Verdict } from '../data'
import { formatDate, pct } from './format'

export default function ReviewPage() {
  const { repId } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<QueueItem | null>(null)
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState(0)
  const [verdict, setVerdict] = useState<Verdict | ''>('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const onTime = useCallback((ms: number) => setCursor(ms), [])

  useEffect(() => {
    if (repId) backend.getQueueItem(repId).then(setItem).catch((e) => setError(e.message))
  }, [repId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!repId || !verdict) return
    setBusy(true)
    setError('')
    try {
      await backend.submitReview(repId, verdict, comment.trim())
      navigate('/queue')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  if (error && !item) return <p className="page error">{error}</p>
  if (!item) return <p className="page muted">Loading...</p>
  const { rep, session, patient } = item
  const frames = rep.frames ?? []
  const m = rep.metrics

  return (
    <div className="page">
      <p><Link to="/queue">&larr; Back to queue</Link></p>
      <h1>Rep #{rep.rep_index} - {patient.full_name || patient.email}</h1>
      <p className="muted">Bicep curl, {session.side} arm - {formatDate(rep.created_at)}</p>

      <div className="review-grid">
        <section className="card">
          <h2>Skeleton replay</h2>
          {frames.length ? (
            <SkeletonReplay frames={frames} side={session.side} aspect={m.aspect ?? 4 / 3} onTimeChange={onTime} />
          ) : (
            <p className="muted">No frames were stored for this rep.</p>
          )}
        </section>
        <section className="card">
          <h2>Joint angles</h2>
          <AngleChart
            frames={frames}
            cursorMs={cursor}
            thresholds={[
              { value: DEFAULT_RULES.extendedAngle, label: `straight ${DEFAULT_RULES.extendedAngle}°` },
              { value: DEFAULT_RULES.curledAngle, label: `curled ${DEFAULT_RULES.curledAngle}°` },
              { value: DEFAULT_RULES.maxShoulderSwing, label: `max swing ${DEFAULT_RULES.maxShoulderSwing}°` },
            ]}
          />
          <p className="legend small"><span className="swatch elbow" /> Elbow angle <span className="swatch shoulder" /> Upper-arm swing (hip-shoulder-elbow)</p>
          <dl className="metrics">
            <dt>Smallest elbow angle</dt><dd>{m.minElbowAngle}°</dd>
            <dt>Straightest elbow angle</dt><dd>{m.maxElbowAngle}°</dd>
            <dt>Max upper-arm swing</dt><dd>{m.maxShoulderAngle === null ? 'hip not visible' : `${m.maxShoulderAngle}°`}</dd>
            <dt>Duration</dt><dd>{(m.durationMs / 1000).toFixed(1)} s</dd>
            <dt>Landmark visibility</dt><dd>{pct(m.visibility)}</dd>
            <dt>Frames tracked</dt><dd>{pct(m.trackedFraction)}</dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <h2>App judgement: <span className={`badge ${rep.is_correct ? 'ok' : 'bad'}`}>{rep.is_correct ? 'Correct' : 'Needs work'}</span> <span className="muted small">confidence {pct(rep.confidence)}</span></h2>
        <ul>{rep.feedback.map((f) => <li key={f.code}>{f.message}</li>)}</ul>
      </section>

      <section className="card">
        <h2>Your verdict</h2>
        {rep.review ? (
          <div>
            <span className={`badge ${rep.review.verdict === 'correct' ? 'ok' : 'bad'}`}>{rep.review.verdict === 'correct' ? 'Correct' : 'Incorrect'}</span>
            {rep.review.comment && <p className="comment">"{rep.review.comment}"</p>}
            <p className="muted small">Reviewed {formatDate(rep.review.created_at)}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="form">
            <div className="verdict-buttons">
              <label className={`verdict ${verdict === 'correct' ? 'selected ok' : ''}`}>
                <input type="radio" name="verdict" value="correct" checked={verdict === 'correct'} onChange={() => setVerdict('correct')} />
                Correct
              </label>
              <label className={`verdict ${verdict === 'incorrect' ? 'selected bad' : ''}`}>
                <input type="radio" name="verdict" value="incorrect" checked={verdict === 'incorrect'} onChange={() => setVerdict('incorrect')} />
                Incorrect
              </label>
            </div>
            <label>
              Comment for the patient (optional)
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="e.g. Good control, try to keep your wrist straight." />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary" disabled={!verdict || busy}>{busy ? 'Saving...' : 'Submit verdict'}</button>
          </form>
        )}
      </section>
    </div>
  )
}
