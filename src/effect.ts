import type { EffectPerformanceRow, EffectReview, EffectReviewStatus, EffectSnapshot } from './types.js'

type MetricKey = Exclude<keyof EffectSnapshot, 'period' | 'source'>

const METRICS: Array<{ key: MetricKey; label: string; higherIsBetter: boolean }> = [
  { key: 'impressions', label: '展现', higherIsBetter: true },
  { key: 'clicks', label: '点击', higherIsBetter: true },
  { key: 'ctrPercent', label: 'CTR（百分比）', higherIsBetter: true },
  { key: 'averagePosition', label: '平均排名位置', higherIsBetter: false },
  { key: 'conversions', label: '转化', higherIsBetter: true },
  { key: 'indexedPages', label: '已收录页面', higherIsBetter: true },
  { key: 'referralVisits', label: '推荐访问', higherIsBetter: true },
  { key: 'referralConversions', label: '推荐转化', higherIsBetter: true },
]

function metricValue(snapshot: EffectSnapshot, key: MetricKey): number | undefined {
  const value = snapshot[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function changePercent(baseline: number, delta: number): number | undefined {
  if (baseline === 0) return undefined
  return Number((delta / Math.abs(baseline) * 100).toFixed(2))
}

export function buildEffectReview(input: { target: string; baseline: EffectSnapshot; current: EffectSnapshot; rows?: EffectPerformanceRow[] }): EffectReview {
  let improved = 0
  let declined = 0
  let comparable = 0
  const changes: EffectReview['changes'] = []
  for (const metric of METRICS) {
    const before = metricValue(input.baseline, metric.key)
    const after = metricValue(input.current, metric.key)
    if (before === undefined || after === undefined) {
      changes.push({
        metric: metric.label,
        ...(before === undefined ? {} : { baseline: before }),
        ...(after === undefined ? {} : { current: after }),
        direction: 'unknown',
        interpretation: '缺少可比较的前后周期数据，不能判断变化。',
      })
      continue
    }
    comparable += 1
    const delta = Number((after - before).toFixed(4))
    const relativeChangePercent = changePercent(before, delta)
    const direction = delta === 0 ? 'unchanged' : delta > 0 ? 'up' : 'down'
    if (delta !== 0) {
      if ((metric.higherIsBetter && delta > 0) || (!metric.higherIsBetter && delta < 0)) improved += 1
      else declined += 1
    }
    const interpretation = delta === 0
      ? '前后周期没有变化。'
      : metric.key === 'averagePosition'
        ? delta < 0 ? '数值下降代表平均排名位置改善。' : '数值上升代表平均排名位置变差。'
        : metric.higherIsBetter
          ? delta > 0 ? '数值上升，属于正向变化。' : '数值下降，属于负向变化。'
          : delta > 0 ? '数值上升，属于负向变化。' : '数值下降，属于正向变化。'
    changes.push({
      metric: metric.label,
      baseline: before,
      current: after,
      delta,
      ...(relativeChangePercent === undefined ? {} : { relativeChangePercent }),
      direction,
      interpretation,
    })
  }
  const status: EffectReviewStatus = comparable === 0
    ? 'inconclusive'
    : improved > 0 && declined > 0
      ? 'mixed'
      : improved > 0
        ? 'improving'
        : declined > 0
          ? 'declining'
          : 'inconclusive'
  const dataQuality: EffectReview['dataQuality'] = comparable >= 3 ? 'comparable' : comparable > 0 ? 'partial' : 'insufficient'
  const opportunities: EffectReview['opportunities'] = []
  const anomalies: string[] = []
  const rows = input.rows || []
  for (const row of rows) {
    if (row.impressions !== undefined && row.clicks !== undefined && row.clicks > row.impressions) anomalies.push(`${row.query || row.page || '未命名行'}：clicks 大于 impressions，检查导入口径。`)
    if (row.ctrPercent !== undefined && (row.ctrPercent < 0 || row.ctrPercent > 100)) anomalies.push(`${row.query || row.page || '未命名行'}：CTR 超出 0～100%，检查单位是否传成小数。`)
    if (row.averagePosition !== undefined && row.averagePosition > 8 && row.averagePosition <= 20 && (row.impressions || 0) > 0) {
      opportunities.push({
        type: 'striking-distance',
        ...(row.query ? { query: row.query } : {}),
        ...(row.page ? { page: row.page } : {}),
        evidence: `平均排名位置 ${row.averagePosition}，展现 ${row.impressions || 0}；属于可优先推动的第二页/临界机会。`,
        nextAction: '回到 geo_workflow，检查该查询对应页面的意图覆盖、直接答案、内部链接和来源证据。',
      })
    }
    if (row.impressions !== undefined && row.impressions >= 100 && row.ctrPercent !== undefined && row.ctrPercent < 2) {
      opportunities.push({
        type: 'low-ctr',
        ...(row.query ? { query: row.query } : {}),
        ...(row.page ? { page: row.page } : {}),
        evidence: `展现 ${row.impressions}，CTR ${row.ctrPercent}%；这是启发式提示，不是行业基准结论。`,
        nextAction: '重新检查标题、摘要、页面承诺和搜索意图，确认 SERP 文案与正文一致。',
      })
    }
    if (row.indexed === false) {
      opportunities.push({
        type: 'indexing',
        ...(row.query ? { query: row.query } : {}),
        ...(row.page ? { page: row.page } : {}),
        evidence: row.indexNote || '导入数据标记为未收录。',
        nextAction: '检查 URL 检查、canonical、robots、Sitemap、内部链接和页面质量。',
      })
    }
  }
  const queryPages = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.query || !row.page) continue
    const pages = queryPages.get(row.query.toLocaleLowerCase()) || new Set<string>()
    pages.add(row.page)
    queryPages.set(row.query.toLocaleLowerCase(), pages)
  }
  for (const [query, pages] of queryPages) {
    if (pages.size > 1) {
      opportunities.push({
        type: 'cannibalization',
        query,
        evidence: `同一查询对应 ${pages.size} 个页面：${[...pages].join('、')}。`,
        nextAction: '选择一个主页面，其他页面改为支持性内容或重新分配搜索意图。',
      })
    }
  }
  const nextActions: string[] = []
  if (dataQuality === 'insufficient') nextActions.push('补充同一页面、同一地区/设备口径和相邻周期的 Search Console 或站点分析数据。')
  if (status === 'declining' || status === 'mixed') {
    if (changes.some((change) => change.metric === '展现' && change.interpretation.includes('负向'))) nextActions.push('重新运行 geo_workflow，检查主题覆盖、收录边界、标题和搜索意图是否匹配。')
    if (changes.some((change) => (change.metric === '点击' || change.metric === 'CTR（百分比）') && change.interpretation.includes('负向'))) nextActions.push('重新检查标题、摘要、直接答案和页面承诺，避免搜索结果承诺与正文不一致。')
    if (changes.some((change) => change.metric === '平均排名位置' && change.interpretation.includes('变差'))) nextActions.push('重新审计内部链接、来源、内容深度和页面之间的主题关系。')
    if (changes.some((change) => (change.metric === '推荐访问' || change.metric === '推荐转化') && change.interpretation.includes('负向'))) nextActions.push('审计 geo_backlink_record 中的渠道相关性、公开条目准确性和真实推荐访问，不以提交数量替代效果。')
  }
  if (status === 'improving') nextActions.push('保留本次变更和数据口径，继续观察一个相邻周期，再决定是否扩大内容或分发范围。')
  if (opportunities.some((opportunity) => opportunity.type === 'striking-distance')) nextActions.push('优先处理第二页机会词，再扩大新的主题范围。')
  if (opportunities.some((opportunity) => opportunity.type === 'indexing')) nextActions.push('先处理未收录页面的技术和质量问题，不要用内容改写掩盖抓取/索引问题。')
  if (anomalies.length > 0) nextActions.push('先修正导入数据口径，再使用效果结论指导下一轮诊断。')
  if (nextActions.length === 0) nextActions.push('记录本次结果，下一周期继续使用相同口径复查；出现新问题时回到 geo_workflow 或 geo_audit_note。')
  return {
    version: '0.4.0',
    target: input.target,
    status,
    baseline: input.baseline,
    current: input.current,
    changes,
    opportunities,
    anomalies,
    dataQuality,
    nextActions,
    limitations: [
      '这是基于用户提供数据的定性复盘，不证明变化由某一次内容或外链动作单独造成。',
      'CTR 使用百分比数值，例如 2.4 表示 2.4%，不要混用 0.024。',
      '插件不会连接 Search Console、站点分析或外链平台，也不会编造缺失指标。',
    ],
  }
}
