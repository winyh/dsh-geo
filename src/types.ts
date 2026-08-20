export type Pillar = 'seo' | 'geo' | 'aeo'

export type SourceType = 'public-url' | 'local-markdown' | 'private-snapshot'

export type KeywordRole = 'primary' | 'secondary' | 'question' | 'entity'

export type KeywordIntent = 'informational' | 'commercial' | 'navigational' | 'transactional' | 'unknown'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type SeoCheckStatus = 'pass' | 'warn' | 'unknown'

export type SeoCheckArea = 'content' | 'crawl-index' | 'search-presentation' | 'links' | 'media' | 'monitoring'

export interface Frontmatter {
  [key: string]: unknown
}

export interface TechnicalSeoSnapshot {
  htmlTitle?: string
  metaDescription?: string
  canonicalUrl?: string
  robots?: string
  hreflangCount: number
  structuredDataTypes: string[]
  imageCount: number
  imagesMissingAlt: number
  hasViewport: boolean
  hasLang: boolean
}

export interface SeoStandardCheck {
  id: string
  area: SeoCheckArea
  status: SeoCheckStatus
  evidence: string
  recommendation: string
}

export interface SeoStandardReport {
  framework: string
  ruleVersion: string
  checks: SeoStandardCheck[]
  summary: {
    pass: number
    warn: number
    unknown: number
  }
  limitations: string[]
  references: string[]
}

export interface NoteSnapshot {
  path: string
  title: string
  content: string
  frontmatter: Frontmatter
  headings: string[]
  headingLevels: number[]
  wordCount: number
  internalLinks: string[]
  externalLinks: string[]
  sourceUrls: string[]
  questionHeadings: string[]
  listCount: number
  tableCount: number
  firstParagraph: string
  primaryQuery?: string
  entities: string[]
  hasDefinition: boolean
  hasFacts: boolean
  hasNextStep: boolean
  truncated: boolean
  language: 'zh' | 'en' | 'mixed' | 'unknown'
  technical?: TechnicalSeoSnapshot
}

export interface AuditFinding {
  id: string
  pillar: Pillar
  severity: Severity
  message: string
  evidence: string
  recommendation: string
  scoreImpact: number
}

export interface AuditResult {
  target: string
  generatedAt: string
  ruleVersion: string
  confidence: number
  unknownReasons: string[]
  truncated: boolean
  scores: {
    seo: number
    geo: number
    aeo: number
    overall: number
  }
  stats: {
    wordCount: number
    headings: number
    internalLinks: number
    externalLinks: number
    sources: number
    entities: number
    questions: number
  }
  seoStandard: SeoStandardReport
  findings: AuditFinding[]
  topActions: string[]
}

export interface VaultFileRecord {
  path: string
  title: string
  wordCount: number
  status?: string
  type?: string
  updated?: string
  internalLinks: string[]
  sourceUrls: string[]
  audit: AuditResult
}

export interface VaultAuditResult {
  root: string
  generatedAt: string
  ruleVersion: string
  scannedFiles: number
  skippedFiles: number
  errors: string[]
  summary: {
    averageScores: { seo: number; geo: number; aeo: number; overall: number }
    missingMetadata: number
    missingSources: number
    brokenLinks: number
    ambiguousLinks: number
    orphanNotes: number
    duplicateTitles: string[]
    staleNotes: number
    byStatus: Record<string, number>
    byType: Record<string, number>
  }
  priorityFiles: VaultFileRecord[]
}

export interface ContentBrief {
  source: string
  topic: string
  intent: string
  audience: string
  scores: AuditResult['scores']
  recommendedTitle: string
  directAnswer: string
  outline: string[]
  questions: string[]
  entities: string[]
  sourceGaps: string[]
  nextActions: string[]
}

export interface KeywordCandidate {
  term: string
  role: KeywordRole
  intent: KeywordIntent
  evidence: string[]
}

export interface KeywordSearchSignal {
  query: string
  sourceUrls: string[]
  observedTitles: string[]
}

export interface KnowledgeSignal {
  path: string
  title: string
  score: number
  matchedTerms: string[]
  candidateTerms: string[]
  excerpt: string
}

export interface KeywordPlan {
  status: 'ready' | 'partial' | 'seeds-only'
  dataQuality: 'qualitative' | 'seed-only'
  volumeDataAvailable: boolean
  primaryKeyword: string
  candidates: KeywordCandidate[]
  searchSignals: KeywordSearchSignal[]
  knowledgeSignals: KnowledgeSignal[]
  seoGuidance: string[]
  adjustments: string[]
  unknownReasons: string[]
}

