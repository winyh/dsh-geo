import type { KeywordIntent, KeywordOpportunity, KeywordOpportunityMap, KeywordOpportunityStatus, KeywordImportResult } from './types.js'

interface ParsedKeywordData {
  items: KeywordOpportunity[]
  errors: string[]
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[%$,]/g, '').trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function asIntent(value: unknown): KeywordIntent {
  const normalized = String(value || '').trim().toLowerCase()
  return ['informational', 'commercial', 'navigational', 'transactional'].includes(normalized) ? normalized as KeywordIntent : 'unknown'
}

function asStatus(value: unknown): KeywordOpportunityStatus {
  const normalized = String(value || '').trim().toLowerCase()
  return ['candidate', 'planned', 'writing', 'published', 'tracking', 'discarded'].includes(normalized) ? normalized as KeywordOpportunityStatus : 'candidate'
}

function rowValue(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = row[name] ?? row[name.toLowerCase()] ?? row[name.replace(/_/g, ' ')]
    if (value !== undefined) return value
  }
  return undefined
}

function normalizeRow(row: Record<string, unknown>, source: string, index: number): KeywordOpportunity {
  const term = String(rowValue(row, 'term', 'keyword', 'query', '关键词') || '').trim()
  if (!term) throw new Error(`Row ${index + 1} is missing term/keyword.`)
  return {
    term,
    intent: asIntent(rowValue(row, 'intent', 'search_intent', '意图')),
    ...(asNumber(rowValue(row, 'volume', 'search_volume', '搜索量')) === undefined ? {} : { volume: asNumber(rowValue(row, 'volume', 'search_volume', '搜索量')) }),
    ...(asNumber(rowValue(row, 'difficulty', 'kd', 'keyword_difficulty', '难度')) === undefined ? {} : { difficulty: asNumber(rowValue(row, 'difficulty', 'kd', 'keyword_difficulty', '难度')) }),
    ...(asNumber(rowValue(row, 'cpc', '每次点击成本')) === undefined ? {} : { cpc: asNumber(rowValue(row, 'cpc', '每次点击成本')) }),
    ...(String(rowValue(row, 'country', '国家', '地区') || '').trim() ? { country: String(rowValue(row, 'country', '国家', '地区')).trim() } : {}),
    ...(String(rowValue(row, 'device', '设备') || '').trim() ? { device: String(rowValue(row, 'device', '设备')).trim().toLowerCase() as KeywordOpportunity['device'] } : {}),
    source: String(rowValue(row, 'source', '来源') || source).trim(),
    capturedAt: String(rowValue(row, 'capturedAt', 'captured_at', '采集时间') || new Date().toISOString()).trim(),
    ...(String(rowValue(row, 'targetPage', 'target_page', 'page', '目标页面') || '').trim() ? { targetPage: String(rowValue(row, 'targetPage', 'target_page', 'page', '目标页面')).trim() } : {}),
    ...(String(rowValue(row, 'cluster', 'topic', '主题') || '').trim() ? { cluster: String(rowValue(row, 'cluster', 'topic', '主题')).trim() } : {}),
    status: asStatus(rowValue(row, 'status', '状态')),
    ...(String(rowValue(row, 'notes', 'note', '备注') || '').trim() ? { notes: String(rowValue(row, 'notes', 'note', '备注')).trim() } : {}),
  }
}

function splitCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(current.trim())
      current = ''
    } else current += char
  }
  values.push(current.trim())
  return values
}

function parseCsv(content: string): Record<string, unknown>[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0]).map((header) => header.replace(/^"|"$/g, '').trim())
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))
  })
}

function parseMarkdownTable(content: string): Record<string, unknown>[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('|'))
  if (lines.length < 3) return []
  const headers = lines[0].split('|').slice(1, -1).map((value) => value.trim())
  return lines.slice(2).map((line) => {
    const values = line.split('|').slice(1, -1).map((value) => value.trim())
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))
  })
}

export function parseKeywordData(content: string, source: string): ParsedKeywordData {
  const trimmed = content.trim()
  if (!trimmed) return { items: [], errors: ['Keyword import is empty.'] }
  let rows: Record<string, unknown>[] = []
  try {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed: unknown = JSON.parse(trimmed)
      const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { keywords?: unknown }).keywords) ? (parsed as { keywords: unknown[] }).keywords : []
      rows = values.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
    } else if (trimmed.includes('|') && /\|\s*[-:]+/.test(trimmed)) rows = parseMarkdownTable(trimmed)
    else rows = parseCsv(trimmed)
  } catch (error) {
    return { items: [], errors: [error instanceof Error ? error.message : String(error)] }
  }
  const items: KeywordOpportunity[] = []
  const errors: string[] = []
  rows.forEach((row, index) => {
    try {
      items.push(normalizeRow(row, source, index))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  })
  return { items, errors }
}

