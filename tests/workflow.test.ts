import { describe, expect, it } from 'vitest'
import { auditNote } from '../src/audit.js'
import { parseNote } from '../src/markdown.js'
import { buildKeywordPlan, buildProductionPlan } from '../src/workflow.js'

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
})