export interface ProductionStage {
  id: 'diagnose' | 'keyword-map' | 'draft' | 'verify'
  objective: string
  actions: string[]
  deliverable: string
}

export interface ProductionPlan {
  stages: ProductionStage[]
  contentInputs: {
    source: string[]
    knowledgeBase: string[]
    seoStandard: string[]
    keywordMap: string[]
  }
  draftContract: {
    requiredSections: string[]
    evidenceRules: string[]
    outputFormat: string
  }
  writebackInstructions: string[]
}

export type SopStepId = 'define-goal' | 'connect-source' | 'baseline-audit' | 'keyword-map' | 'content-brief' | 'draft' | 'verify' | 'preview-writeback' | 're-audit'

export type SopStepStatus = 'completed' | 'ready' | 'blocked'

export interface SopStep {
  id: SopStepId
  order: number
  title: string
  status: SopStepStatus
  objective: string
  inputs: string[]
  outputs: string[]
  completionCriteria: string[]
  nextAction: string
}

export interface SeoSop {
  name: string
  version: string
  mode: 'read-only'
  currentStep: SopStepId
  steps: SopStep[]
  completionCriteria: string[]
  limitations: string[]
}

export type BacklinkMode = 'quality' | 'batch'

export type BacklinkRoute = 'product-directory' | 'startup-directory' | 'developer-community' | 'software-directory' | 'other'

export type BacklinkStatus =
  | 'not-attempted'
  | 'manual-required'
  | 'submitted'
  | 'awaiting-email-verification'
  | 'awaiting-approval'
  | 'published'
  | 'outcome-unknown'
  | 'failed'
  | 'ineligible'
  | 'unavailable'

export type BacklinkQualityGate = 'not-checked' | 'passed' | 'failed'

export interface BacklinkResource {
  id: string
  name: string
  url: string
  route: BacklinkRoute
  audience: string
  relevance: string
  source: string
  historicalNote?: string
  requiresAccount?: boolean
}

export interface BacklinkCandidate {
  id: string
  resource: BacklinkResource
  normalizedUrl: string
  idempotencyKey: string
  status: BacklinkStatus
  qualityGate: BacklinkQualityGate
  preflight: {
    checked: boolean
    statusCode?: number
    finalUrl?: string
    title?: string
    note: string
  }
  exclusionReasons: string[]
  nextAction: string
}

export interface BacklinkPlan {
  version: string
  mode: BacklinkMode
  status: 'ready' | 'partial'
  product: {
    name: string
    url: string
    canonicalUrl: string
  }
  source: {
    kind: 'built-in-catalog' | 'user-supplied'
    reference: string
    candidateCount: number
  }
  candidates: BacklinkCandidate[]
  manualQueue: string[]
  excluded: Array<{ url: string; reason: string }>
  submissionPack: {
    shortDescription: string
    longDescription: string
    suggestedAnchor: string
    factsToVerify: string[]
    prohibitedClaims: string[]
  }
  guardrails: string[]
  nextActions: string[]
}

export interface BacklinkRecordResult {
  version: string
  path: string
  status: BacklinkStatus
  idempotencyKey: string
  recordedAt: string
  changed: boolean
  evidence: string[]
  nextAction: string
}

export type EffectReviewStatus = 'improving' | 'declining' | 'mixed' | 'inconclusive'

export interface EffectSnapshot {
  period: string
  source: string
  impressions?: number
  clicks?: number
  ctrPercent?: number
  averagePosition?: number
  conversions?: number
  indexedPages?: number
  referralVisits?: number
  referralConversions?: number
}

export interface EffectPerformanceRow {
  query?: string
  page?: string
  impressions?: number
  clicks?: number
  ctrPercent?: number
  averagePosition?: number
  indexed?: boolean
  indexNote?: string
}

export interface EffectReview {
  version: string
  target: string
  status: EffectReviewStatus
  baseline: EffectSnapshot
  current: EffectSnapshot
  changes: Array<{
    metric: string
    baseline?: number
    current?: number
    delta?: number
    relativeChangePercent?: number
    direction: 'up' | 'down' | 'unchanged' | 'unknown'
    interpretation: string
  }>
  opportunities: Array<{ type: 'striking-distance' | 'low-ctr' | 'indexing' | 'cannibalization'; query?: string; page?: string; evidence: string; nextAction: string }>
  anomalies: string[]
  dataQuality: 'comparable' | 'partial' | 'insufficient'
  nextActions: string[]
  limitations: string[]
}