export function mergeKeywordOpportunities(existing: KeywordOpportunity[], incoming: KeywordOpportunity[]): { items: KeywordOpportunity[]; updated: number; added: number } {
  const map = new Map(existing.map((item) => [`${item.term.toLocaleLowerCase()}|${item.country || ''}|${item.device || ''}|${item.targetPage || ''}`, item]))
  let updated = 0
  let added = 0
  for (const item of incoming) {
    const key = `${item.term.toLocaleLowerCase()}|${item.country || ''}|${item.device || ''}|${item.targetPage || ''}`
    if (map.has(key)) updated += 1
    else added += 1
    map.set(key, item)
  }
  return { items: [...map.values()], updated, added }
}

function derivedCluster(term: string): string {
  const tokens = term.toLocaleLowerCase().split(/[\s\-_/]+/).filter((token) => token.length > 1 && !['how', 'what', 'the', 'and', 'for', '的', '是', '怎么', '如何'].includes(token))
  return tokens.slice(0, 2).join(' ') || term.slice(0, 12)
}

function priorityFor(items: KeywordOpportunity[]): 'high' | 'medium' | 'low' {
  const scored = items.filter((item) => item.volume !== undefined && item.difficulty !== undefined)
  if (scored.some((item) => (item.volume || 0) >= 100 && (item.difficulty || 100) <= 40)) return 'high'
  if (scored.length > 0 || items.some((item) => ['planned', 'writing'].includes(item.status))) return 'medium'
  return 'low'
}

export function buildKeywordOpportunityMap(path: string, items: KeywordOpportunity[]): KeywordOpportunityMap {
  const clusters = new Map<string, KeywordOpportunity[]>()
  for (const item of items) {
    const cluster = item.cluster?.trim() || derivedCluster(item.term)
    const list = clusters.get(cluster) || []
    list.push(item)
    clusters.set(cluster, list)
  }
  const mapped = [...clusters.entries()].map(([name, values]) => ({
    name,
    terms: values.map((item) => item.term),
    targetPages: [...new Set(values.map((item) => item.targetPage).filter((value): value is string => Boolean(value)))],
    priority: priorityFor(values),
  }))
  const byTerm = new Map<string, Set<string>>()
  for (const item of items) {
    if (!item.targetPage) continue
    const pages = byTerm.get(item.term.toLocaleLowerCase()) || new Set<string>()
    pages.add(item.targetPage)
    byTerm.set(item.term.toLocaleLowerCase(), pages)
  }
  const cannibalization = [...byTerm.entries()]
    .filter(([, pages]) => pages.size > 1)
    .map(([term, pages]) => ({ term, targetPages: [...pages], nextAction: '确认一个主页面，其他页面改为支持性内容或调整意图，避免多个页面争夺同一查询。' }))
  return {
    path,
    total: items.length,
    clusters: mapped,
    cannibalization,
    unassigned: items.filter((item) => !item.targetPage).map((item) => item.term),
    nextActions: [
      ...(cannibalization.length > 0 ? ['先处理关键词蚕食，再扩展新页面。'] : []),
      ...(items.some((item) => item.volume === undefined) ? ['补充真实搜索量或保留为 seed-only，不要自行估算。'] : []),
      ...(items.some((item) => !item.targetPage) ? ['为高优先级关键词指定目标页面或内容 Brief。'] : []),
      '把已发布页面的 GSC 查询导入 geo_effect_review，继续找第二页机会和 CTR 异常。',
    ],
  }
}

export function importKeywordData(path: string, existing: KeywordOpportunity[], content: string, source: string): { result: KeywordImportResult; items: KeywordOpportunity[] } {
  const parsed = parseKeywordData(content, source)
  const merged = mergeKeywordOpportunities(existing, parsed.items)
  return {
    items: merged.items,
    result: {
      path,
      imported: merged.added,
      updated: merged.updated,
      skipped: parsed.errors.length,
      errors: parsed.errors,
      total: merged.items.length,
      nextActions: parsed.errors.length > 0
        ? ['修复无法解析的行后重新导入；不要把未知列解释成真实 SEO 指标。']
        : ['运行 geo_keyword_opportunities 查看聚类、页面映射和蚕食风险。'],
    },
  }
}
