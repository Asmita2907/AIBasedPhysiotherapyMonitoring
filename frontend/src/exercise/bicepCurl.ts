import { armVisibility, compactLandmarks, jointAngle, POSE } from './geometry'
import type { Feedback, Landmark, RepFrame, RepResult, Side } from './types'

export interface BicepCurlRules {
  /** Elbow angle (deg) at or above which the arm counts as fully straight. */
  extendedAngle: number
  /** Elbow angle (deg) at or below which the arm counts as fully curled. */
  curledAngle: number
  /** A rep starts when the elbow angle drops below this. */
  startAngle: number
  /** A movement only counts as a rep if the elbow bends at least this far. */
  minCountAngle: number
  /** Max allowed upper-arm swing (hip-shoulder-elbow angle, deg). */
  maxShoulderSwing: number
  /** Reps faster than this get a tempo tip. */
  minRepDurationMs: number
  /** Minimum landmark visibility for a frame to be used. */
  minVisibility: number
  /** Rep is finished once the arm stops straightening for this long. */
  settleMs: number
  /** Drop tracking of the current rep after losing the arm for this long. */
  lostTrackingMs: number
}

export const DEFAULT_RULES: BicepCurlRules = {
  extendedAngle: 150,
  curledAngle: 60,
  startAngle: 130,
  minCountAngle: 110,
  maxShoulderSwing: 35,
  minRepDurationMs: 1000,
  minVisibility: 0.5,
  settleMs: 400,
  lostTrackingMs: 1500,
}

/** Degrees from a threshold at which a judgement counts as clear-cut. */
const MARGIN_BAND = 15
/** Mean frame-to-frame second difference (deg) treated as fully noisy. */
const MAX_JITTER = 8

export type AnalyzerState = 'ready' | 'curling' | 'returning'

export interface FrameUpdate {
  elbowAngle: number | null
  shoulderAngle: number | null
  state: AnalyzerState
  tracked: boolean
  rep?: RepResult
  trackingLost?: boolean
}

export interface AnalyzerOptions {
  side: Side
  aspect?: number
  rules?: Partial<BicepCurlRules>
  confidenceThreshold?: number
}

