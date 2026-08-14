import { describe, expect, it } from 'vitest'
import { auditNote, createContentBrief } from '../src/audit.js'
import { parseNote } from '../src/markdown.js'

describe('auditNote', () => {
  it('returns explainable scores and prioritized actions', () => {
    const note = parseNote('weak.md', '# A\n\nA short note.')
    const result = auditNote(note)
    expect(result.scores.overall).toBeLessThan(100)
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.topActions.length).toBeGreaterThan(0)
  })

  it('creates a useful brief from the audit', () => {
    const note = parseNote('topic.md', `---\ntopic: GEO\n---\n\n# GEO\n\nGEO 是让生成式引擎更容易理解和引用品牌信息的方法。`)
    const result = createContentBrief(note, auditNote(note))
    expect(result.topic).toBe('GEO')
    expect(result.outline).toBeInstanceOf(Array)
    expect(result.questions).toBeInstanceOf(Array)
  })
})
