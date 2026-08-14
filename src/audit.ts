import type { AuditFinding, AuditResult, ContentBrief, NoteSnapshot, Pillar, Severity } from './types.js'

export const AUDIT_RULE_VERSION = '0.2.0'

const severityByImpact: Array<[number, Severity]> = [
  [18, 'critical'],
  [14, 'high'],
  [9, 'medium'],
  [1, 'low'],
]

function severityFor(impact: number): Severity {
  return severityByImpact.find(([threshold]) => impact >= threshold)?.[1] || 'info'
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function auditNote(note: NoteSnapshot): AuditResult {
  const scores: Record<Pillar, number> = { seo: 100, geo: 100, aeo: 100 }
  const findings: AuditFinding[] = []
  const add = (pillar: Pillar, id: string, impact: number, message: string, evidence: string, recommendation: string) => {
    scores[pillar] -= impact
    findings.push({ id, pillar, severity: severityFor(impact), message, evidence, recommendation, scoreImpact: impact })
  }

  if (!note.title || note.title.length < 6) {
    add('seo', 'seo.title', 18, '标题不够明确', `当前标题：${note.title || '未检测到标题'}`, '使用包含主题和用户意图的具体标题。')
  }
  if (!note.primaryQuery) {
    add('seo', 'seo.primary-query', 12, '缺少主关键词或主题字段', '未检测到 dsh_geo_query、seo_keyword、keyword 或 topic。', '在 frontmatter 中补充 dsh_geo_query 或 topic。')
  }
  if (note.headings.length === 0) {
    add('seo', 'seo.headings', 10, '缺少分层标题', '正文没有 Markdown 标题。', '按用户问题拆分为 2-5 个清晰小节。')
  }
  if (note.headingLevels.some((level, index) => index > 0 && level - note.headingLevels[index - 1] > 1)) {
    add('seo', 'seo.heading-hierarchy', 6, '标题层级存在跳跃', '检测到从较低层级直接跳到更深层级的标题。', '保持 H1 → H2 → H3 的连续层级。')
  }
  if (note.wordCount < 120) {
    add('seo', 'seo.thin-content', 10, '正文信息密度偏低', `正文约 ${note.wordCount} 个词。`, '补充定义、过程、例子、边界和来源，不追求无意义扩写。')
  }
  if (note.internalLinks.length === 0) {
    add('seo', 'seo.internal-links', 8, '缺少知识库内部链接', '未检测到 [[WikiLink]]。', '至少连接一个上位主题和一个相关实践笔记。')
  }
  if (note.sourceUrls.length === 0) {
    add('seo', 'seo.sources', 14, '缺少可核验来源', '未检测到来源 URL 或引用字段。', '为事实、数据和外部结论补充来源、日期和适用边界。')
  }

  if (note.entities.length === 0) {
    add('geo', 'geo.entities', 18, '实体边界不清晰', '未检测到 brand、product、entity 或 topic 属性。', '明确本文讨论的品牌、产品、组织、平台或核心概念。')
  }
  if (!note.hasDefinition) {
    add('geo', 'geo.definition', 16, '缺少可直接引用的定义句', '首段没有检测到“是指/定义/means”等定义表达。', '在开头用一句话回答“它是什么、解决什么问题”。')
  }
  if (!note.hasFacts) {
    add('geo', 'geo.evidence', 12, '事实和证据表达不足', '未检测到明显数字、年份或来源归因。', '区分事实、观点和推断，并给关键事实补充来源。')
  }
  if (note.sourceUrls.length === 0) {
    add('geo', 'geo.provenance', 18, '来源链路不完整', '没有可供 AI 复核的外部来源。', '记录原始出处、发布时间、核验状态和使用边界。')
  }
  if (note.headings.length < 2) {
    add('geo', 'geo.chunkability', 8, '内容不利于分块检索', `当前仅有 ${note.headings.length} 个标题。`, '将长段落拆成独立、可引用、主题单一的内容块。')
  }
  if (!note.primaryQuery && note.entities.length === 0) {
    add('geo', 'geo.intent', 6, '主题意图不明确', '没有主问题、主题或实体信号。', '补充用户要解决的问题和本文覆盖范围。')
  }

  if (note.firstParagraph.length < 40) {
    add('aeo', 'aeo.direct-answer', 18, '首段缺少直接回答', `首段长度约 ${note.firstParagraph.length} 个字符。`, '开头先给出 1-3 句直接答案，再展开解释。')
  }
  if (note.questionHeadings.length === 0) {
    add('aeo', 'aeo.question-headings', 12, '缺少问题式小标题', '未检测到以问题或疑问词开头的标题。', '把用户真实提问转化为 H2/H3 标题。')
  }
  if (note.listCount + note.tableCount === 0) {
    add('aeo', 'aeo.answer-format', 8, '缺少结构化答案格式', '未检测到列表或表格。', '对步骤、比较项、条件和结论使用列表或表格。')
  }
  if (!note.hasNextStep) {
    add('aeo', 'aeo.next-step', 6, '缺少下一步行动', '未检测到行动建议或下一步。', '结尾补充读者下一步可以执行的动作。')
  }

  const score = {
    seo: clampScore(scores.seo),
    geo: clampScore(scores.geo),
    aeo: clampScore(scores.aeo),
  }
  const overall = clampScore((score.seo + score.geo + score.aeo) / 3)
  const topActions = [...findings]
    .sort((a, b) => b.scoreImpact - a.scoreImpact)
    .slice(0, 5)
    .map((finding) => `${finding.pillar.toUpperCase()}：${finding.recommendation}`)
  return {
    target: note.path,
    generatedAt: new Date().toISOString(),
    ruleVersion: AUDIT_RULE_VERSION,
    confidence: note.truncated ? 0.65 : 0.9,
    unknownReasons: note.truncated ? ['内容超过 maxTextChars，部分判断可能基于截断内容。'] : [],
    truncated: note.truncated,
    scores: { ...score, overall },
    stats: {
      wordCount: note.wordCount,
      headings: note.headings.length,
      internalLinks: note.internalLinks.length,
      externalLinks: note.externalLinks.length,
      sources: note.sourceUrls.length,
      entities: note.entities.length,
      questions: note.questionHeadings.length,
    },
    findings,
    topActions,
  }
}

export function createContentBrief(note: NoteSnapshot, audit: AuditResult): ContentBrief {
  const query = note.primaryQuery || note.title
  const intent = note.frontmatter.dsh_geo_intent || note.frontmatter.geo_intent || '信息理解与决策支持'
  const audience = note.frontmatter.audience || note.frontmatter.scope || '需要快速理解并执行该主题的读者'
  const questions = note.questionHeadings.length > 0
    ? note.questionHeadings
    : [`什么是${query}？`, `${query}适合什么场景？`, `如何判断${query}是否有效？`, `${query}有哪些常见误区？`]
  return {
    source: note.path,
    topic: query,
    intent: String(intent),
    audience: String(audience),
    scores: audit.scores,
    recommendedTitle: `${query}：定义、方法、场景与常见问题`,
    directAnswer: note.firstParagraph || `本文解释${query}的核心定义、适用场景和执行方法。`,
    outline: [
      `一、${query}是什么`,
      `二、${query}解决什么问题`,
      `三、执行步骤与判断标准`,
      `四、常见问题与边界`,
      '五、来源与下一步行动',
    ],
    questions,
    entities: note.entities,
    sourceGaps: note.sourceUrls.length === 0 ? ['补充原始来源、日期、核验状态和适用边界'] : [],
    nextActions: audit.topActions,
  }
}
