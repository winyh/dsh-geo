import { createHash } from 'node:crypto'
import type {
  BacklinkCandidate,
  BacklinkMode,
  BacklinkPlan,
  BacklinkRecordResult,
  BacklinkResource,
  BacklinkStatus,
} from './types.js'

export const BACKLINK_RESOURCE_SOURCE = 'https://github.com/flaqai/backlink_skills/blob/main/Free-backlink-list.md'

export const BUILTIN_BACKLINK_RESOURCES: BacklinkResource[] = [
  {
    id: 'producthunt',
    name: 'Product Hunt',
    url: 'https://www.producthunt.com/',
    route: 'product-directory',
    audience: 'technology adopters and startup builders',
    relevance: 'Good for a real product launch or product page with a clear user benefit.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list records this as a product discovery platform; current submission rules must be checked before use.',
    requiresAccount: true,
  },
  {
    id: 'devto',
    name: 'DEV Community',
    url: 'https://dev.to/',
    route: 'developer-community',
    audience: 'software developers and technical practitioners',
    relevance: 'Use only for an original technical tutorial or engineering experience, not a thin promotional post.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list suggests an article route; article publishing is a separate user-led content workflow.',
    requiresAccount: true,
  },
  {
    id: 'qiita',
    name: 'Qiita',
    url: 'https://qiita.com/',
    route: 'developer-community',
    audience: 'Japanese software developers',
    relevance: 'Use for genuinely useful Japanese engineering content with local reader value.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list suggests an article route; confirm language and community rules first.',
    requiresAccount: true,
  },
  {
    id: 'osalt',
    name: 'osalt.com',
    url: 'https://osalt.com/suggest',
    route: 'software-directory',
    audience: 'people looking for open-source software alternatives',
    relevance: 'Relevant only when the product has a truthful open-source alternative or comparison use case.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list identifies this as an open-source alternative directory; verify the current suggestion form.',
  },
  {
    id: 'awesomeindie',
    name: 'Awesome Indie',
    url: 'https://awesomeindie.com/',
    route: 'startup-directory',
    audience: 'indie makers and people discovering newly launched products',
    relevance: 'Suitable for a real indie product with a concise, accurate product profile.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list records a product discovery route; availability and submission policy are not guaranteed.',
  },
  {
    id: 'microlaunch',
    name: 'MicroLaunch',
    url: 'https://microlaunch.net/',
    route: 'startup-directory',
    audience: 'indie makers and early product adopters',
    relevance: 'Suitable for a genuine product launch with a clear audience and useful landing page.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list records a product launch community; recheck the current route and terms.',
    requiresAccount: true,
  },
  {
    id: 'startupbase',
    name: 'StartupBase',
    url: 'https://startupbase.io/',
    route: 'startup-directory',
    audience: 'startup founders and product discovery readers',
    relevance: 'Use when the product profile contributes real information to the startup community.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list notes that community participation may be expected; never fabricate engagement.',
    requiresAccount: true,
  },
  {
    id: 'startupranking',
    name: 'Startup Ranking',
    url: 'https://www.startupranking.com/',
    route: 'startup-directory',
    audience: 'people researching startups and company profiles',
    relevance: 'Use for an accurate company or product profile; do not treat ranking placement as an SEO KPI.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list identifies a company profile route; verify current profile and submission rules.',
    requiresAccount: true,
  },
  {
    id: 'launchingnext',
    name: 'Launching Next',
    url: 'https://www.launchingnext.com/submit/',
    route: 'startup-directory',
    audience: 'startup and new product discovery readers',
    relevance: 'Suitable for a real new product with a differentiated, factual description.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list includes this submission route; current availability needs a fresh check.',
  },
  {
    id: 'nocodefamily',
    name: 'NoCode Family',
    url: 'https://nocodefamily.com/submit-tool',
    route: 'software-directory',
    audience: 'no-code builders and tool buyers',
    relevance: 'Relevant only when the product genuinely serves no-code workflows or their users.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list identifies a tool submission route; confirm that the form is currently open.',
  },
  {
    id: 'saashub',
    name: 'SaaSHub',
    url: 'https://saashub.com/',
    route: 'software-directory',
    audience: 'SaaS buyers comparing software and alternatives',
    relevance: 'Use for an accurate software profile and alternative/comparison context, not link volume.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list includes this SaaS discovery platform and notes that submission behavior may vary.',
    requiresAccount: true,
  },
  {
    id: 'pitchwall',
    name: 'PitchWall',
    url: 'https://pitchwall.co/',
    route: 'startup-directory',
    audience: 'people discovering AI products and startups',
    relevance: 'Suitable for a real product profile with a clear use case and working website.',
    source: BACKLINK_RESOURCE_SOURCE,
    historicalNote: 'The upstream list contains duplicate historical entries; this catalog keeps one normalized route.',
  },
]

