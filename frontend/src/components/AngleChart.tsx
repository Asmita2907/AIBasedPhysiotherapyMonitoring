import type { RepFrame } from '../exercise/types'

interface Props {
  frames: RepFrame[]
  cursorMs?: number
  thresholds?: { value: number; label: string }[]
}

const W = 520
const H = 220
const PAD = { left: 40, right: 12, top: 12, bottom: 28 }

export default function AngleChart({ frames, cursorMs, thresholds = [] }: Props) {
  const duration = Math.max(1, frames[frames.length - 1]?.t ?? 1)
  const x = (t: number) => PAD.left + (t / duration) * (W - PAD.left - PAD.right)
  const y = (deg: number) => PAD.top + (1 - deg / 180) * (H - PAD.top - PAD.bottom)

  const path = (key: 'elbowAngle' | 'shoulderAngle') => {
    let d = ''
    let pen = false
    for (const f of frames) {
      const v = f[key]
      if (v === null) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    }
    return d
  }

  return (
    <svg className="angle-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Joint angles over the rep">
      {[0, 45, 90, 135, 180].map((deg) => (
        <g key={deg}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(deg)} y2={y(deg)} className="grid" />
          <text x={PAD.left - 6} y={y(deg) + 4} textAnchor="end" className="tick">{deg}°</text>
        </g>
      ))}
      {thresholds.map((th) => (
        <g key={th.label}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(th.value)} y2={y(th.value)} className="threshold" />
          <text x={W - PAD.right - 4} y={y(th.value) - 4} textAnchor="end" className="threshold-label">{th.label}</text>
        </g>
      ))}
      <path d={path('shoulderAngle')} className="line shoulder" />
      <path d={path('elbowAngle')} className="line elbow" />
      {cursorMs !== undefined && <line x1={x(cursorMs)} x2={x(cursorMs)} y1={PAD.top} y2={H - PAD.bottom} className="cursor" />}
      <text x={(W + PAD.left) / 2} y={H - 6} textAnchor="middle" className="tick">time ({(duration / 1000).toFixed(1)} s)</text>
    </svg>
  )
}
