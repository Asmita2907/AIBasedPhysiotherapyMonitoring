import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { drawPose } from '../components/drawPose'
import { BicepCurlAnalyzer } from '../exercise/bicepCurl'
import { armVisibility, POSE } from '../exercise/geometry'
import { summarizeSet } from '../exercise/summary'
import type { Landmark, RepFrame, RepResult, Side } from '../exercise/types'
import { backend, type NewRep } from '../data'
import { getPoseLandmarker } from '../pose/poseLandmarker'
import { pct } from './format'

type Phase = 'setup' | 'active' | 'saving'
type Source = 'camera' | 'file'

interface SetupChecks {
  person: boolean
  armVisible: boolean
  armInFrame: boolean
  hipVisible: boolean
}

const NO_CHECKS: SetupChecks = { person: false, armVisible: false, armInFrame: false, hipVisible: false }
const THRESHOLD_KEY = 'physio-confidence-threshold'
const REPLAY_FRAME_MS = 66

function loadThreshold() {
  const v = Number(localStorage.getItem(THRESHOLD_KEY))
  return v > 0 && v < 1 ? v : 0.6
}

function computeChecks(landmarks: Landmark[] | null, side: Side): SetupChecks {
  if (!landmarks) return NO_CHECKS
  const idx = POSE[side]
  const inFrame = [idx.shoulder, idx.elbow, idx.wrist].every((i) => {
    const l = landmarks[i]
    return l.x > 0.02 && l.x < 0.98 && l.y > 0.02 && l.y < 0.98
  })
  return {
    person: true,
    armVisible: armVisibility(landmarks, side) >= 0.6,
    armInFrame: inFrame,
    hipVisible: (landmarks[idx.hip]?.visibility ?? 0) >= 0.5,
  }
}

/** Keeps ~15 frames per second for the physiotherapist's replay. */
function downsample(frames: RepFrame[]): RepFrame[] {
  const out: RepFrame[] = []
  let last = -Infinity
  frames.forEach((f, i) => {
    if (f.t - last >= REPLAY_FRAME_MS || i === frames.length - 1) {
      out.push(f)
      last = f.t
    }
  })
  return out
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}

const CHECK_LABELS: [keyof SetupChecks, string, boolean][] = [
  ['person', 'You are visible to the camera', true],
  ['armVisible', 'Shoulder, elbow and wrist are clearly visible', true],
  ['armInFrame', 'Your whole arm stays inside the frame', true],
  ['hipVisible', 'Your hip is visible (lets us check elbow swing)', false],
]

