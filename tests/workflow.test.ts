import { describe, expect, it } from 'vitest'
import { auditNote, createContentBrief } from '../src/audit.js'
import { buildKeywordOpportunityMap } from '../src/keywords.js'
import { parseNote } from '../src/markdown.js'
import { buildKeywordPlan, buildProductionPlan, buildSeoSop } from '../src/workflow.js'

describe('complete content workflow', () => {
  it('keeps keyword recommendations honest when no search provider exists', async () => {
    const note = parseNote('topic.md', '---\nkeyword: knowledge base\nentities: [SEO]\n---\n\n# Knowledge base\n\nA knowledge base is a structured source of answers.\n\n## How does it work?\n\nIt organizes facts and links.\n')
    const audit = auditNote(note)
    const plan = await buildKeywordPlan(note, audit, undefined, ['knowledge base'])
    expect(plan.status).toBe('seeds-only')
    expect(plan.volumeDataAvailable).toBe(false)
    expect(plan.primaryKeyword).toBe('knowledge base')
    expect(plan.unknownReasons.length).toBeGreaterThan(0)
  })

  it('uses search results as qualitative signals and produces four production stages', async () => {
    const note = parseNote('topic.md', '# Knowledge base\n\nA knowledge base is a structured source of answers.\n')
    const audit = auditNote(note)
    const plan = await buildKeywordPlan(note, audit, {
      async search() {
        return { truncated: false, sources: [{ url: 'https://example.com/result', title: 'Knowledge base guide' }] }
      },
    }, ['knowledge base'])
    const brief = {
      source: note.path,
      topic: 'knowledge base',
      intent: 'informational',
      audience: 'readers',
      scores: audit.scores,
      recommendedTitle: 'Knowledge base guide',
      directAnswer: 'A knowledge base is a structured source of answers.',
      outline: ['Definition', 'Method'],
      questions: ['How does it work?'],
      entities: ['SEO'],
      sourceGaps: [],
      nextActions: [],
    }
    const production = buildProductionPlan(brief, audit, plan)
    expect(plan.searchSignals).toHaveLength(3)
    expect(plan.dataQuality).toBe('qualitative')
    expect(production.stages.map((stage) => stage.id)).toEqual(['diagnose', 'keyword-map', 'draft', 'verify'])
    expect(production.draftContract.evidenceRules.length).toBeGreaterThan(0)
  })

  it('uses related local knowledge notes as a private keyword and content input dimension', async () => {
    const note = parseNote('product.md', `---\nkeyword: knowledge base\n---\n\n# Knowledge base\n\nA knowledge base is a structured source of answers for product teams.\n\n## How does it work?\n\nIt organizes facts and links.\n`)
    const related = parseNote('guides/seo.md', `---\nkeyword: technical SEO\n---\n\n# Technical SEO for a knowledge base\n\n## Sitemap and canonical URLs\n\nUse a sitemap and canonical URL when publishing related pages.\n`)
    const audit = auditNote(note)
    const plan = await buildKeywordPlan(note, audit, undefined, ['knowledge base'], undefined, [related], audit.seoStandard)
    const brief = createContentBrief(note, audit)
    const production = buildProductionPlan(brief, audit, plan)
    expect(plan.knowledgeSignals).toHaveLength(1)
    expect(plan.knowledgeSignals[0].candidateTerms).toContain('technical SEO')
    expect(plan.knowledgeSignals[0].excerpt).toContain('technical SEO')
    expect(production.contentInputs.knowledgeBase[0]).toContain('local excerpt')
    expect(production.contentInputs.source[0]).toContain('product.md')
    expect(production.contentInputs.seoStandard.length).toBeGreaterThan(0)
  })

  it('returns an ordered SOP with explicit completion criteria and next actions', async () => {
    const note = parseNote('product.md', '# Knowledge base\n\nA knowledge base is a structured source of answers for product teams.\n')
    const audit = auditNote(note)
    const keywordPlan = await buildKeywordPlan(note, audit, undefined, ['knowledge base'])
    const brief = createContentBrief(note, audit)
    const sop = buildSeoSop({
      source: note.path,
      sourceType: 'local-markdown',
      sourceTruncated: false,
      knowledgeBaseEnabled: true,
      audit,
      keywordPlan,
      brief,
    })
    expect(sop.steps).toHaveLength(9)
    expect(sop.steps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(sop.currentStep).toBe('draft')
    expect(sop.steps.find((step) => step.id === 'draft')?.status).toBe('ready')
    expect(sop.steps.every((step) => step.completionCriteria.length > 0 && step.nextAction.length > 0)).toBe(true)
  })

  it('carries imported opportunity clusters into the production input contract', async () => {
    const note = parseNote('product.md', '# Knowledge base\n\nA knowledge base is a structured source of answers.\n')
    const audit = auditNote(note)
    const keywordPlan = await buildKeywordPlan(note, audit, undefined, ['knowledge base'])
    const brief = createContentBrief(note, audit)
    const opportunityMap = buildKeywordOpportunityMap('seo/keywords.json', [{ term: 'knowledge base guide', intent: 'informational', source: 'manual', capturedAt: 'today', targetPage: '/guide', status: 'planned', cluster: 'knowledge base' }])
    const production = buildProductionPlan(brief, audit, keywordPlan, opportunityMap)
    expect(production.contentInputs.keywordMap.join('\n')).toContain('Opportunity cluster')
  })
})
