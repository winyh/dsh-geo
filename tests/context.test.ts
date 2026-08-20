import { describe, expect, it } from 'vitest'
import { createProjectContext, projectContextResult } from '../src/context.js'

describe('project context', () => {
  it('reports missing required background without inventing defaults', () => {
    const result = projectContextResult('project-context.json')
    expect(result.status).toBe('missing')
    expect(result.missingFields).toContain('businessGoal')
  })

  it('normalizes a ready context and preserves private lists', () => {
    const context = createProjectContext({
      businessGoal: 'Increase qualified trials',
      audience: 'First-time evaluators',
      language: 'zh-CN',
      market: 'China',
      brandName: 'Example',
      canonicalDomain: 'https://example.com',
      brandTerms: ['Example', 'Example'],
      competitors: ['Other'],
    })
    const result = projectContextResult('project-context.json', context)
    expect(result.status).toBe('ready')
    expect(context.brandTerms).toEqual(['Example'])
  })
})
