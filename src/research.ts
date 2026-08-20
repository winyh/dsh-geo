import type {
  BacklinkProfileResult,
  BacklinkProfileRow,
  CompetitorDataset,
  CompetitorGapResult,
  PromptEvidenceRun,
  PromptReviewResult,
  SiteAuditPage,
  SiteAuditResult,
  TechnicalSeoSnapshot,
} from './types.js'

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(value)
    }
  }
  return result
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map((item) => String(item)))
  if (typeof value === 'string') return unique(value.split(/[\n,，、;；]/g))
  return []
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(String(value).replace(/[%$,]/g, '').trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function normalizeCompetitorDataset(input: Partial<CompetitorDataset>): CompetitorDataset {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('Competitor name is required.')
  return {
    name,
    ...(input.url?.trim() ? { url: input.url.trim() } : {}),
    keywords: asList(input.keywords),
    topics: asList(input.topics),
    pages: asList(input.pages),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
  }
}

export function buildCompetitorGap(input: {
  target: { keywords?: unknown; topics?: unknown; pages?: unknown }
  competitors: Array<Partial<CompetitorDataset>>
}): CompetitorGapResult {
  const target = {
    keywords: asList(input.target.keywords),
    topics: asList(input.target.topics),
    pages: asList(input.target.pages),
  }
  const competitors = input.competitors.map(normalizeCompetitorDataset)
  const targetKeywords = normalizedSet(target.keywords)
  const targetTopics = normalizedSet(target.topics)
  const targetPages = normalizedSet(target.pages)
  const missingKeywords = unique(competitors.flatMap((item) => item.keywords).filter((term) => !targetKeywords.has(term.toLocaleLowerCase())))
  const missingTopics = unique(competitors.flatMap((item) => item.topics).filter((term) => !targetTopics.has(term.toLocaleLowerCase())))
  const pageGaps = unique(competitors.flatMap((item) => item.pages).filter((page) => !targetPages.has(page.toLocaleLowerCase())))
  return {
    target,
    competitors,
    missingKeywords,
    missingTopics,
    pageGaps,
    caveats: [
      '竞争对手差距只基于用户提供的词、主题和页面清单；没有自动推断竞争对手真实流量、排名或内容质量。',
      '差距项先作为研究候选，必须结合业务相关性、搜索意图、已有页面和事实来源再决定是否生产。',
    ],
    nextActions: [
      ...(missingTopics.length > 0 ? ['把最相关的缺口主题加入 geo_keyword_import，再运行 geo_keyword_opportunities。'] : []),
      ...(pageGaps.length > 0 ? ['逐个确认页面缺口是否服务不同搜索意图，不要复制竞争对手页面。'] : []),
      '对确认后的候选词运行 geo_workflow，先做诊断和内容 Brief，再进入写作。',
    ],
  }
}

export function buildBacklinkProfile(rows: BacklinkProfileRow[], competitorRows: BacklinkProfileRow[] = []): BacklinkProfileResult {
  const domains = new Set(rows.map((row) => {
    if (row.referringDomain?.trim()) return row.referringDomain.trim().toLocaleLowerCase()
    try { return new URL(row.sourceUrl).hostname.toLocaleLowerCase() } catch { return row.sourceUrl.toLocaleLowerCase() }
  }))
  const broken = unique(rows.filter((row) => row.broken).map((row) => row.sourceUrl))
  const lost = unique(rows.filter((row) => row.lost).map((row) => row.sourceUrl))
  const nofollow = unique(rows.filter((row) => row.nofollow || row.sponsored || row.ugc).map((row) => row.sourceUrl))
  const risky = rows
    .filter((row) => row.spamScore !== undefined && row.spamScore >= 60)
    .map((row) => ({ sourceUrl: row.sourceUrl, reason: `导入的 spamScore 为 ${row.spamScore}，需人工核验，不等同于搜索引擎处罚。` }))
  const ownDomains = new Set(domains)
  const competitorDomains = new Set(competitorRows.map((row) => {
    try { return new URL(row.sourceUrl).hostname.toLocaleLowerCase() } catch { return row.sourceUrl.toLocaleLowerCase() }
  }))
  const competitorGaps = [...competitorDomains].filter((domain) => !ownDomains.has(domain)).map((domain) => `竞争对手有而当前清单没有的 referring domain：${domain}`)
  return {
    total: rows.length,
    referringDomains: domains.size,
    broken,
    lost,
    nofollow,
    risky,
    competitorGaps,
    caveats: [
      '外链画像依赖用户导入的 CSV/JSON；插件不会把链接数量解释为排名收益。',
      'nofollow、sponsored、ugc 和 spamScore 只保留导入信号；是否有价值需要结合相关性、真实推荐访问和页面存活复核。',
    ],
    nextActions: [
      ...(broken.length > 0 ? ['先修复或移除 broken links，并核对目标页面是否仍然相关。'] : []),
      ...(lost.length > 0 ? ['复查 lost links 的公开页面和推荐访问，再决定是否联系站点方。'] : []),
      ...(risky.length > 0 ? ['人工审查高风险来源；不要批量购买链接或以 spamScore 单字段做结论。'] : []),
      ...(competitorGaps.length > 0 ? ['把竞争对手差距转成相关资源研究，不要直接复制或群发提交。'] : []),
      '将确认的公开条目纳入 geo_backlink_record，并在下一周期用 geo_effect_review 评估推荐访问和转化。',
    ],
  }
}

export function sameOriginLinks(html: string, baseUrl: string): { links: string[]; skipped: string[] } {
  const links: string[] = []
  const skipped: string[] = []
  let base: URL
  try { base = new URL(baseUrl) } catch { return { links: [], skipped: [baseUrl] } }
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = (match[1] || match[2] || match[3] || '').trim()
    if (!raw || raw.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(raw)) continue
    try {
      const url = new URL(raw, base)
      if (url.origin !== base.origin) continue
      url.hash = ''
      if (/\.(?:pdf|zip|png|jpe?g|gif|webp|svg|css|js|xml|json)(?:$|\?)/i.test(url.pathname)) {
        skipped.push(url.toString())
        continue
      }
      links.push(url.toString())
    } catch {
      skipped.push(raw)
    }
  }
  return { links: unique(links), skipped: unique(skipped) }
}

