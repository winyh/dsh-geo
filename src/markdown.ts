import type { Frontmatter, NoteSnapshot } from './types.js'

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
  for (const line of lines.slice(1, end)) {
    const match = /^\s*([^:#][^:]*):\s*(.*)$/.exec(line)
    if (match) frontmatter[match[1].trim()] = parseScalar(match[2])
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

export function parseNote(path: string, content: string): NoteSnapshot {
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
    wordCount: plain ? plain.split(/\s+/).length : 0,
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
  }
}
