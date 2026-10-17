import type { RepResult } from './types'

export interface SetSummary {
  totalReps: number
  correctReps: number
  flaggedReps: number
  avgConfidence: number
  tips: string[]
}

export function summarizeSet(reps: RepResult[]): SetSummary {
  const counts = new Map<string, { message: string; count: number }>()
  for (const rep of reps) {
    for (const f of rep.feedback) {
      if (f.severity === 'success') continue
      const entry = counts.get(f.code) ?? { message: f.message, count: 0 }
      entry.count += 1
      counts.set(f.code, entry)
    }
  }
  const tips = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map((t) => `${t.message} (${t.count} of ${reps.length} reps)`)
  const avg = reps.length ? reps.reduce((s, r) => s + r.confidence, 0) / reps.length : 0
  const correctReps = reps.filter((r) => r.isCorrect).length
  if (reps.length && !tips.length) tips.push('Great form across the whole set - keep it up!')
  return {
    totalReps: reps.length,
    correctReps,
    flaggedReps: reps.filter((r) => r.needsReview).length,
    avgConfidence: Math.round(avg * 1000) / 1000,
    tips,
  }
}
