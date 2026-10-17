import { POSE, UPPER_BODY_CONNECTIONS } from '../exercise/geometry'
import type { Landmark, Side } from '../exercise/types'

interface DrawOptions {
  side?: Side
  minVisibility?: number
}

/** Draws the skeleton onto a canvas whose size matches the source frame. */
export function drawPose(ctx: CanvasRenderingContext2D, landmarks: Landmark[], { side, minVisibility = 0.3 }: DrawOptions = {}) {
  const { width, height } = ctx.canvas
  const arm = side ? POSE[side] : null
  const armIdx = arm ? new Set<number>([arm.shoulder, arm.elbow, arm.wrist]) : new Set<number>()
  const visible = (i: number) => (landmarks[i]?.visibility ?? 0) >= minVisibility

  ctx.lineCap = 'round'
  for (const [a, b] of UPPER_BODY_CONNECTIONS) {
    if (!visible(a) || !visible(b)) continue
    const highlighted = armIdx.has(a) && armIdx.has(b)
    ctx.strokeStyle = highlighted ? '#f59e0b' : 'rgba(56, 189, 248, 0.9)'
    ctx.lineWidth = highlighted ? 6 : 3
    ctx.beginPath()
    ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height)
    ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height)
    ctx.stroke()
  }
  for (let i = 0; i < Math.min(landmarks.length, 29); i++) {
    if (!visible(i) || (i > 0 && i < 11)) continue
    ctx.fillStyle = armIdx.has(i) ? '#f59e0b' : '#e0f2fe'
    ctx.beginPath()
    ctx.arc(landmarks[i].x * width, landmarks[i].y * height, armIdx.has(i) ? 6 : 4, 0, Math.PI * 2)
    ctx.fill()
  }
}