const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref)$/i

export function normalizePublicUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are supported.')
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
  }
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

export function backlinkIdempotencyKey(resourceUrl: string, productUrl: string): string {
  return createHash('sha256').update(`${normalizePublicUrl(resourceUrl)}\n${normalizePublicUrl(productUrl)}`).digest('hex').slice(0, 20)
}

function resourceForUrl(value: string): BacklinkResource {
  const normalized = normalizePublicUrl(value)
  const known = BUILTIN_BACKLINK_RESOURCES.find((resource) => normalizePublicUrl(resource.url) === normalized)
  if (known) return known
  const parsed = new URL(normalized)
  return {
    id: `custom-${parsed.hostname.replace(/[^a-z0-9]+/gi, '-')}`,
    name: parsed.hostname,
    url: normalized,
    route: 'other',
    audience: 'unknown',
    relevance: 'User-supplied candidate; confirm audience and discovery value before use.',
    source: 'user-supplied',
  }
}

function extractHtmlTitle(content: string): string | undefined {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(content)?.[1]
  return title?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined
}

export interface BacklinkPreflight {
  url: string
  statusCode?: number
  finalUrl?: string
  title?: string
  note: string
}

export interface BuildBacklinkPlanInput {
  productName: string
  productUrl: string
  description: string
  mode?: BacklinkMode
  route?: BacklinkResource['route']
  resourceUrls?: string[]
  maxCandidates?: number
  preflights?: BacklinkPreflight[]
}