function h1Count(html: string): number {
  return [...html.matchAll(/<h1\b[^>]*>/gi)].length
}

function indexability(technical?: TechnicalSeoSnapshot): SiteAuditPage['indexable'] {
  if (!technical) return 'unknown'
  if (/\bnoindex\b/i.test(technical.robots || '')) return 'blocked'
  return 'likely'
}

export function buildSiteAuditPage(input: {
  url: string
  finalUrl: string
  statusCode: number
  html: string
  technical?: TechnicalSeoSnapshot
  truncated: boolean
}): SiteAuditPage {
  const technical = input.technical
  const links = sameOriginLinks(input.html, input.finalUrl || input.url).links
  return {
    url: input.url,
    finalUrl: input.finalUrl || input.url,
    statusCode: input.statusCode,
    ...(technical?.htmlTitle ? { title: technical.htmlTitle } : {}),
    ...(technical?.metaDescription ? { metaDescription: technical.metaDescription } : {}),
    ...(technical?.canonicalUrl ? { canonicalUrl: technical.canonicalUrl } : {}),
    ...(technical?.robots ? { robots: technical.robots } : {}),
    indexable: indexability(technical),
    h1Count: h1Count(input.html),
    internalLinks: links.length,
    imageCount: technical?.imageCount || 0,
    imagesMissingAlt: technical?.imagesMissingAlt || 0,
    structuredDataTypes: technical?.structuredDataTypes || [],
    truncated: input.truncated,
    note: technical ? '仅根据匿名 HTTP 返回的 HTML 做有限页面审计，不代表真实收录或渲染后的页面状态。' : '返回内容不是可分析 HTML，技术字段保持 unknown。',
  }
}

export function buildSiteAuditResult(input: {
  startUrl: string
  pages: SiteAuditPage[]
  skippedLinks: string[]
  maxPages: number
  depth: number
}): SiteAuditResult {
  const actions: string[] = []
  if (input.pages.some((page) => page.statusCode >= 400)) actions.push('优先修复 4xx/5xx 页面，再讨论内容扩展。')
  if (input.pages.some((page) => !page.title || !page.metaDescription)) actions.push('补充缺失的 title 或 meta description，并让它们准确反映页面意图。')
  if (input.pages.some((page) => page.indexable === 'blocked')) actions.push('核对 noindex、canonical、robots 和 Sitemap，确认阻断是有意设计。')
  if (input.pages.some((page) => page.h1Count !== 1)) actions.push('检查 H1 是否缺失或重复；每页保留一个清晰的主主题。')
  if (input.pages.some((page) => page.imagesMissingAlt > 0)) actions.push('为有意义的图片补充准确 alt，装饰图片不要堆关键词。')
  if (input.pages.some((page) => page.truncated)) actions.push('部分页面达到读取上限；缩小页面范围后再验证。')
  if (actions.length === 0) actions.push('本次有限页面审计未发现高置信结构问题；仍需用 Search Console、性能工具和真实部署验证。')
  return {
    startUrl: input.startUrl,
    pages: input.pages,
    skippedLinks: unique(input.skippedLinks),
    limits: { maxPages: input.maxPages, depth: input.depth },
    caveats: [
      '这是同源、匿名、有限页数的 HTML 审计，不是 Lighthouse、JavaScript 渲染、robots.txt、Sitemap 或 Search Console 审计。',
      '页面 status、title、canonical 和 robots 是抓取时的输入信号；真实索引状态必须由站长工具验证。',
    ],
    nextActions: actions,
  }
}

