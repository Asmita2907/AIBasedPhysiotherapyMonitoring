import { describe, expect, it } from 'vitest'
import { BicepCurlAnalyzer, repConfidence } from './bicepCurl'
import { jointAngle } from './geometry'
import { summarizeSet } from './summary'
import type { Landmark, RepResult } from './types'

const FPS = 30
const DT = 1000 / FPS

/** Builds a 33-point pose with the left arm at the given angles. */
function pose(elbowDeg: number, shoulderDeg = 10, visibility = 0.95): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }))
  const shoulder = { x: 0.5, y: 0.3, z: 0, visibility }
  const s = (shoulderDeg * Math.PI) / 180
  const elbow = { x: shoulder.x + 0.15 * Math.sin(s), y: shoulder.y + 0.15 * Math.cos(s), z: 0, visibility }
  const toShoulder = Math.atan2(shoulder.y - elbow.y, shoulder.x - elbow.x)
  const w = toShoulder + (elbowDeg * Math.PI) / 180
  const wrist = { x: elbow.x + 0.13 * Math.cos(w), y: elbow.y + 0.13 * Math.sin(w), z: 0, visibility }
  lm[11] = shoulder
  lm[13] = elbow
  lm[15] = wrist
  lm[23] = { x: 0.5, y: 0.6, z: 0, visibility }
  return lm
}

interface Segment {
  from: number
  to: number
  ms: number
  shoulder?: number
  visibility?: number
  missing?: boolean
}

function run(segments: Segment[], analyzer = new BicepCurlAnalyzer({ side: 'left' })) {
  const reps: RepResult[] = []
  let t = 0
  for (const seg of segments) {
    const n = Math.max(1, Math.round(seg.ms / DT))
    for (let i = 1; i <= n; i++) {
      const angle = seg.from + ((seg.to - seg.from) * i) / n
      const lm = seg.missing ? null : pose(angle, seg.shoulder ?? 10, seg.visibility ?? 0.95)
      const u = analyzer.update(lm, t)
      if (u.rep) reps.push(u.rep)
      t += DT
    }
  }
  const last = analyzer.flush(t)
  if (last) reps.push(last)
  return reps
}

const rep = (min = 40, max = 170, extra: Partial<Segment> = {}): Segment[] => [
  { from: max, to: min, ms: 1000, ...extra },
  { from: min, to: max, ms: 1000, ...extra },
  { from: max, to: max, ms: 600, ...extra },
]

describe('pose fixture', () => {
  it('produces the requested elbow angle', () => {
    const lm = pose(75)
    expect(jointAngle(lm[11], lm[13], lm[15])).toBeCloseTo(75, 3)
  })
})

describe('BicepCurlAnalyzer', () => {
  it('counts clean reps as correct with high confidence', () => {
    const reps = run([{ from: 170, to: 170, ms: 500 }, ...rep(), ...rep(), ...rep()])
    expect(reps).toHaveLength(3)
    for (const r of reps) {
      expect(r.isCorrect).toBe(true)
      expect(r.needsReview).toBe(false)
      expect(r.confidence).toBeGreaterThan(0.8)
      expect(r.feedback[0].code).toBe('good_rep')
    }
    expect(reps.map((r) => r.index)).toEqual([1, 2, 3])
  })

  it('flags a partial curl', () => {
    const [r] = run(rep(85))
    expect(r.isCorrect).toBe(false)
    expect(r.feedback.map((f) => f.code)).toContain('curl_higher')
    expect(r.metrics.minElbowAngle).toBeCloseTo(85, 0)
  })

  it('asks to straighten the arm when extension is incomplete', () => {
    const [r] = run(rep(40, 135))
    expect(r.isCorrect).toBe(false)
    expect(r.feedback.map((f) => f.code)).toEqual(['straighten_arm'])
  })

  it('detects upper-arm swing', () => {
    const [r] = run(rep(40, 170, { shoulder: 55 }))
    expect(r.isCorrect).toBe(false)
    expect(r.feedback.map((f) => f.code)).toContain('elbow_swing')
  })

  it('gives a tempo tip for fast reps without marking them incorrect', () => {
    const [r] = run([
      { from: 170, to: 40, ms: 300 },
      { from: 40, to: 170, ms: 300 },
      { from: 170, to: 170, ms: 600 },
    ])
    expect(r.isCorrect).toBe(true)
    expect(r.feedback.map((f) => f.code)).toContain('too_fast')
  })

  it('ignores small movements', () => {
    expect(run(rep(120))).toHaveLength(0)
  })

  it('finishes a rep as soon as the next one starts', () => {
    const reps = run([
      { from: 170, to: 40, ms: 1000 },
      { from: 40, to: 165, ms: 1000 },
      { from: 165, to: 40, ms: 1000 },
      { from: 40, to: 170, ms: 1000 },
      { from: 170, to: 170, ms: 600 },
    ])
    expect(reps).toHaveLength(2)
    expect(reps[0].metrics.maxElbowAngle).toBeCloseTo(165, 0)
  })

  it('sends low-visibility reps for review', () => {
    const [r] = run(rep(40, 170, { visibility: 0.6 }))
    expect(r.needsReview).toBe(true)
    expect(r.confidence).toBeLessThan(0.6)
  })

  it('sends close calls for review', () => {
    const [r] = run(rep(58))
    expect(r.isCorrect).toBe(true)
    expect(r.needsReview).toBe(true)
  })

  it('respects a custom confidence threshold', () => {
    const analyzer = new BicepCurlAnalyzer({ side: 'left', confidenceThreshold: 0.4 })
    const [r] = run(rep(58), analyzer)
    expect(r.needsReview).toBe(false)
  })

  it('drops a rep when the arm is lost for too long', () => {
    const reps = run([
      { from: 170, to: 60, ms: 800 },
      { from: 60, to: 60, ms: 2000, missing: true },
      ...rep(),
    ])
    expect(reps).toHaveLength(1)
    expect(reps[0].isCorrect).toBe(true)
  })

  it('records frames with landmarks for replay', () => {
    const [r] = run(rep())
    expect(r.frames.length).toBeGreaterThan(40)
    expect(r.frames[0].t).toBe(0)
    expect(r.frames[0].landmarks).toHaveLength(33)
  })
})

describe('repConfidence', () => {
  it('is highest for clear, well-tracked reps', () => {
    expect(repConfidence({ visibility: 1, trackedFraction: 1, jitter: 0, margin: 30 })).toBe(1)
    expect(repConfidence({ visibility: 1, trackedFraction: 1, jitter: 0, margin: 0 })).toBe(0.5)
    expect(repConfidence({ visibility: 0.5, trackedFraction: 1, jitter: 0, margin: 30 })).toBeCloseTo(0.4)
  })
})

describe('summarizeSet', () => {
  it('totals reps and ranks tips by frequency', () => {
    const reps = [...run([...rep(), ...rep(85), ...rep(85), ...rep(58)])]
    const s = summarizeSet(reps)
    expect(s.totalReps).toBe(4)
    expect(s.correctReps).toBe(2)
    expect(s.flaggedReps).toBe(1)
    expect(s.tips[0]).toMatch(/^Curl higher.*\(2 of 4 reps\)$/)
  })

  it('praises a clean set', () => {
    expect(summarizeSet(run(rep())).tips).toEqual(['Great form across the whole set - keep it up!'])
  })
})