export function buildBacklinkPlan(input: BuildBacklinkPlanInput): BacklinkPlan {
  const productUrl = normalizePublicUrl(input.productUrl)
  const mode = input.mode || 'quality'
  const sourceUrls = input.resourceUrls?.length ? input.resourceUrls : BUILTIN_BACKLINK_RESOURCES.map((resource) => resource.url)
  const uniqueUrls = [...new Set(sourceUrls.map(normalizePublicUrl))]
  const filtered = uniqueUrls
    .map(resourceForUrl)
    .filter((resource) => !input.route || resource.route === input.route)
  const limit = Math.max(1, Math.min(input.maxCandidates || (mode === 'quality' ? 10 : 50), mode === 'quality' ? 10 : 100))
  const selected = filtered.slice(0, limit)
  const preflights = new Map((input.preflights || []).map((item) => [normalizePublicUrl(item.url), item]))
  const candidates: BacklinkCandidate[] = selected.map((resource) => {
    const normalizedUrl = normalizePublicUrl(resource.url)
    const preflight = preflights.get(normalizedUrl)
    const exclusionReasons = [
      '候选来自外部资源清单，必须重新核验当前入口、受众、条款和收费状态。',
      ...(resource.historicalNote ? [resource.historicalNote] : []),
    ]
    if (resource.route === 'other') exclusionReasons.push('未识别为产品/软件/创业目录，需先确认是否属于允许的发布路线。')
    if (preflight?.statusCode !== undefined && (preflight.statusCode < 200 || preflight.statusCode >= 400)) {
      exclusionReasons.push(`预检返回 HTTP ${preflight.statusCode}，暂不提交。`)
    }
    const unavailable = preflight?.statusCode !== undefined && (preflight.statusCode < 200 || preflight.statusCode >= 400)
    return {
      id: resource.id,
      resource,
      normalizedUrl,
      idempotencyKey: backlinkIdempotencyKey(normalizedUrl, productUrl),
      status: unavailable ? 'unavailable' : 'not-attempted',
      qualityGate: unavailable ? 'failed' : 'not-checked',
      preflight: {
        checked: Boolean(preflight),
        ...(preflight?.statusCode === undefined ? {} : { statusCode: preflight.statusCode }),
        ...(preflight?.finalUrl ? { finalUrl: preflight.finalUrl } : {}),
        ...(preflight?.title ? { title: preflight.title } : {}),
        note: preflight?.note || '未联网预检；请在浏览器中打开并进行只读检查。',
      },
      exclusionReasons,
      nextAction: unavailable
        ? '不要重试提交；更换候选或先确认入口恢复。'
        : resource.route === 'developer-community'
          ? '先确认内容对社区有独立价值，再准备平台专用文章；不要复制官网宣传文案。'
          : '先只读核验受众、规则、收费、互链要求和登录/验证码，再决定是否手动提交。',
    }
  })
  const excluded = filtered.slice(selected.length).map((resource) => ({
    url: resource.url,
    reason: `超过本次 ${mode === 'quality' ? '质量模式最多 10 个' : '批量模式上限'} 候选；下一轮再处理。`,
  }))
  const manualQueue = candidates.filter((candidate) => candidate.status === 'not-attempted').map((candidate) => candidate.id)
  const source: BacklinkPlan['source'] = {
    kind: input.resourceUrls?.length ? 'user-supplied' : 'built-in-catalog',
    reference: input.resourceUrls?.length ? '用户提供的候选 URL' : BACKLINK_RESOURCE_SOURCE,
    candidateCount: uniqueUrls.length,
  }
  const shortDescription = input.description.trim().slice(0, 240)
  const longDescription = input.description.trim()
  return {
    version: '0.4.0',
    mode,
    status: candidates.some((candidate) => candidate.status === 'unavailable') ? 'partial' : 'ready',
    product: { name: input.productName.trim(), url: productUrl, canonicalUrl: productUrl },
    source,
    candidates,
    manualQueue,
    excluded,
    submissionPack: {
      shortDescription,
      longDescription,
      suggestedAnchor: input.productName.trim(),
      factsToVerify: ['产品名称和官网 URL', '产品用途和目标用户', '定价、发布状态和公司信息（如填写）', '平台要求的分类、Logo 和截图'],
      prohibitedClaims: ['保证排名、流量、收录或 dofollow', '虚构用户数、客户、价格、奖项或测评', '使用重复的精确商业关键词作为锚文本', '要求平台修改链接属性或绕过验证码/验证'],
    },
    guardrails: [
      '外链以产品发现、推荐访问和准确资料为目的，不以操纵排名或堆积链接为目的。',
      '质量模式每轮最多 10 个候选；先研究和预检，再逐个手动处理。',
      '插件不接收账号密码、Cookie、OTP、验证码或私有会话，也不绕过平台安全机制。',
      '用户完成平台操作后，用 geo_backlink_record 记录真实状态和公开证据；结果不明确时不要重试。',
    ],
    nextActions: [
      '先执行候选的只读预检，排除停服、无关、强制互链、只卖链接和明显低质量渠道。',
      '只对质量门槛通过的候选准备平台专用资料，使用品牌名或裸 URL，不批量复制同一篇文章。',
      '用户在平台完成提交、邮箱验证或人工审核后，记录 published、awaiting-email-verification、awaiting-approval 或 outcome-unknown。',
      '把推荐访问、转化、条目存活和资料准确性纳入下一轮手动效果评估，不把提交数量当成成功。',
    ],
  }
}

export interface BacklinkRecordEntry {
  idempotencyKey: string
  productUrl: string
  resourceUrl: string
  status: BacklinkStatus
  recordedAt: string
  publicUrl?: string
  anchorText?: string
  linkRel?: string
  evidence: string[]
  note?: string
}

function redactEvidence(value: string): string {
  return value
    .replace(/(password|passwd|token|secret|cookie|otp|authorization|bearer|session|recovery[-_ ]?code)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g, '[phone redacted]')
}

export function normalizeBacklinkRecord(input: {
  productUrl: string
  resourceUrl: string
  status: BacklinkStatus
  evidence?: string[]
  publicUrl?: string
  anchorText?: string
  linkRel?: string
  note?: string
  recordedAt?: string
}): BacklinkRecordEntry {
  const productUrl = normalizePublicUrl(input.productUrl)
  const resourceUrl = normalizePublicUrl(input.resourceUrl)
  return {
    idempotencyKey: backlinkIdempotencyKey(resourceUrl, productUrl),
    productUrl,
    resourceUrl,
    status: input.status,
    recordedAt: input.recordedAt || new Date().toISOString(),
    ...(input.publicUrl ? { publicUrl: normalizePublicUrl(input.publicUrl) } : {}),
    ...(input.anchorText?.trim() ? { anchorText: input.anchorText.trim() } : {}),
    ...(input.linkRel?.trim() ? { linkRel: input.linkRel.trim() } : {}),
    evidence: (input.evidence || []).map(redactEvidence).filter(Boolean),
    ...(input.note?.trim() ? { note: redactEvidence(input.note.trim()) } : {}),
  }
}