export interface ProjectContext {
  version: string
  updatedAt: string
  businessGoal: string
  audience: string
  language: string
  market: string
  brandName: string
  canonicalDomain: string
  brandTerms: string[]
  competitors: string[]
  keyPages: string[]
  conversionGoals: string[]
  constraints: string[]
  sourceNotes: string[]
}

export interface ProjectContextResult {
  path: string
  status: 'missing' | 'partial' | 'ready'
  context?: ProjectContext
  missingFields: string[]
  nextActions: string[]
}

export type KeywordOpportunityStatus = 'candidate' | 'planned' | 'writing' | 'published' | 'tracking' | 'discarded'

export interface KeywordOpportunity {
  term: string
  intent: KeywordIntent
  volume?: number
  difficulty?: number
  cpc?: number
  country?: string
  device?: 'desktop' | 'mobile' | 'all'
  source: string
  capturedAt: string
  targetPage?: string
  cluster?: string
  status: KeywordOpportunityStatus
  notes?: string
}

export interface KeywordImportResult {
  path: string
  imported: number
  updated: number
  skipped: number
  errors: string[]
  total: number
  nextActions: string[]
}

export interface KeywordOpportunityMap {
  path: string
  total: number
  clusters: Array<{ name: string; terms: string[]; targetPages: string[]; priority: 'high' | 'medium' | 'low' }>
  cannibalization: Array<{ term: string; targetPages: string[]; nextAction: string }>
  unassigned: string[]
  nextActions: string[]
}

export interface CoachResult {
  currentStep: 'project-context' | 'source' | 'keyword-import' | 'keyword-map' | 'effect-review' | 'backlink-plan' | 'next-diagnosis'
  status: 'ready' | 'blocked' | 'complete'
  reason: string
  inputs: Array<{ name: string; status: 'present' | 'missing' | 'partial'; path?: string; note: string }>
  nextActions: string[]
  suggestedPrompt: string
}

export interface CompetitorDataset {
  name: string
  url?: string
  keywords: string[]
  topics: string[]
  pages: string[]
  notes?: string
}

export interface CompetitorGapResult {
  target: { keywords: string[]; topics: string[]; pages: string[] }
  competitors: CompetitorDataset[]
  missingKeywords: string[]
  missingTopics: string[]
  pageGaps: string[]
  caveats: string[]
  nextActions: string[]
}

export interface BacklinkProfileRow {
  sourceUrl: string
  targetUrl?: string
  referringDomain?: string
  anchor?: string
  nofollow?: boolean
  sponsored?: boolean
  ugc?: boolean
  broken?: boolean
  lost?: boolean
  spamScore?: number
  competitor?: string
  capturedAt?: string
}

export interface BacklinkProfileResult {
  total: number
  referringDomains: number
  broken: string[]
  lost: string[]
  nofollow: string[]
  risky: Array<{ sourceUrl: string; reason: string }>
  competitorGaps: string[]
  caveats: string[]
  nextActions: string[]
}

export interface SiteAuditPage {
  url: string
  finalUrl: string
  statusCode: number
  title?: string
  metaDescription?: string
  canonicalUrl?: string
  robots?: string
  indexable: 'likely' | 'blocked' | 'unknown'
  h1Count: number
  internalLinks: number
  imageCount: number
  imagesMissingAlt: number
  structuredDataTypes: string[]
  truncated: boolean
  note: string
}

export interface SiteAuditResult {
  startUrl: string
  pages: SiteAuditPage[]
  skippedLinks: string[]
  limits: { maxPages: number; depth: number }
  caveats: string[]
  nextActions: string[]
}

export interface PromptEvidenceRun {
  prompt: string
  model: string
  capturedAt: string
  answer: string
  citedUrls: string[]
  brandMentioned?: boolean
}

export interface PromptReviewResult {
  totalRuns: number
  prompts: Array<{
    prompt: string
    models: string[]
    brandMentionRate: number | undefined
    citedUrls: string[]
    missingEvidence: string
  }>
  citationCoverage: number
  caveats: string[]
  nextActions: string[]
}

export interface ScanLimits {
  maxFiles: number
  maxFileBytes: number
  maxTextChars: number
  maxResultChars: number
}

export interface GeoConfig extends ScanLimits {
  defaultRoot: string
}

export interface FileSystemLike {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  contains(parent: unknown, child: unknown): boolean
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; size?: number; version: unknown } | undefined>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  listDir(target: unknown, signal?: AbortSignal): Promise<Array<{
    name: string
    type: string
    target: unknown
    size?: number
  }>>
  writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<unknown>
}
