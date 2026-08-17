import type { Frontmatter, NoteSnapshot, TechnicalSeoSnapshot } from './types.js'

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value)
    } catch {
      if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).split(',').map((item) => parseScalar(item)).filter((item) => item !== '')
      }
      return value
    }
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content }
  const lines = content.split(/\r?\n/)
  if (lines[0].trim() !== '---') return { frontmatter: {}, body: content }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return { frontmatter: {}, body: content }
  const frontmatter: Frontmatter = {}
  const frontmatterLines = lines.slice(1, end)
  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index]
    const match = /^\s*([^:#][^:]*):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1].trim()
    const raw = match[2]
    if (!raw.trim()) {
      const items: unknown[] = []
      let next = index + 1
      while (next < frontmatterLines.length) {
        const item = /^\s*-\s+(.+)$/.exec(frontmatterLines[next])
        if (!item) break
        items.push(parseScalar(item[1]))
        next += 1
      }
      if (items.length > 0) {
        frontmatter[key] = items
        index = next - 1
        continue
      }
    }
    frontmatter[key] = parseScalar(raw)
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n') }
}

function stringsFromValue(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsFromValue)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsFromValue)
  return []
}

function normalizedText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[>#*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstParagraph(body: string): string {
  const cleaned = body
    .replace(/```[\s\S]*?```/g, '')
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .find((part) => part && !/^#{1,6}\s/.test(part) && !/^[-*]\s/.test(part))
  return cleaned ? normalizedText(cleaned).slice(0, 800) : ''
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function languageOf(text: string): NoteSnapshot['language'] {
  const hasChinese = /[\u3400-\u9fff]/.test(text)
  const hasLatin = /[A-Za-z]/.test(text)
  if (hasChinese && hasLatin) return 'mixed'
  if (hasChinese) return 'zh'
  if (hasLatin) return 'en'
  return 'unknown'
}

function countWords(text: string): number {
  const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length
  const latinWords = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []
  const numbers = text.match(/\b\d+(?:\.\d+)?\b/g) || []
  return chinese + latinWords.length + numbers.length
}

export function parseNote(path: string, content: string, options: { truncated?: boolean; technical?: TechnicalSeoSnapshot } = {}): NoteSnapshot {
  const { frontmatter, body } = parseFrontmatter(content)
  const headings: string[] = []
  const headingLevels: number[] = []
  for (const match of body.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    headingLevels.push(match[1].length)
    headings.push(match[2].trim())
  }
  const internalLinks = unique([...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1]))
  const markdownLinks = [...body.matchAll(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1])
  const bareUrls = [...body.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0])
  const externalLinks = unique([...markdownLinks, ...bareUrls])
  const sourceValues = Object.entries(frontmatter)
    .filter(([key]) => /source|citation|reference|url/i.test(key))
    .flatMap(([, value]) => stringsFromValue(value))
  const sourceUrls = unique([...externalLinks, ...sourceValues.filter((value) => /^https?:\/\//.test(value))])
  const questionHeadings = headings.filter((heading) => /[?？]$/.test(heading) || /^(如何|什么|为什么|哪些|是否|how|what|why|which|does|can)\b/i.test(heading))
  const frontmatterStrings = Object.entries(frontmatter).flatMap(([key, value]) =>
    /entity|brand|product|topic/i.test(key) ? stringsFromValue(value) : [],
  )
  const entities = unique(frontmatterStrings.filter((value) => value.length <= 80))
  const primaryQueryValue = [
    frontmatter.dsh_geo_query,
    frontmatter.geo_primary_query,
    frontmatter.seo_keyword,
    frontmatter.keyword,
    frontmatter.topic,
  ].flatMap(stringsFromValue)[0]
  const titleHeading = headings.find((heading) => heading.length > 0)
  const title = titleHeading || path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || path
  const plain = normalizedText(body)
  const listCount = (body.match(/^\s*[-*+]\s+/gm) || []).length
  const tableCount = (body.match(/^\s*\|.+\|\s*$/gm) || []).length
  const first = firstParagraph(body)
  return {
    path,
    title,
    content,
    frontmatter,
    headings,
    headingLevels,
    wordCount: plain ? countWords(plain) : 0,
    internalLinks,
    externalLinks,
    sourceUrls,
    questionHeadings,
    listCount,
    tableCount,
    firstParagraph: first,
    primaryQuery: primaryQueryValue,
    entities,
    hasDefinition: /\b(is|means|refers to|defined as)\b|是指|定义|指的是|是一种/.test(first.slice(0, 500)),
    hasFacts: /\d+(?:\.\d+)?\s*%?|20\d{2}年|据[^。！？]{2,30}(?:显示|指出|统计)/.test(plain),
    hasNextStep: /下一步|行动建议|建议先|可以开始|立即|next step|recommended action/i.test(body),
    truncated: options.truncated === true,
    language: languageOf(plain),
    ...(options.technical ? { technical: options.technical } : {}),
  }
}