export function recordBacklinkEntry(existing: BacklinkRecordEntry[], entry: BacklinkRecordEntry): { entries: BacklinkRecordEntry[]; result: BacklinkRecordResult } {
  const terminal = new Set<BacklinkStatus>(['submitted', 'published', 'outcome-unknown'])
  const duplicate = existing.find((item) => item.idempotencyKey === entry.idempotencyKey)
  if (duplicate && terminal.has(duplicate.status) && entry.status === 'not-attempted') {
    return {
      entries: existing,
      result: {
        version: '0.4.0',
        path: '',
        status: duplicate.status,
        idempotencyKey: entry.idempotencyKey,
        recordedAt: entry.recordedAt,
        changed: false,
        evidence: duplicate.evidence,
        nextAction: '该候选已有终态记录；先核对公开页面、邮箱或平台后台，不要重复提交。',
      },
    }
  }
  const next = duplicate
    ? existing.map((item) => item.idempotencyKey === entry.idempotencyKey ? entry : item)
    : [...existing, entry]
  return {
    entries: next,
    result: {
      version: '0.4.0',
      path: '',
      status: entry.status,
      idempotencyKey: entry.idempotencyKey,
      recordedAt: entry.recordedAt,
      changed: true,
      evidence: entry.evidence,
      nextAction: entry.status === 'published'
        ? '记录公开页面 URL、实际 href/rel，并在下一轮手动评估推荐访问和转化。'
        : entry.status === 'outcome-unknown'
          ? '先核对平台后台、邮箱和公开页面，确认前不要再次提交。'
          : entry.status === 'awaiting-email-verification'
            ? '完成平台原生邮箱验证后，再用 geo_backlink_record 更新状态。'
            : entry.status === 'awaiting-approval'
              ? '等待平台审核；不要把提交动作当成已发布。'
              : '继续按候选的 nextAction 手动处理，并为每个结果留存可核验的公开证据。',
    },
  }
}

export function parseBacklinkRecordFile(content: string): BacklinkRecordEntry[] {
  if (!content.trim()) return []
  const parsed: unknown = JSON.parse(content)
  if (!Array.isArray(parsed)) throw new Error('Backlink record must be a JSON array.')
  return parsed as BacklinkRecordEntry[]
}

export function summarizeBacklinkRecords(entries: BacklinkRecordEntry[]): {
  total: number
  byStatus: Record<BacklinkStatus, number>
  published: BacklinkRecordEntry[]
  needsFollowUp: BacklinkRecordEntry[]
  errors: string[]
} {
  const statuses: BacklinkStatus[] = ['not-attempted', 'manual-required', 'submitted', 'awaiting-email-verification', 'awaiting-approval', 'published', 'outcome-unknown', 'failed', 'ineligible', 'unavailable']
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<BacklinkStatus, number>
  const errors: string[] = []
  const keys = new Set<string>()
  for (const entry of entries) {
    if (!statuses.includes(entry.status)) errors.push(`Unknown status: ${entry.status}`)
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1
    if (keys.has(entry.idempotencyKey)) errors.push(`Duplicate idempotency key: ${entry.idempotencyKey}`)
    keys.add(entry.idempotencyKey)
  }
  return {
    total: entries.length,
    byStatus,
    published: entries.filter((entry) => entry.status === 'published'),
    needsFollowUp: entries.filter((entry) => ['submitted', 'awaiting-email-verification', 'awaiting-approval', 'outcome-unknown'].includes(entry.status)),
    errors,
  }
}

export function extractPreflight(value: { statusCode: number; url: string; body: { kind: string; content: string } }, note: string, requestedUrl = value.url): BacklinkPreflight {
  return {
    url: requestedUrl,
    statusCode: value.statusCode,
    finalUrl: value.url,
    title: value.body.kind === 'html' ? extractHtmlTitle(value.body.content) : undefined,
    note,
  }
}
