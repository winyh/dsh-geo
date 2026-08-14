import type { WebRuntime, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { AuditResult, ContentBrief, KeywordCandidate, KeywordIntent, KeywordPlan, NoteSnapshot, ProductionPlan } from './types.js'

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
): Promise<KeywordPlan> {
  const terms = seedTerms(note, seeds)
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
          : searchSignals.some((signal) => signal.observedTitles.includes(term))
            ? ['qualitative search result title/snippet signal']
            : ['source text signal']
    return { term, role, intent: intentOf(term, role), evidence }
  })
  const adjustments = [
    primaryKeyword ? `Use "${primaryKeyword}" as the single primary query in the title, H1 and opening answer.` : 'Choose one explicit primary query before drafting.',
    'Map each secondary term to one section or supporting paragraph; do not repeat variants unnaturally.',
    'Turn question terms into H2/H3 questions and answer each one directly before adding context.',
    'Use entities to define scope and relationships, not as a disconnected keyword list.',
    'Search signals are qualitative only; do not claim search volume, ranking difficulty or traffic without a dedicated data source.',
  ]
  return {
    status: searchSucceeded ? (unknownReasons.length > 0 ? 'partial' : 'ready') : 'seeds-only',
    dataQuality: searchSucceeded ? 'qualitative' : 'seed-only',
    volumeDataAvailable: false,
    primaryKeyword,
    candidates,
    searchSignals,
    adjustments,
    unknownReasons,
  }
}

export function buildProductionPlan(brief: ContentBrief, audit: AuditResult, keywordPlan: KeywordPlan): ProductionPlan {
  return {
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
