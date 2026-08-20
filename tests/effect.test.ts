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

  it('routes query-level opportunities and catches malformed metrics', () => {
    const review = buildEffectReview({
      target: 'guide',
      baseline: { period: 'before', source: 'GSC', impressions: 100, clicks: 5 },
      current: { period: 'after', source: 'GSC', impressions: 200, clicks: 10 },
      rows: [
        { query: 'seo guide', page: '/guide', impressions: 500, clicks: 4, ctrPercent: 0.8, averagePosition: 12 },
        { query: 'seo guide', page: '/compare', impressions: 50, clicks: 60, ctrPercent: 120, averagePosition: 5 },
        { query: 'not indexed', page: '/new', indexed: false, indexNote: 'URL inspection: not indexed' },
      ],
    })
    expect(review.opportunities.map((item) => item.type)).toEqual(expect.arrayContaining(['striking-distance', 'low-ctr', 'indexing', 'cannibalization']))
    expect(review.anomalies.join('\n')).toContain('clicks 大于 impressions')
  })
})
