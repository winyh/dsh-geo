import { describe, expect, it } from 'vitest'
import { buildEffectReview } from '../src/effect.js'

describe('manual effect review', () => {
  it('classifies comparable improvements and routes the next cycle', () => {
    const review = buildEffectReview({
      target: 'https://example.com/guide',
      baseline: { period: '2026-07', source: 'Search Console', impressions: 1000, clicks: 40, ctrPercent: 4, averagePosition: 12, referralVisits: 20 },
      current: { period: '2026-08', source: 'Search Console', impressions: 1400, clicks: 70, ctrPercent: 5, averagePosition: 8, referralVisits: 35 },
    })
    expect(review.status).toBe('improving')
    expect(review.dataQuality).toBe('comparable')
    expect(review.changes.find((change) => change.metric === '平均排名位置')?.interpretation).toContain('改善')
    expect(review.nextActions.join('\n')).toContain('继续观察')
  })

  it('does not invent a conclusion when both snapshots lack comparable metrics', () => {
    const review = buildEffectReview({
      target: 'homepage',
      baseline: { period: 'before', source: 'manual note' },
      current: { period: 'after', source: 'manual note' },
    })
    expect(review.status).toBe('inconclusive')
    expect(review.dataQuality).toBe('insufficient')
    expect(review.nextActions.join('\n')).toContain('补充')
  })
})
