import { useEffect, useRef, useState } from 'react'
import { expandLandmarks } from '../exercise/geometry'
import type { RepFrame, Side } from '../exercise/types'
import { drawPose } from './drawPose'

interface Props {
  frames: RepFrame[]
  side: Side
  aspect: number
  onTimeChange?: (ms: number) => void
}

export default function SkeletonReplay({ frames, side, aspect, onTimeChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(0.5)
  const frame = frames[index]

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !frame) return
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (frame.landmarks) {
      drawPose(ctx, expandLandmarks(frame.landmarks), { side })
    } else {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '16px sans-serif'
      ctx.fillText('No pose detected in this frame', 16, 28)
    }
    if (frame.elbowAngle !== null) {
      ctx.fillStyle = '#f59e0b'
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText(`Elbow ${Math.round(frame.elbowAngle)}°`, 16, canvas.height - 16)
    }
    onTimeChange?.(frame.t)
  }, [frame, side, onTimeChange])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const next = (index + 1) % frames.length
    const delay = next === 0 ? 800 : (frames[next].t - frames[index].t) / speed
    const timer = setTimeout(() => setIndex(next), delay)
    return () => clearTimeout(timer)
  }, [playing, index, frames, speed])

  const width = 480
  return (
    <div className="replay">
      <canvas ref={canvasRef} width={width} height={Math.round(width / (aspect || 4 / 3))} className="mirror" />
      <div className="replay-controls">
        <button type="button" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={index}
          aria-label="Replay position"
          onChange={(e) => {
            setPlaying(false)
            setIndex(Number(e.target.value))
          }}
        />
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed">
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
        </select>
      </div>
    </div>
  )
}
