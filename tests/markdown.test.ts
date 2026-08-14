import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/markdown.js'

describe('parseNote', () => {
  it('extracts metadata, links, questions and source URLs', () => {
    const note = parseNote('GEO.md', `---
type: skill
status: active
topic: GEO
entities: [GEO, SEO]
source: https://example.com/source
---

# GEO 入门

GEO 是生成式引擎优化，用于让 AI 更准确地理解和引用内容。

## 如何开始？

- 建立来源
- 补充内部链接

[[SEO]]`)
    expect(note.title).toBe('GEO 入门')
    expect(note.primaryQuery).toBe('GEO')
    expect(note.entities).toContain('GEO')
    expect(note.sourceUrls).toContain('https://example.com/source')
    expect(note.internalLinks).toEqual(['SEO'])
    expect(note.questionHeadings).toEqual(['如何开始？'])
    expect(note.listCount).toBe(2)
  })
})
