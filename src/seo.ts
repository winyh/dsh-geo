import type { NoteSnapshot, SeoCheckArea, SeoStandardCheck, SeoStandardReport, SourceType } from './types.js'

export const SEO_STANDARD_VERSION = 'google-search-essentials-2025-12'

const references = [
  'https://developers.google.com/search/docs/essentials?hl=zh-cn',
  'https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=zh-cn',
  'https://developers.google.com/search/docs/fundamentals/get-started?hl=zh-cn',
  'https://developers.google.com/search/docs/appearance/title-link?hl=zh-cn',
  'https://developers.google.com/search/docs/appearance/snippet?hl=zh-cn',
  'https://developers.google.com/search/docs/crawling-indexing?hl=zh-cn',
]

export interface SeoAuditContext {
  sourceType?: SourceType
  finalUrl?: string
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function frontmatterValue(note: NoteSnapshot, pattern: RegExp): string {
  for (const [key, value] of Object.entries(note.frontmatter)) {
    if (pattern.test(key)) {
      const text = textValue(value)
      if (text) return text
    }
  }
  return ''
}

function containsTopic(text: string, topic: string): boolean {
  if (!text || !topic) return false
  const normalizedText = text.toLocaleLowerCase()
  const normalizedTopic = topic.toLocaleLowerCase().trim()
  if (normalizedText.includes(normalizedTopic)) return true
  const words = normalizedTopic.split(/\s+/).filter((word) => word.length > 2)
  return words.length > 0 && words.every((word) => normalizedText.includes(word))
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (text.match(new RegExp(escaped, 'gi')) || []).length
}

function check(
  id: string,
  area: SeoCheckArea,
  status: SeoStandardCheck['status'],
  evidence: string,
  recommendation: string,
): SeoStandardCheck {
  return { id, area, status, evidence, recommendation }
}

function summary(checks: SeoStandardCheck[]): SeoStandardReport['summary'] {
  return checks.reduce((result, item) => {
    result[item.status] += 1
    return result
  }, { pass: 0, warn: 0, unknown: 0 })
}

function sourceLabel(context: SeoAuditContext): string {
  if (context.sourceType === 'public-url') return '公开 URL 快照'
  if (context.sourceType === 'private-snapshot') return '本地 HTML 私有快照'
  if (context.sourceType === 'local-markdown') return '本地 Markdown 源文件'
  return '本地内容源'
}

export function buildSeoStandardReport(note: NoteSnapshot, context: SeoAuditContext = {}): SeoStandardReport {
  const technical = note.technical
  const label = sourceLabel(context)
  const description = technical?.metaDescription || frontmatterValue(note, /^(description|meta_description|seo_description)$/i)
  const canonical = technical?.canonicalUrl || frontmatterValue(note, /^(canonical|canonical_url)$/i)
  const primary = note.primaryQuery || note.title
  const title = technical?.htmlTitle || note.title
  const checks: SeoStandardCheck[] = []

  checks.push(check(
    'content.people-first',
    'content',
    note.wordCount >= 120 && note.firstParagraph.length >= 40 && note.headings.length >= 2 ? 'pass' : 'warn',
    note.wordCount >= 120
      ? `检测到约 ${note.wordCount} 个词、${note.headings.length} 个标题和首段直接回答。`
      : `当前约 ${note.wordCount} 个词、${note.headings.length} 个标题；内容价值不能只靠扩写补足。`,
    '围绕用户任务补充定义、步骤、边界、例子和来源；不要为了长度添加与用户无关的段落。',
  ))

  checks.push(check(
    'content.topic-language',
    'content',
    primary && containsTopic(`${title}\n${note.firstParagraph}\n${note.headings.join('\n')}`, primary) ? 'pass' : 'warn',
    primary ? `主题信号“${primary}”${containsTopic(`${title}\n${note.firstParagraph}\n${note.headings.join('\n')}`, primary) ? '出现在标题、首段或标题层级中。' : '没有稳定出现在标题、首段或标题层级中。'}` : '未检测到明确主题信号。',
    '使用用户可能采用的字词描述页面主题，并把主查询自然放入标题、H1、首段和相关章节；不要机械重复。',
  ))

  const descriptionStatus = description ? 'pass' : technical ? 'warn' : 'unknown'
  checks.push(check(
    'search-presentation.description',
    'search-presentation',
    descriptionStatus,
    description
      ? `检测到描述字段，长度约 ${description.length} 个字符。`
      : `${label}没有可验证的 meta description/description 字段。`,
    '为页面准备独有、准确、简洁的描述；Google 可能根据页面正文而不是元描述生成摘要。',
  ))

  const genericTitle = /^(home|homepage|首页|主页|profile|个人资料|untitled)$/i.test(title.trim())
  checks.push(check(
    'search-presentation.title',
    'search-presentation',
    title && !genericTitle ? 'pass' : 'warn',
    title ? `检测到标题“${title}”。` : '未检测到页面标题。',
    '为每个页面提供独有、简洁、准确的标题；不要使用“首页”“个人资料”等无法说明内容的标题。',
  ))

  const occurrenceCount = countOccurrences(note.content, note.primaryQuery || '')
  const density = note.primaryQuery && note.wordCount > 0 ? occurrenceCount / note.wordCount : 0
  checks.push(check(
    'content.no-keyword-stuffing',
    'content',
    !note.primaryQuery ? 'unknown' : density > 0.08 ? 'warn' : 'pass',
    note.primaryQuery
      ? `主查询在源文本中约出现 ${occurrenceCount} 次，占估算词数 ${(density * 100).toFixed(1)}%。`
      : '没有主查询，无法进行重复度检查。',
    '让内容先服务用户；关键词只用于表达主题和覆盖问题，不要为了排名重复词语。',
  ))

  const links = note.internalLinks.length + note.externalLinks.length
  checks.push(check(
    'crawl-index.links',
    'links',
    links > 0 ? 'pass' : 'warn',
    links > 0 ? `检测到 ${links} 个内部/外部链接信号。` : '未检测到 Markdown 链接或 WikiLink。',
    '提供指向相关页面的可抓取链接，并使用能说明目标内容的链接文字；部署后仍需检查渲染出的 HTML。',
  ))

  const finalUrl = context.finalUrl || ''
  const httpsStatus = finalUrl
    ? finalUrl.startsWith('https://') ? 'pass' : 'warn'
    : 'unknown'
  checks.push(check(
    'crawl-index.https',
    'crawl-index',
    httpsStatus,
    finalUrl ? `最终 URL：${finalUrl}` : `${label}没有可验证的部署 URL。`,
    '上线页面优先使用 HTTPS；本地 Markdown 无法证明部署后的协议。',
  ))

  const canonicalStatus = canonical ? 'pass' : technical ? 'unknown' : 'unknown'
  checks.push(check(
    'crawl-index.canonical',
    'crawl-index',
    canonicalStatus,
    canonical ? `检测到规范 URL：${canonical}` : `${label}未检测到可验证的规范 URL。`,
    '如果同一内容存在多个 URL，选择一个规范 URL，并确保 Sitemap、内部链接和 canonical 信号不要互相冲突。',
  ))

  const robots = technical?.robots || ''
  const robotsStatus = technical ? (/\bnoindex\b/i.test(robots) ? 'warn' : 'pass') : 'unknown'
  checks.push(check(
    'crawl-index.robots',
    'crawl-index',
    robotsStatus,
    technical ? (robots ? `检测到 robots 指令：${robots}` : '未检测到限制索引的 robots meta 指令。') : '本地源文件无法验证部署后的 robots.txt 或 robots meta。',
    '不要用 robots.txt 代替 noindex；如果页面应出现在搜索结果中，确认没有意外的 noindex 或访问限制。',
  ))

  const structuredStatus = technical ? technical.structuredDataTypes.length > 0 ? 'pass' : 'unknown' : 'unknown'
  checks.push(check(
    'search-presentation.structured-data',
    'search-presentation',
    structuredStatus,
    technical
      ? technical.structuredDataTypes.length > 0
        ? `检测到结构化数据类型：${technical.structuredDataTypes.join(', ')}。`
        : '未检测到 JSON-LD 结构化数据；并非所有页面都需要结构化数据。'
      : '本地 Markdown 不包含可验证的部署结构化数据。',
    '仅在内容类型适用时补充符合 Google 要求的结构化数据，并在部署后用富媒体搜索结果测试验证；结构化数据不保证展示富媒体结果。',
  ))

  const mediaStatus = technical
    ? technical.imageCount === 0 || technical.imagesMissingAlt === 0 ? 'pass' : 'warn'
    : 'unknown'
  checks.push(check(
    'media.image-alt',
    'media',
    mediaStatus,
    technical
      ? technical.imageCount === 0 ? '页面未检测到图片。' : `检测到 ${technical.imageCount} 张图片，其中 ${technical.imagesMissingAlt} 张缺少 alt。`
      : '本地 Markdown 无法证明最终 HTML 中的图片和 alt 属性。',
    '在相关文字附近放置清晰图片，并为有信息价值的图片提供准确 alt；装饰性图片按站点模板处理。',
  ))

  const viewportStatus = technical ? technical.hasViewport ? 'pass' : 'warn' : 'unknown'
  checks.push(check(
    'media.mobile-viewport',
    'media',
    viewportStatus,
    technical ? (technical.hasViewport ? '检测到移动端 viewport。' : '未检测到移动端 viewport。') : '本地源文件无法验证部署页面的移动端 viewport。',
    '部署后验证移动端呈现、核心网页指标和资源可访问性；这些指标不能从 Markdown 分数推断。',
  ))

  checks.push(check(
    'crawl-index.sitemap',
    'crawl-index',
    'unknown',
    '单页 URL 或 Markdown 源文件不能证明整个站点的 Sitemap 状态。',
    '在站点层面生成并提交包含首选规范 URL 的 Sitemap；大型站点再按目录或类型拆分并监控。',
  ))

  checks.push(check(
    'monitoring.search-console',
    'monitoring',
    'unknown',
    '插件没有 Search Console 账号数据、索引覆盖率、查询展现或点击数据。',
    '上线后用 Search Console 的网址检查、索引编制和效果报告验证抓取、收录、查询、点击与变化趋势。',
  ))

  return {
    framework: 'Google Search Essentials + Google SEO Starter Guide',
    ruleVersion: SEO_STANDARD_VERSION,
    checks,
    summary: summary(checks),
    limitations: [
      'Markdown 审计只能评估源内容与声明的 frontmatter，不能证明部署后的 HTML、robots.txt、Sitemap、渲染、性能或 Search Console 状态。',
      '公开 URL 只读取匿名可访问内容；登录态、JavaScript 渲染后的差异和站点级覆盖需要导出快照或外部站点工具补充。',
      'Google 官方文档明确指出，满足技术要求和最佳实践也不保证一定抓取、收录或展示；本报告是提效用的检查清单，不是排名承诺。',
    ],
    references,
  }
}
