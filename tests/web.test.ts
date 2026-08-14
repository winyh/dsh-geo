import { describe, expect, it } from 'vitest'
import { createSourceDocument, htmlToMarkdown } from '../src/web.js'

describe('web source normalization', () => {
  it('converts an HTML page into bounded Markdown with headings and links', () => {
    const markdown = htmlToMarkdown('<title>Example</title><main><h1>Example page</h1><p>Answer <a href="/guide">the question</a>.</p><ul><li>One</li></ul></main>', 'https://example.com/home')
    expect(markdown).toContain('# Example page')
    expect(markdown).toContain('[the question](https://example.com/guide)')
    expect(markdown).toContain('- One')
  })

  it('records URL provenance without pretending a snapshot is live content', () => {
    const document = createSourceDocument('https://example.com', 'public-url', '<h1>Example</h1><p>Answer.</p>', {
      maxFiles: 10,
      maxFileBytes: 10_000,
      maxTextChars: 1_000,
      maxResultChars: 1_000,
    }, {
      bodyKind: 'html',
      finalUrl: 'https://example.com/',
      statusCode: 200,
      accessNote: 'test',
    })
    expect(document.note.sourceUrls).toContain('https://example.com/')
    expect(document.sourceType).toBe('public-url')
    expect(document.truncated).toBe(false)
  })
})
