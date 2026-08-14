import type { WebRuntime, WebFetchResult } from '@deepseek-ai/dsh-web'
import type { FileSystemLike, NoteSnapshot, ScanLimits, SourceType } from './types.js'
import { parseNote } from './markdown.js'

export interface SourceDocument {
  source: string
  sourceType: SourceType
  note: NoteSnapshot
  finalUrl: string
  statusCode: number
  bodyKind: 'html' | 'text' | 'markdown' | 'snapshot'
  capturedAt: string
  truncated: boolean
  accessNote: string
}

export function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    nbsp: ' ',
    quot: '"',
    lt: '<',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.toLowerCase().startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return named[entity.toLowerCase()] || `&${entity};`
  })
}

function inlineHtmlToMarkdown(value: string, baseUrl?: string): string {
  let result = value
    .replace(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi, '$1')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, text: string) => {
      const label = inlineHtmlToMarkdown(text, baseUrl).trim()
      try {
        const resolved = baseUrl ? new URL(href, baseUrl).toString() : href
        return label ? `[${label}](${resolved})` : resolved
      } catch {
        return label || href
      }
    })
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<[^>]+>/g, ' ')
  return decodeHtmlEntities(result).replace(/\s+/g, ' ').trim()
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  let source = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(source)?.[2]
  if (main) source = main
  source = source
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, value: string) => `\n\n${'#'.repeat(Number(level))} ${inlineHtmlToMarkdown(value, baseUrl)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, value: string) => `\n- ${inlineHtmlToMarkdown(value, baseUrl)}\n`)
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/section>|<\/article>|<\/main>|<\/blockquote>|<\/pre>|<\/tr>/gi, '\n\n')
    .replace(/<p\b[^>]*>|<div\b[^>]*>|<section\b[^>]*>|<blockquote\b[^>]*>|<pre\b[^>]*>|<tr\b[^>]*>/gi, '\n')
  const lines = source
    .split(/\r?\n/)
    .map((line) => inlineHtmlToMarkdown(line, baseUrl).trim())
    .filter((line, index, all) => line || (index > 0 && all[index - 1]))
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const heading = title ? inlineHtmlToMarkdown(title, baseUrl) : ''
  const withHeading = body.match(/^#{1,6}\s/m) || !heading ? body : `# ${heading}\n\n${body}`
  return withHeading.trim()
}

function snapshotFrontmatter(source: string, sourceType: SourceType, capturedAt: string): string {
  return [
    '---',
    `source_url: ${source}`,
    `source_type: ${sourceType}`,
    `captured_at: ${capturedAt}`,
    '---',
    '',
  ].join('\n')
}

function limitedContent(content: string, limits: ScanLimits): { content: string; truncated: boolean } {
  return {
    content: content.slice(0, limits.maxTextChars),
    truncated: content.length > limits.maxTextChars,
  }
}

export function createSourceDocument(
  source: string,
  sourceType: SourceType,
  rawContent: string,
  limits: ScanLimits,
  options: {
    bodyKind: SourceDocument['bodyKind']
    finalUrl?: string
    statusCode?: number
    truncated?: boolean
    accessNote: string
    addSourceFrontmatter?: boolean
  },
): SourceDocument {
  const capturedAt = new Date().toISOString()
  const converted = options.bodyKind === 'html' ? htmlToMarkdown(rawContent, options.finalUrl || source) : rawContent
  const bounded = limitedContent(converted, limits)
  const content = options.addSourceFrontmatter === false
    ? bounded.content
    : snapshotFrontmatter(options.finalUrl || source, sourceType, capturedAt) + bounded.content
  return {
    source,
    sourceType,
    note: parseNote(source, content, { truncated: Boolean(options.truncated) || bounded.truncated }),
    finalUrl: options.finalUrl || '',
    statusCode: options.statusCode || 0,
    bodyKind: options.bodyKind,
    capturedAt,
    truncated: Boolean(options.truncated) || bounded.truncated,
    accessNote: options.accessNote,
  }
}

export async function fetchPublicDocument(web: WebRuntime, url: string, limits: ScanLimits, signal?: AbortSignal): Promise<SourceDocument> {
  if (!isPublicUrl(url)) throw new Error('Only http(s) URLs can be fetched. For private pages, export Markdown or HTML and pass the local snapshot path.')
  const result: WebFetchResult = await web.fetch({ url }, signal)
  if (result.statusCode < 200 || result.statusCode >= 400) {
    throw new Error(`The public URL returned HTTP ${result.statusCode}. If it is a logged-in or JavaScript-rendered page, export it as Markdown/HTML and analyze the local snapshot instead.`)
  }
  return createSourceDocument(url, 'public-url', result.body.content, limits, {
    bodyKind: result.body.kind,
    finalUrl: result.url,
    statusCode: result.statusCode,
    truncated: result.truncated,
    accessNote: 'Fetched through Harness ctx.web using the anonymous public HTTP provider; no cookies or credentials were used.',
  })
}

export async function readLocalDocument(fs: FileSystemLike, filePath: string, limits: ScanLimits, signal?: AbortSignal): Promise<SourceDocument> {
  const target = await fs.resolve(filePath, { signal })
  const info = await fs.stat(target, signal)
  if (!info || info.type !== 'file') throw new Error(`Not a readable Markdown/HTML snapshot: ${filePath}`)
  if (info.size !== undefined && info.size > limits.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${limits.maxFileBytes}): ${filePath}`)
  const raw = await fs.readText(target, signal)
  const isHtml = /\.html?$/i.test(filePath)
  const sourceType: SourceType = isHtml ? 'private-snapshot' : 'local-markdown'
  return createSourceDocument(filePath, sourceType, raw, limits, {
    bodyKind: isHtml ? 'html' : 'markdown',
    accessNote: isHtml
      ? 'Read a local HTML snapshot. This supports logged-in/private pages without sending cookies to the plugin.'
      : 'Read a local Markdown source. The file stays inside the configured Harness filesystem boundary.',
    addSourceFrontmatter: false,
  })
}
