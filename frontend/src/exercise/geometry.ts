import type { CompactLandmark, Landmark, Side } from './types'

/** MediaPipe Pose landmark indices used by the app. */
export const POSE = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const

export const UPPER_BODY_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22], [0, 11], [0, 12],
]

/**
 * Angle at vertex `b` formed by points a-b-c, in degrees (0-180).
 * `aspect` is the frame width/height, used to undo the stretching of
 * normalised coordinates.
 */
export function jointAngle(a: Landmark, b: Landmark, c: Landmark, aspect = 1): number {
  const v1x = (a.x - b.x) * aspect
  const v1y = a.y - b.y
  const v2x = (c.x - b.x) * aspect
  const v2y = c.y - b.y
  const dot = v1x * v2x + v1y * v2y
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (mag === 0) return 0
  const cos = Math.min(1, Math.max(-1, dot / mag))
  return (Math.acos(cos) * 180) / Math.PI
}

export function armVisibility(landmarks: Landmark[], side: Side): number {
  const idx = POSE[side]
  return Math.min(
    landmarks[idx.shoulder]?.visibility ?? 0,
    landmarks[idx.elbow]?.visibility ?? 0,
    landmarks[idx.wrist]?.visibility ?? 0,
  )
}

/** Picks the arm the camera can see best. */
export function bestSide(landmarks: Landmark[]): Side {
  return armVisibility(landmarks, 'left') >= armVisibility(landmarks, 'right') ? 'left' : 'right'
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

export function compactLandmarks(landmarks: Landmark[]): CompactLandmark[] {
  return landmarks.map((l) => [round3(l.x), round3(l.y), round3(l.z), round3(l.visibility ?? 0)])
}

export function expandLandmarks(compact: CompactLandmark[]): Landmark[] {
  return compact.map(([x, y, z, visibility]) => ({ x, y, z, visibility }))
}