export function buildPromptReview(runs: PromptEvidenceRun[]): PromptReviewResult {
  const grouped = new Map<string, PromptEvidenceRun[]>()
  for (const run of runs) {
    const key = run.prompt.trim().toLocaleLowerCase()
    if (!key) continue
    const list = grouped.get(key) || []
    list.push({ ...run, prompt: run.prompt.trim(), model: run.model.trim() || 'unknown', citedUrls: unique(run.citedUrls), answer: run.answer.trim() })
    grouped.set(key, list)
  }
  const prompts = [...grouped.values()].map((group) => {
    const mentionValues = group.map((run) => run.brandMentioned).filter((value): value is boolean => typeof value === 'boolean')
    const citedUrls = unique(group.flatMap((run) => run.citedUrls))
    return {
      prompt: group[0].prompt,
      models: unique(group.map((run) => run.model)),
      brandMentionRate: mentionValues.length > 0 ? Number((mentionValues.filter(Boolean).length / mentionValues.length * 100).toFixed(2)) : undefined,
      citedUrls,
      missingEvidence: citedUrls.length === 0 ? '没有提供引用 URL；先核对答案中的关键事实和一手来源。' : '已提供引用 URL；继续核对引用是否真正支持答案，而不是只看被提及次数。',
    }
  })
  const citationCoverage = runs.length === 0 ? 0 : Number((runs.filter((run) => run.citedUrls.length > 0).length / runs.length * 100).toFixed(2))
  return {
    totalRuns: runs.length,
    prompts,
    citationCoverage,
    caveats: [
      '这是用户手动采集的 Prompt/模型证据复盘，不代表所有模型、地区、时间或个性化结果。',
      '引用覆盖率只表示输入记录中是否带有 URL，不等于引用质量、排名或因果关系。',
    ],
    nextActions: [
      ...(prompts.some((item) => item.citedUrls.length === 0) ? ['为无引用答案补充可公开复核的一手来源，并回到 geo_workflow 处理主题和证据缺口。'] : []),
      ...(prompts.some((item) => item.brandMentionRate === 0) ? ['检查品牌定义、实体关系、作者/组织信息和可引用页面，不要通过堆品牌词制造提及。'] : []),
      '按固定 Prompt、模型、语言、地区和日期重复采集，再比较变化；不要把一次答案当成稳定排名。',
    ],
  }
}

export function parseBacklinkProfileRows(value: unknown): BacklinkProfileRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const sourceUrl = String(row.sourceUrl || row.source_url || row.url || '').trim()
    if (!sourceUrl) return []
    return [{
      sourceUrl,
      ...(String(row.targetUrl || row.target_url || '').trim() ? { targetUrl: String(row.targetUrl || row.target_url).trim() } : {}),
      ...(String(row.referringDomain || row.referring_domain || '').trim() ? { referringDomain: String(row.referringDomain || row.referring_domain).trim() } : {}),
      ...(String(row.anchor || '').trim() ? { anchor: String(row.anchor).trim() } : {}),
      ...(typeof row.nofollow === 'boolean' ? { nofollow: row.nofollow } : {}),
      ...(typeof row.sponsored === 'boolean' ? { sponsored: row.sponsored } : {}),
      ...(typeof row.ugc === 'boolean' ? { ugc: row.ugc } : {}),
      ...(typeof row.broken === 'boolean' ? { broken: row.broken } : {}),
      ...(typeof row.lost === 'boolean' ? { lost: row.lost } : {}),
      ...(asNumber(row.spamScore || row.spam_score) === undefined ? {} : { spamScore: asNumber(row.spamScore || row.spam_score) }),
      ...(String(row.competitor || '').trim() ? { competitor: String(row.competitor).trim() } : {}),
      ...(String(row.capturedAt || row.captured_at || '').trim() ? { capturedAt: String(row.capturedAt || row.captured_at).trim() } : {}),
    }]
  })
}
