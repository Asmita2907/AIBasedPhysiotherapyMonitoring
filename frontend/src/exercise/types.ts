export interface Landmark {
  x: number
  y: number
  z: number
  visibility: number
}

export type Side = 'left' | 'right'

export type FeedbackSeverity = 'error' | 'tip' | 'success'

export interface Feedback {
  code: string
  message: string
  severity: FeedbackSeverity
}

/** Compact landmark encoding: [x, y, z, visibility] rounded to 3 decimals. */
export type CompactLandmark = [number, number, number, number]

export interface RepFrame {
  /** Milliseconds since the rep started. */
  t: number
  elbowAngle: number | null
  shoulderAngle: number | null
  landmarks: CompactLandmark[] | null
}

export interface RepMetrics {
  minElbowAngle: number
  maxElbowAngle: number
  maxShoulderAngle: number | null
  durationMs: number
  visibility: number
  trackedFraction: number
  jitter: number
  /** Frame width / height, needed to replay the skeleton undistorted. */
  aspect: number
}

export interface RepResult {
  index: number
  side: Side
  startedAt: number
  endedAt: number
  isCorrect: boolean
  confidence: number
  needsReview: boolean
  feedback: Feedback[]
  metrics: RepMetrics
  frames: RepFrame[]
}