interface ActiveRep {
  startedAt: number
  frames: RepFrame[]
  tracked: number
  total: number
  visibilitySum: number
  minElbow: number
  maxElbowAfter: number
  maxElbowAfterAt: number
  maxShoulder: number | null
  elbowSeries: number[]
  lastTrackedAt: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export class BicepCurlAnalyzer {
  readonly side: Side
  readonly rules: BicepCurlRules
  confidenceThreshold: number
  private aspect: number
  private state: AnalyzerState = 'ready'
  private rep: ActiveRep | null = null
  private repCount = 0

  constructor(options: AnalyzerOptions) {
    this.side = options.side
    this.aspect = options.aspect ?? 1
    this.rules = { ...DEFAULT_RULES, ...options.rules }
    this.confidenceThreshold = options.confidenceThreshold ?? 0.6
  }

  get reps(): number {
    return this.repCount
  }

  setAspect(aspect: number) {
    this.aspect = aspect
  }

  /** Feed one pose result. `landmarks` is null when no person was detected. */
  update(landmarks: Landmark[] | null, timestamp: number): FrameUpdate {
    const idx = POSE[this.side]
    const visibility = landmarks ? armVisibility(landmarks, this.side) : 0
    const tracked = !!landmarks && visibility >= this.rules.minVisibility

    let elbowAngle: number | null = null
    let shoulderAngle: number | null = null
    if (landmarks && tracked) {
      elbowAngle = jointAngle(landmarks[idx.shoulder], landmarks[idx.elbow], landmarks[idx.wrist], this.aspect)
      if ((landmarks[idx.hip]?.visibility ?? 0) >= this.rules.minVisibility) {
        shoulderAngle = jointAngle(landmarks[idx.hip], landmarks[idx.shoulder], landmarks[idx.elbow], this.aspect)
      }
    }

    const base = { elbowAngle, shoulderAngle, tracked }

    if (this.rep) {
      this.rep.total += 1
      this.rep.frames.push({
        t: Math.round(timestamp - this.rep.startedAt),
        elbowAngle: elbowAngle === null ? null : Math.round(elbowAngle * 10) / 10,
        shoulderAngle: shoulderAngle === null ? null : Math.round(shoulderAngle * 10) / 10,
        landmarks: landmarks ? compactLandmarks(landmarks) : null,
      })
    }

    if (elbowAngle === null) {
      if (this.rep && timestamp - this.rep.lastTrackedAt > this.rules.lostTrackingMs) {
        this.rep = null
        this.state = 'ready'
        return { ...base, state: this.state, trackingLost: true }
      }
      return { ...base, state: this.state }
    }

    const r = this.rules

    if (this.state === 'ready') {
      if (elbowAngle < r.startAngle) {
        this.startRep(timestamp, landmarks!, elbowAngle, shoulderAngle, visibility)
        this.state = 'curling'
      }
      return { ...base, state: this.state }
    }

    const rep = this.rep!
    this.trackFrame(rep, timestamp, elbowAngle, shoulderAngle, visibility)

    if (this.state === 'curling') {
      if (elbowAngle >= r.startAngle) {
        this.state = 'returning'
        rep.maxElbowAfter = elbowAngle
        rep.maxElbowAfterAt = timestamp
      }
      return { ...base, state: this.state }
    }

    // returning: wait for the arm to finish straightening
    if (elbowAngle > rep.maxElbowAfter) {
      rep.maxElbowAfter = elbowAngle
      rep.maxElbowAfterAt = timestamp
    }
    const bendingAgain = elbowAngle < rep.maxElbowAfter - 10
    const settled = timestamp - rep.maxElbowAfterAt >= r.settleMs
    const restarted = elbowAngle < r.startAngle
    if (!bendingAgain && !settled && !restarted) {
      return { ...base, state: this.state }
    }

    const result = this.finishRep(timestamp)
    this.state = 'ready'
    if (restarted) {
      this.startRep(timestamp, landmarks!, elbowAngle, shoulderAngle, visibility)
      this.state = 'curling'
    }
    return { ...base, state: this.state, rep: result ?? undefined }
  }

  /** Ends the set. Returns a final rep if one was in its return phase. */
  flush(timestamp: number): RepResult | null {
    if (this.state !== 'returning' || !this.rep) {
      this.rep = null
      this.state = 'ready'
      return null
    }
    const result = this.finishRep(timestamp)
    this.state = 'ready'
    return result
  }

  private startRep(t: number, landmarks: Landmark[], elbow: number, shoulder: number | null, visibility: number) {
    this.rep = {
      startedAt: t,
      frames: [{ t: 0, elbowAngle: Math.round(elbow * 10) / 10, shoulderAngle: shoulder === null ? null : Math.round(shoulder * 10) / 10, landmarks: compactLandmarks(landmarks) }],
      tracked: 0,
      total: 1,
      visibilitySum: 0,
      minElbow: elbow,
      maxElbowAfter: 0,
      maxElbowAfterAt: t,
      maxShoulder: null,
      elbowSeries: [],
      lastTrackedAt: t,
    }
    this.trackFrame(this.rep, t, elbow, shoulder, visibility)
  }

  private trackFrame(rep: ActiveRep, t: number, elbow: number, shoulder: number | null, visibility: number) {
    rep.tracked += 1
    rep.visibilitySum += visibility
    rep.lastTrackedAt = t
    rep.minElbow = Math.min(rep.minElbow, elbow)
    rep.elbowSeries.push(elbow)
    if (shoulder !== null) rep.maxShoulder = Math.max(rep.maxShoulder ?? 0, shoulder)
  }

  private finishRep(t: number): RepResult | null {
    const rep = this.rep
    this.rep = null
    if (!rep) return null
    const r = this.rules
    if (rep.minElbow > r.minCountAngle) return null

    const durationMs = t - rep.startedAt
    const feedback: Feedback[] = []
    const margins: number[] = []

    const curled = rep.minElbow <= r.curledAngle
    margins.push(Math.abs(rep.minElbow - r.curledAngle))
    if (!curled) {
      feedback.push({ code: 'curl_higher', severity: 'error', message: 'Curl higher - bring your hand closer to your shoulder.' })
    }

    const extended = rep.maxElbowAfter >= r.extendedAngle
    margins.push(Math.abs(rep.maxElbowAfter - r.extendedAngle))
    if (!extended) {
      feedback.push({ code: 'straighten_arm', severity: 'error', message: 'Straighten your arm a little more at the bottom.' })
    }

    let steady = true
    if (rep.maxShoulder !== null) {
      steady = rep.maxShoulder <= r.maxShoulderSwing
      margins.push(Math.abs(rep.maxShoulder - r.maxShoulderSwing))
      if (!steady) {
        feedback.push({ code: 'elbow_swing', severity: 'error', message: 'Keep your elbow by your side - do not swing the upper arm.' })
      }
    }

    if (durationMs < r.minRepDurationMs) {
      feedback.push({ code: 'too_fast', severity: 'tip', message: 'Slow down - take about 2 seconds for each rep.' })
    }

    const isCorrect = curled && extended && steady
    if (isCorrect) {
      feedback.unshift({ code: 'good_rep', severity: 'success', message: 'Good rep!' })
    }

    const visibility = rep.tracked ? rep.visibilitySum / rep.tracked : 0
    const trackedFraction = rep.total ? rep.tracked / rep.total : 0
    const jitter = secondDifference(rep.elbowSeries)
    const confidence = repConfidence({ visibility, trackedFraction, jitter, margin: Math.min(...margins) })

    this.repCount += 1
    return {
      index: this.repCount,
      side: this.side,
      startedAt: rep.startedAt,
      endedAt: t,
      isCorrect,
      confidence,
      needsReview: confidence < this.confidenceThreshold,
      feedback,
      metrics: {
        minElbowAngle: round1(rep.minElbow),
        maxElbowAngle: round1(rep.maxElbowAfter),
        maxShoulderAngle: rep.maxShoulder === null ? null : round1(rep.maxShoulder),
        durationMs: Math.round(durationMs),
        visibility: round3(visibility),
        trackedFraction: round3(trackedFraction),
        jitter: round1(jitter),
        aspect: round3(this.aspect),
      },
      frames: rep.frames,
    }
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round3 = (n: number) => Math.round(n * 1000) / 1000

function secondDifference(series: number[]): number {
  if (series.length < 3) return 0
  let sum = 0
  for (let i = 2; i < series.length; i++) {
    sum += Math.abs(series[i] - 2 * series[i - 1] + series[i - 2])
  }
  return sum / (series.length - 2)
}

/**
 * Confidence in a rep judgement, 0-1. Combines how well the arm was seen
 * (landmark visibility, fraction of frames tracked, angle noise) with how
 * far the measured angles were from the rule thresholds: a rep that only
 * just passed or failed a rule is a close call and gets a lower score.
 */
export function repConfidence(input: { visibility: number; trackedFraction: number; jitter: number; margin: number }): number {
  const visibilityScore = clamp01((input.visibility - 0.5) / 0.4)
  const jitterScore = 1 - clamp01(input.jitter / MAX_JITTER)
  const quality = 0.6 * visibilityScore + 0.25 * clamp01(input.trackedFraction) + 0.15 * jitterScore
  const marginScore = clamp01(input.margin / MARGIN_BAND)
  return round3(quality * (0.5 + 0.5 * marginScore))
}
