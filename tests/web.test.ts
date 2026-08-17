import { describe, expect, it } from 'vitest'
import { auditNote } from '../src/audit.js'
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

  it('extracts deploy-time SEO signals and maps them to the Google standard checklist', () => {
    const document = createSourceDocument('https://example.com', 'public-url', `
      <html lang="zh-CN"><head>
        <title>Knowledge base guide</title>
        <meta name="description" content="A useful guide to knowledge bases.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="/guide">
        <script type="application/ld+json">{"@type":"Article"}</script>
      </head><body><main><h1>Knowledge base guide</h1><p>A knowledge base is a structured source of answers for teams.</p><img src="cover.png"><a href="/next">Next</a></main></body></html>
    `, {
      maxFiles: 10,
      maxFileBytes: 10_000,
      maxTextChars: 10_000,
      maxResultChars: 1_000,
    }, {
      bodyKind: 'html',
      finalUrl: 'https://example.com/guide',
      statusCode: 200,
      accessNote: 'test',
    })
    const audit = auditNote(document.note, { sourceType: document.sourceType, finalUrl: document.finalUrl })
    expect(document.technical?.canonicalUrl).toBe('https://example.com/guide')
    expect(document.technical?.structuredDataTypes).toContain('Article')
    expect(document.technical?.imagesMissingAlt).toBe(1)
    expect(audit.seoStandard.summary.unknown).toBeGreaterThan(0)
    expect(audit.seoStandard.checks.find((item) => item.id === 'search-presentation.description')?.status).toBe('pass')
    expect(audit.seoStandard.checks.find((item) => item.id === 'media.image-alt')?.status).toBe('warn')
  })
})
