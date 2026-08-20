import { describe, expect, it } from 'vitest'
import { buildKeywordOpportunityMap, importKeywordData } from '../src/keywords.js'

describe('keyword opportunity import and mapping', () => {
  it('imports CSV rows and identifies page mapping risks', () => {
    const first = importKeywordData('seo/keywords.json', [], 'term,intent,volume,targetPage\nseo guide,informational,200,/guide\nseo guide,informational,200,/compare', 'Search Console')
    expect(first.result.imported).toBe(2)
    const map = buildKeywordOpportunityMap(first.result.path, first.items)
    expect(map.cannibalization[0].term).toBe('seo guide')
    expect(map.unassigned).toHaveLength(0)
  })

  it('keeps unknown volume absent and flags unassigned opportunities', () => {
    const imported = importKeywordData('keywords.json', [], '| term | intent | targetPage |\n| --- | --- | --- |\n| content plan | informational |  |', 'manual')
    const map = buildKeywordOpportunityMap('keywords.json', imported.items)
    expect(imported.items[0].volume).toBeUndefined()
    expect(map.unassigned).toEqual(['content plan'])
    expect(map.nextActions.join('\n')).toContain('搜索量')
  })
})
