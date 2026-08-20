import { describe, expect, it } from 'vitest'
import { buildBacklinkProfile, buildCompetitorGap, buildPromptReview, buildSiteAuditPage, sameOriginLinks } from '../src/research.js'

describe('research helpers', () => {
  it('builds competitor topic and page gaps', () => {
    const result = buildCompetitorGap({
      target: { keywords: ['seo'], topics: ['basics'], pages: ['/guide'] },
      competitors: [{ name: 'Other', keywords: ['seo', 'audit'], topics: ['basics', 'technical audit'], pages: ['/audit'] }],
    })
    expect(result.missingKeywords).toEqual(['audit'])
    expect(result.missingTopics).toEqual(['technical audit'])
    expect(result.pageGaps).toEqual(['/audit'])
  })

  it('summarizes backlink risks without calling them ranking gains', () => {
    const result = buildBacklinkProfile([
      { sourceUrl: 'https://one.example', broken: true, nofollow: true, spamScore: 80 },
      { sourceUrl: 'https://two.example', lost: true },
    ])
    expect(result.broken).toEqual(['https://one.example'])
    expect(result.risky).toHaveLength(1)
    expect(result.caveats.join('\n')).toContain('数量')
  })

  it('extracts same-origin links and reviews prompt citation evidence', () => {
    const links = sameOriginLinks('<a href="/a">A</a><a href="https://other.example/b">B</a>', 'https://example.com/start')
    expect(links.links).toEqual(['https://example.com/a'])
    const page = buildSiteAuditPage({ url: 'https://example.com', finalUrl: 'https://example.com', statusCode: 200, html: '<html><head><title>Example</title></head><body><h1>Example</h1><img src="x"></body></html>', technical: { htmlTitle: 'Example', imageCount: 1, imagesMissingAlt: 1, hreflangCount: 0, structuredDataTypes: [], hasViewport: false, hasLang: false }, truncated: false })
    expect(page.imagesMissingAlt).toBe(1)
    const review = buildPromptReview([{ prompt: 'best guide', model: 'model-a', capturedAt: 'today', answer: 'answer', citedUrls: [] }])
    expect(review.citationCoverage).toBe(0)
    expect(review.nextActions.join('\n')).toContain('来源')
  })
})
