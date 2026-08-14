export type Pillar = 'seo' | 'geo' | 'aeo'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface Frontmatter {
  [key: string]: unknown
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