export default function ExercisePage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [phase, setPhase] = useState<Phase>('setup')
  const [source, setSource] = useState<Source>('camera')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [videoError, setVideoError] = useState('')
  const [sideChoice, setSideChoice] = useState<'auto' | Side>('auto')
  const [autoSide, setAutoSide] = useState<Side>('left')
  const [checks, setChecks] = useState<SetupChecks>(NO_CHECKS)
  const [readySince, setReadySince] = useState<number | null>(null)
  const [now, setNow] = useState(() => performance.now())
  const [threshold, setThreshold] = useState(loadThreshold)
  const [voice, setVoice] = useState(false)
  const [reps, setReps] = useState<RepResult[]>([])
  const [liveAngle, setLiveAngle] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [saveError, setSaveError] = useState('')

  const side: Side = sideChoice === 'auto' ? autoSide : sideChoice
  const phaseRef = useRef(phase)
  const sideRef = useRef(side)
  const voiceRef = useRef(voice)
  const analyzerRef = useRef<BicepCurlAnalyzer | null>(null)
  const repsRef = useRef<RepResult[]>([])
  const startedAtRef = useRef<Date>(new Date())
  const endSetRef = useRef<() => void>(() => {})
  phaseRef.current = phase
  sideRef.current = side
  voiceRef.current = voice

  useEffect(() => {
    localStorage.setItem(THRESHOLD_KEY, String(threshold))
  }, [threshold])

  useEffect(() => {
    let cancelled = false
    getPoseLandmarker()
      .then(() => !cancelled && setModelStatus('ready'))
      .catch((err) => {
        console.error(err)
        if (!cancelled) setModelStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Video source: live camera or an uploaded clip.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setVideoError('')
    if (source === 'file') {
      if (!fileUrl) return
      video.srcObject = null
      video.src = fileUrl
      video.loop = true
      video.muted = true
      video.play().catch(() => {})
      return
    }
    let stream: MediaStream | null = null
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setVideoError('Camera access needs a secure (https) connection and a supported browser.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        video.removeAttribute('src')
        video.srcObject = s
        video.play().catch(() => {})
      })
      .catch((err) => setVideoError(`Could not open the camera: ${err.message}. You can use a video file instead.`))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [source, fileUrl])

  // Detection loop.
  useEffect(() => {
    if (modelStatus !== 'ready') return
    let raf = 0
    let lastVideoTime = -1
    let lastUiUpdate = 0
    let stopped = false

    const loop = async () => {
      const landmarker = await getPoseLandmarker()
      const tick = () => {
        if (stopped) return
        raf = requestAnimationFrame(tick)
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas || video.readyState < 2 || video.paused || video.currentTime === lastVideoTime) return
        lastVideoTime = video.currentTime
        const t = performance.now()
        const result = landmarker.detectForVideo(video, t)
        const landmarks = (result.landmarks[0] as Landmark[] | undefined) ?? null

        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (landmarks) drawPose(ctx, landmarks, { side: sideRef.current })

        if (phaseRef.current === 'setup') {
          if (t - lastUiUpdate > 150) {
            lastUiUpdate = t
            if (landmarks) {
              const l = armVisibility(landmarks, 'left')
              const r = armVisibility(landmarks, 'right')
              if (Math.abs(l - r) > 0.1) setAutoSide(l > r ? 'left' : 'right')
            }
            const next = computeChecks(landmarks, sideRef.current)
            setChecks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
            setNow(t)
          }
          return
        }

        const analyzer = analyzerRef.current
        if (phaseRef.current !== 'active' || !analyzer) return
        const ts = source === 'file' ? video.currentTime * 1000 : t
        const update = analyzer.update(landmarks, ts)
        if (update.rep) {
          const rep = update.rep
          repsRef.current = [...repsRef.current, rep]
          setReps(repsRef.current)
          setNotice('')
          if (voiceRef.current) speak(rep.feedback[0]?.message ?? '')
        } else if (update.trackingLost) {
          setNotice('Lost sight of your arm - that rep was not counted. Move back into view.')
        }
        if (t - lastUiUpdate > 100) {
          lastUiUpdate = t
          setLiveAngle(update.elbowAngle)
        }
      }
      tick()
    }
    loop()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [modelStatus, source])

  const ready = checks.person && checks.armVisible && checks.armInFrame
  useEffect(() => {
    setReadySince((prev) => (ready ? (prev ?? performance.now()) : null))
  }, [ready])
  const stableReady = readySince !== null && now - readySince >= 1000

  const start = () => {
    const video = videoRef.current!
    analyzerRef.current = new BicepCurlAnalyzer({
      side,
      aspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3,
      confidenceThreshold: threshold,
    })
    repsRef.current = []
    setReps([])
    setNotice('')
    setSaveError('')
    startedAtRef.current = new Date()
    if (source === 'file') {
      video.loop = false
      video.currentTime = 0
      video.play().catch(() => {})
    }
    setPhase('active')
  }

  const save = useCallback(async (allReps: RepResult[]) => {
    setPhase('saving')
    setSaveError('')
    const summary = summarizeSet(allReps)
    const newReps: NewRep[] = allReps.map((r) => ({
      rep_index: r.index,
      is_correct: r.isCorrect,
      confidence: r.confidence,
      needs_review: r.needsReview,
      feedback: r.feedback,
      metrics: r.metrics,
      frames: r.needsReview ? downsample(r.frames) : null,
    }))
    try {
      const session = await backend.saveSession(
        {
          exercise: 'bicep_curl',
          side: allReps[0].side,
          confidence_threshold: threshold,
          started_at: startedAtRef.current.toISOString(),
          ended_at: new Date().toISOString(),
          total_reps: summary.totalReps,
          correct_reps: summary.correctReps,
          flagged_reps: summary.flaggedReps,
          avg_confidence: summary.avgConfidence,
          tips: summary.tips,
        },
        newReps,
      )
      navigate(`/sessions/${session.id}?new=1`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [navigate, threshold])

  const endSet = () => {
    const video = videoRef.current
    const analyzer = analyzerRef.current
    const ts = source === 'file' && video ? video.currentTime * 1000 : performance.now()
    const last = analyzer?.flush(ts)
    if (last) repsRef.current = [...repsRef.current, last]
    analyzerRef.current = null
    setReps(repsRef.current)
    if (source === 'file' && video) video.pause()
    if (!repsRef.current.length) {
      setPhase('setup')
      setNotice('No reps were detected, so nothing was saved.')
      if (source === 'file' && video) {
        video.loop = true
        video.play().catch(() => {})
      }
      return
    }
    save(repsRef.current)
  }
  endSetRef.current = endSet

  const lastRep = reps[reps.length - 1]
  const correct = reps.filter((r) => r.isCorrect).length
  const flagged = reps.filter((r) => r.needsReview).length

  return (
    <div className="page exercise">
      <h1>Bicep curl</h1>
      <div className="exercise-grid">
        <div className="stage">
          <video
            ref={videoRef}
            playsInline
            muted
            className={source === 'camera' ? 'mirror' : ''}
            onEnded={() => phaseRef.current === 'active' && endSetRef.current()}
          />
          <canvas ref={canvasRef} className={source === 'camera' ? 'mirror' : ''} />
          {modelStatus === 'loading' && <div className="stage-message">Loading pose model...</div>}
          {modelStatus === 'error' && <div className="stage-message error">Could not load the pose model. Check your internet connection and reload.</div>}
          {source === 'file' && !fileUrl && <div className="stage-message">Choose a video file to analyse.</div>}
          {phase !== 'setup' && (
            <div className="hud">
              <div className="hud-count"><span>{reps.length}</span>reps</div>
              <div className="hud-angle">Elbow {liveAngle === null ? '--' : `${Math.round(liveAngle)}°`}</div>
            </div>
          )}
          {phase !== 'setup' && lastRep && (
            <div className={`feedback-banner ${lastRep.isCorrect ? 'ok' : 'bad'}`} key={lastRep.index} role="status">
              <strong>Rep {lastRep.index}:</strong> {lastRep.feedback.map((f) => f.message).join(' ')}
              {lastRep.needsReview && <span className="small"> (sent to your physiotherapist to double-check)</span>}
            </div>
          )}
        </div>

        <aside className="card side-panel">
          {phase === 'setup' ? (
            <>
              <h2>Camera setup</h2>
              <ol className="guide small">
                <li>Place the device at chest height, about 2 metres away.</li>
                <li>Stand side-on (or facing the camera) so your working arm is not hidden by your body.</li>
                <li>Use good, even lighting and a clear background.</li>
                <li>Hold a light weight with your arm straight down by your side.</li>
              </ol>
              <ul className="checklist">
                {CHECK_LABELS.map(([key, label, required]) => (
                  <li key={key} className={checks[key] ? 'pass' : required ? 'fail' : 'warn'}>
                    <span className="mark">{checks[key] ? '✓' : required ? '✗' : '!'}</span> {label}
                  </li>
                ))}
              </ul>
              <div className="form">
                <label>
                  Arm to track
                  <select value={sideChoice} onChange={(e) => setSideChoice(e.target.value as 'auto' | Side)}>
                    <option value="auto">Auto ({autoSide} arm detected)</option>
                    <option value="left">Left arm</option>
                    <option value="right">Right arm</option>
                  </select>
                </label>
                <label>
                  Input
                  <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
                    <option value="camera">Camera</option>
                    <option value="file">Video file</option>
                  </select>
                </label>
                {source === 'file' && (
                  <input
                    type="file"
                    accept="video/*"
                    aria-label="Video file"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) setFileUrl(URL.createObjectURL(f))
                    }}
                  />
                )}
                <label>
                  Review threshold: {pct(threshold)}
                  <input type="range" min={0.3} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                  <span className="muted small">Reps with lower confidence are sent to a physiotherapist.</span>
                </label>
                <label className="inline">
                  <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Speak feedback aloud
                </label>
              </div>
              {videoError && <p className="error small">{videoError}</p>}
              {notice && <p className="info small">{notice}</p>}
              <button type="button" className="primary big" disabled={modelStatus !== 'ready' || !stableReady} onClick={start}>
                {stableReady ? 'Start set' : 'Waiting for a good camera view...'}
              </button>
              <button type="button" className="link small" disabled={modelStatus !== 'ready'} onClick={start}>Start anyway</button>
            </>
          ) : (
            <>
              <h2>Set in progress</h2>
              <p className="small muted">Tracking your {side} arm. Curl all the way up, then straighten fully.</p>
              <div className="mini-stats">
                <div><span>{correct}</span>correct</div>
                <div><span>{reps.length - correct}</span>need work</div>
                <div><span>{flagged}</span>for review</div>
              </div>
              {notice && <p className="info small">{notice}</p>}
              <ol className="rep-list">
                {[...reps].reverse().map((r) => (
                  <li key={r.index} className={r.isCorrect ? 'ok' : 'bad'}>
                    <strong>#{r.index}</strong> {r.isCorrect ? 'Correct' : 'Needs work'}
                    <span className="muted small"> {pct(r.confidence)}</span>
                    {r.needsReview && <span className="badge pending">review</span>}
                  </li>
                ))}
              </ol>
              {saveError && (
                <>
                  <p className="error small">Could not save: {saveError}</p>
                  <button type="button" onClick={() => save(repsRef.current)}>Retry saving</button>
                </>
              )}
              <button type="button" className="primary big" disabled={phase === 'saving'} onClick={endSet}>
                {phase === 'saving' ? 'Saving...' : 'End set'}
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
