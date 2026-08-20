import type { WebRuntime, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { AuditResult, ContentBrief, KeywordCandidate, KeywordIntent, KeywordOpportunityMap, KeywordPlan, KnowledgeSignal, NoteSnapshot, ProductionPlan, SeoSop, SeoStandardReport, SourceType } from './types.js'

interface SearchLike {
  search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<WebSearchResult>
}

function cleanTerm(value: string): string {
  return value
    .replace(/^[-*#>\s]+/, '')
    .replace(/[，。！？；：、,.!?;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map(cleanTerm)) {
    const key = value.toLocaleLowerCase()
    if (value && !seen.has(key)) {
      seen.add(key)
      result.push(value)
    }
  }
  return result
}

function intentOf(term: string, role: KeywordCandidate['role']): KeywordIntent {
  if (role === 'question') return 'informational'
  if (/购买|价格|报价|对比|评测|buy|price|compare|review/i.test(term)) return 'commercial'
  if (/登录|官网|主页|official|login|homepage/i.test(term)) return 'navigational'
  if (/下载|注册|预约|购买|download|sign up|subscribe/i.test(term)) return 'transactional'
  return 'informational'
}

function roleOf(term: string, note: NoteSnapshot, primaryKeyword: string): KeywordCandidate['role'] {
  if (term === primaryKeyword) return 'primary'
  if (note.questionHeadings.some((question) => cleanTerm(question).toLocaleLowerCase() === term.toLocaleLowerCase()) || /[?？]|^(如何|什么|为什么|哪些|how|what|why|which|can|does)\b/i.test(term)) return 'question'
  if (note.entities.some((entity) => entity.toLocaleLowerCase() === term.toLocaleLowerCase())) return 'entity'
  return 'secondary'
}

function seedTerms(note: NoteSnapshot, seeds: string[]): string[] {
  return unique([
    ...seeds,
    note.primaryQuery || '',
    note.title,
    ...note.headings.slice(0, 8),
    ...note.entities.slice(0, 8),
    ...note.questionHeadings.slice(0, 6),
  ]).slice(0, 24)
}

function relatedKnowledge(note: NoteSnapshot, knowledgeNotes: NoteSnapshot[]): KnowledgeSignal[] {
  const anchors = unique([
    note.primaryQuery || '',
    note.title,
    ...note.entities.slice(0, 8),
    ...note.headings.slice(0, 8),
  ]).filter((term) => term.length >= 2).slice(0, 16)
  const sourcePath = note.path.toLocaleLowerCase()
  return knowledgeNotes
    .filter((candidate) => candidate.path.toLocaleLowerCase() !== sourcePath)
    .map((candidate) => {
      const searchable = [candidate.title, candidate.primaryQuery || '', ...candidate.headings, ...candidate.entities].join('\n').toLocaleLowerCase()
      const matchedTerms = anchors.filter((term) => searchable.includes(term.toLocaleLowerCase())).slice(0, 8)
      const candidateTerms = unique([
        candidate.primaryQuery || '',
        ...candidate.headings.slice(0, 5),
        ...candidate.entities.slice(0, 5),
      ]).filter((term) => !matchedTerms.some((matched) => matched.toLocaleLowerCase() === term.toLocaleLowerCase())).slice(0, 8)
      return {
        path: candidate.path,
        title: candidate.title,
        score: matchedTerms.length * 10 + Math.min(candidate.wordCount, 500) / 100,
        matchedTerms,
        candidateTerms,
        excerpt: candidate.content.replace(/\s+/g, ' ').trim().slice(0, 800),
      }
    })
    .filter((signal) => signal.matchedTerms.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

function searchQueries(primary: string, note: NoteSnapshot): string[] {
  const suffix = /[\u3400-\u9fff]/.test(primary) ? ['常见问题', '使用方法'] : ['common questions', 'how to use']
  return unique([primary, ...suffix.map((item) => `${primary} ${item}`), note.title]).slice(0, 3)
}

export async function buildKeywordPlan(
  note: NoteSnapshot,
  _audit: AuditResult,
  web: SearchLike | WebRuntime | undefined,
  seeds: string[] = [],
  signal?: AbortSignal,
  knowledgeNotes: NoteSnapshot[] = [],
  seoStandard?: SeoStandardReport,
): Promise<KeywordPlan> {
  const knowledgeSignals = relatedKnowledge(note, knowledgeNotes)
  const knowledgeTerms = knowledgeSignals.flatMap((signal) => signal.candidateTerms)
  const terms = seedTerms(note, [...seeds, ...knowledgeTerms])
  const primaryKeyword = cleanTerm(seeds[0] || note.primaryQuery || note.title)
  const observed = new Set<string>()
  const searchSignals: KeywordPlan['searchSignals'] = []
  const unknownReasons: string[] = []
  let searchSucceeded = false
  if (web && primaryKeyword) {
    for (const query of searchQueries(primaryKeyword, note)) {
      try {
        const result = await web.search({ query, maxResults: 5 }, signal)
        const observedTitles = result.sources.map((source) => cleanTerm(source.title || source.snippet || '')).filter(Boolean).slice(0, 5)
        searchSignals.push({
          query,
          sourceUrls: result.sources.map((source) => source.url).slice(0, 5),
          observedTitles,
        })
        observedTitles.forEach((title) => observed.add(title))
        searchSucceeded = true
      } catch (error) {
        unknownReasons.push(`Search signal unavailable for "${query}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } else {
    unknownReasons.push('No web search provider is available; keyword recommendations use the source text and supplied seeds only.')
  }

  const candidates = unique([...terms, ...observed]).slice(0, 36).map((term) => {
    const role = roleOf(term, note, primaryKeyword)
    const evidence = role === 'primary'
      ? ['source primary query or user-supplied seed']
      : note.headings.includes(term)
        ? ['source heading']
        : note.entities.includes(term)
          ? ['source entity']
          : knowledgeTerms.some((candidate) => candidate.toLocaleLowerCase() === term.toLocaleLowerCase())
            ? ['related local knowledge-base note signal']
            : searchSignals.some((signal) => signal.observedTitles.includes(term))
            ? ['qualitative search result title/snippet signal']
            : ['source text signal']
    return { term, role, intent: intentOf(term, role), evidence }
  })
  const seoGuidance = seoStandard?.checks
    .filter((item) => item.status === 'warn')
    .slice(0, 6)
    .map((item) => `${item.id}: ${item.recommendation}`) || []
  const adjustments = [
    primaryKeyword ? `Use "${primaryKeyword}" as the single primary query in the title, H1 and opening answer.` : 'Choose one explicit primary query before drafting.',
    'Map each secondary term to one section or supporting paragraph; do not repeat variants unnaturally.',
    'Turn question terms into H2/H3 questions and answer each one directly before adding context.',
    'Use entities to define scope and relationships, not as a disconnected keyword list.',
    ...seoGuidance,
    'Search signals are qualitative only; do not claim search volume, ranking difficulty or traffic without a dedicated data source.',
  ]
  return {
    status: searchSucceeded ? (unknownReasons.length > 0 ? 'partial' : 'ready') : 'seeds-only',
    dataQuality: searchSucceeded ? 'qualitative' : 'seed-only',
    volumeDataAvailable: false,
    primaryKeyword,
    candidates,
    searchSignals,
    knowledgeSignals,
    seoGuidance,
    adjustments,
    unknownReasons,
  }
}

export function buildProductionPlan(brief: ContentBrief, audit: AuditResult, keywordPlan: KeywordPlan, opportunityMap?: KeywordOpportunityMap): ProductionPlan {
  return {
    contentInputs: {
      source: [
        `Source: ${brief.source}`,
        `Topic: ${brief.topic}`,
        `Intent: ${brief.intent}`,
        `Audience: ${brief.audience}`,
        `Direct answer: ${brief.directAnswer}`,
        ...(brief.sourceGaps.length > 0 ? [`Source gaps: ${brief.sourceGaps.join('; ')}`] : []),
      ],
      knowledgeBase: keywordPlan.knowledgeSignals.length > 0
        ? keywordPlan.knowledgeSignals.map((signal) => `${signal.title} (${signal.path}) — matched: ${signal.matchedTerms.join(', ')}; candidate terms: ${signal.candidateTerms.join(', ')}; local excerpt: ${signal.excerpt}`)
        : ['No related local knowledge-base notes were found or knowledge-base context was not enabled.'],
      seoStandard: keywordPlan.seoGuidance.length > 0
        ? keywordPlan.seoGuidance
        : ['No current Google-standard warning was raised by the available source; keep deployment-level checks marked unknown until HTML/Search Console validation.'],
      keywordMap: [
        ...keywordPlan.candidates.slice(0, 18).map((candidate) => `${candidate.role}/${candidate.intent}: ${candidate.term} — ${candidate.evidence.join(', ')}`),
        ...(opportunityMap ? opportunityMap.clusters.slice(0, 12).map((cluster) => `Opportunity cluster/${cluster.priority}: ${cluster.name} — target pages: ${cluster.targetPages.join(', ') || 'unassigned'}; terms: ${cluster.terms.slice(0, 8).join(', ')}`) : []),
        ...(opportunityMap ? opportunityMap.cannibalization.slice(0, 8).map((item) => `Cannibalization: ${item.term} — ${item.targetPages.join(', ')}`) : []),
      ],
    },
    stages: [
      {
        id: 'diagnose',
        objective: 'Fix the highest-impact evidence-backed issues before expanding the page.',
        actions: audit.topActions.slice(0, 5),
        deliverable: 'A prioritized diagnosis with facts, gaps and boundaries clearly separated.',
      },
      {
        id: 'keyword-map',
        objective: 'Assign search intent and entities to sections so the draft has one job per block.',
        actions: keywordPlan.adjustments.slice(0, 4),
        deliverable: 'A primary query, supporting terms, question headings and entity scope.',
      },
      {
        id: 'draft',
        objective: 'Produce a useful answer that a search engine and an answer engine can quote accurately.',
        actions: [
          `Open with the direct answer: ${brief.directAnswer}`,
          `Use this outline: ${brief.outline.join(' → ')}`,
          'Include concrete examples, constraints, source links and a next action; avoid unsupported claims.',
        ],
        deliverable: 'A complete Markdown draft with title, answer-first opening, structured sections, FAQ and provenance.',
      },
      {
        id: 'verify',
        objective: 'Re-audit the draft and confirm that improvements did not remove evidence or useful links.',
        actions: [
          'Run geo_audit_note again and compare SEO/GEO/AEO scores with the baseline.',
          'Run geo_source_check and verify each important claim has an appropriate source.',
          'Preview the complete replacement and write back only after reviewing the diff.',
        ],
        deliverable: 'A verified Markdown update plus a short record of remaining unknowns.',
      },
    ],
    draftContract: {
      requiredSections: [
        `Answer the primary query: ${keywordPlan.primaryKeyword || brief.topic}`,
        'Definition and scope',
        'Method, criteria or step-by-step guidance',
        'Common questions and boundary conditions',
        'Sources and next action',
      ],
      evidenceRules: [
        'Separate facts, opinions and inferences.',
        'Attach source URLs and dates to claims that can change.',
        'Do not invent search volume, rankings, customer results or citations.',
      ],
      outputFormat: 'Markdown with one clear H1, sequential H2/H3 headings, short answer-first paragraphs, lists/tables where useful, and source links.',
    },
    writebackInstructions: [
      'For an existing Markdown note, call geo_preview_content with the complete replacement.',
      'For a new note, set createIfMissing=true and preview the destination path inside defaultRoot.',
      'After reviewing the diff, call geo_apply_content with path and previewToken; the token binds the exact content.',
    ],
  }
}

export function buildSeoSop(input: {
  source: string
  sourceType: SourceType
  sourceTruncated: boolean
  goal?: string
  audience?: string
  knowledgeBaseEnabled: boolean
  knowledgeBaseIssues?: string[]
  audit: AuditResult
  keywordPlan: KeywordPlan
  brief: ContentBrief
}): SeoSop {
  const effectiveGoal = input.goal || input.brief.intent
  const effectiveAudience = input.audience || input.brief.audience
  const currentStep = input.sourceTruncated
    ? 'connect-source'
    : input.keywordPlan.status === 'partial' || (input.knowledgeBaseIssues?.length || 0) > 0
      ? 'keyword-map'
      : 'draft'
  return {
    name: '标准 SEO/GEO/AEO 内容生产 SOP',
    version: '0.4.0',
    mode: 'read-only',
    currentStep,
    steps: [
      {
        id: 'define-goal',
        order: 1,
        title: '明确目标和受众',
        status: 'completed',
        objective: '把业务目标、受众和页面动作写成可检查的内容任务。',
        inputs: [`目标：${effectiveGoal}`, `受众：${effectiveAudience}`],
        outputs: ['目标卡：目标、受众、主题意图和下一步动作。'],
        completionCriteria: ['目标和受众已经记录；未提供时使用了可见的默认推断。'],
        nextAction: '确认目标和受众是否正确；若不正确，重新运行 geo_workflow 并补充 goal/audience。',
      },
      {
        id: 'connect-source',
        order: 2,
        title: '接入并确认来源',
        status: input.sourceTruncated ? 'ready' : 'completed',
        objective: '确认来源类型、访问方式、最终 URL、HTTP 状态和内容是否完整。',
        inputs: [`来源：${input.source}`, `来源类型：${input.sourceType}`],
        outputs: ['来源快照、访问限制、截断状态和隐私边界。'],
        completionCriteria: ['来源可读取；公开 URL 为 2xx/3xx；本地文件位于 defaultRoot；没有未解释的截断。'],
        nextAction: input.sourceTruncated
          ? '来源超过读取上限；导出更聚焦的 Markdown/HTML 快照或拆分内容后重新运行。'
          : '进入基线诊断。',
      },
      {
        id: 'baseline-audit',
        order: 3,
        title: '建立 SEO/GEO/AEO 基线',
        status: 'completed',
        objective: '先看证据、标准检查和 unknown，再决定改什么。',
        inputs: ['来源正文和元数据', 'Google 标准 SEO 检查清单'],
        outputs: [`SEO/GEO/AEO 分数：${input.audit.scores.seo}/${input.audit.scores.geo}/${input.audit.scores.aeo}`, `Google 标准：${input.audit.seoStandard.summary.pass} pass、${input.audit.seoStandard.summary.warn} warn、${input.audit.seoStandard.summary.unknown} unknown`, ...input.audit.topActions.slice(0, 3)],
        completionCriteria: ['高影响发现有证据；部署级事实没有被 unknown 冒充为已验证。'],
        nextAction: '只选择影响最大且有证据支持的 1-3 个问题进入关键词与内容规划。',
      },
      {
        id: 'keyword-map',
        order: 4,
        title: '建立关键词和意图地图',
        status: input.keywordPlan.status === 'partial' || (input.knowledgeBaseIssues?.length || 0) > 0 ? 'ready' : 'completed',
        objective: '让关键词服务页面结构，而不是生成孤立的词表。',
        inputs: ['来源主题和 frontmatter', input.knowledgeBaseEnabled ? 'defaultRoot 相关笔记和受限本地摘录' : '未启用本地知识库', '公开搜索定性信号（如适用）', 'Google 标准警告'],
        outputs: [`主查询：${input.keywordPlan.primaryKeyword || '未确定'}`, `候选词：${input.keywordPlan.candidates.length} 个`, `数据质量：${input.keywordPlan.dataQuality}`, `相关知识库笔记：${input.keywordPlan.knowledgeSignals.length} 篇`],
        completionCriteria: ['一个主查询已确定；次级主题、问题词和实体已分配到具体章节；搜索量缺失被明确标记。'],
        nextAction: input.keywordPlan.status === 'partial' || (input.knowledgeBaseIssues?.length || 0) > 0
          ? '检查公开搜索或知识库读取问题；在不影响隐私的前提下补充外部关键词数据或继续使用 seed-only。'
          : '进入内容 Brief 和信息架构。',
      },
      {
        id: 'content-brief',
        order: 5,
        title: '生成内容 Brief 和信息架构',
        status: 'completed',
        objective: '把来源、知识库、SEO 规范和关键词地图合并成写作规格。',
        inputs: ['source', 'knowledgeBase', 'seoStandard', 'keywordMap'],
        outputs: [`推荐标题：${input.brief.recommendedTitle}`, `章节数：${input.brief.outline.length}`, `问题数：${input.brief.questions.length}`, `来源缺口：${input.brief.sourceGaps.length}`],
        completionCriteria: ['有直接答案、受众、意图、大纲、问题、来源缺口和下一步动作。'],
        nextAction: '使用 productionPlan.contentInputs 和 draftContract 生成 Markdown 草稿。',
      },
      {
        id: 'draft',
        order: 6,
        title: '按输入契约生产内容',
        status: 'ready',
        objective: '生成有用、可读、可引用且保留事实边界的 Markdown。',
        inputs: ['productionPlan.contentInputs', 'productionPlan.draftContract', '原始来源和相关知识库摘录'],
        outputs: ['完整 Markdown 草稿：标题、直接答案、分层正文、FAQ、来源和下一步。'],
        completionCriteria: ['草稿覆盖主查询和用户任务；事实有来源；没有虚构搜索量、排名、引用或客户结果。'],
        nextAction: '让 Harness 生成草稿，但不要直接覆盖原文件；先进入验证和预览。',
      },
      {
        id: 'verify',
        order: 7,
        title: '验证内容和部署边界',
        status: 'ready',
        objective: '确认优化没有损坏事实、来源、链接和知识结构。',
        inputs: ['草稿', 'seoStandard', '基线审计'],
        outputs: ['重新审计结果、来源检查结果、剩余 unknown 和差异说明。'],
        completionCriteria: ['高影响问题有改善证据；关键来源存在；新增事实有日期/边界；unknown 仍被保留。'],
        nextAction: '运行 geo_audit_note 和 geo_source_check，再请求完整 Markdown diff。',
      },
      {
        id: 'preview-writeback',
        order: 8,
        title: '预览并安全写回',
        status: 'ready',
        objective: '让每次修改可审阅、可回退且不会覆盖并发更新。',
        inputs: ['目标 Markdown 路径', '完整草稿'],
        outputs: ['diff、旧/新哈希、previewToken 和版本保护结果。'],
        completionCriteria: ['用户检查 diff；目标在 defaultRoot 内；写回使用有效 previewToken。'],
        nextAction: '明确确认后调用 geo_apply_content；若文件变化，重新预览，不强行写入。',
      },
      {
        id: 're-audit',
        order: 9,
        title: '写回后复查和迭代',
        status: 'ready',
        objective: '用同一套标准比较优化前后，而不是凭感觉结束任务。',
        inputs: ['写回后的当前文件', '原始基线审计'],
        outputs: ['前后分数、发现项变化、来源变化、剩余工作清单。'],
        completionCriteria: ['高优先级问题有明确结果；未完成项有下一次迭代动作。'],
        nextAction: '使用 Search Console、PageSpeed 或站点分析补充插件无法证明的部署级数据；如需产品发现分发，再运行 geo_backlink_plan，完成手动提交后记录结果。',
      },
    ],
    completionCriteria: [
      '目标、受众和页面动作明确。',
      '来源类型、访问限制、截断和隐私边界明确。',
      '主查询、关键词地图、内容 Brief 和四类生产输入齐全。',
      '草稿通过 SEO/GEO/AEO、来源和结构复查。',
      '写回前检查 diff，写回后重新审计。',
      '如启用外链分支，候选经过质量核验，平台动作由用户手动完成，结果和公开证据已记录。',
      'Sitemap、Search Console、Core Web Vitals、真实收录和流量等外部数据另行验证。',
    ],
    limitations: [
      '当前结果是只读 SOP 和生产契约；插件不会在没有 Harness 模型参与的情况下自行生成事实性文章。',
      '搜索量、排名难度、收录、点击和转化不由插件编造，必须使用独立数据源。',
      '外链工具只做匿名预检、提交准备和结果记录，不替代平台原生登录/表单，也不绕过验证码或安全验证。',
    ],
  }
}
