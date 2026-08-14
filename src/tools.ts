import { createHash, randomBytes } from 'node:crypto'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-web'
import { createContentBrief, auditNote } from './audit.js'
import { readNote } from './vault.js'
import { scanVault, summarizeVault } from './vault.js'
import { fetchPublicDocument, isPublicUrl, readLocalDocument, type SourceDocument } from './web.js'
import { buildKeywordPlan, buildProductionPlan } from './workflow.js'
import type { ContentBrief, FileSystemLike, GeoConfig, KeywordPlan, Pillar, VaultAuditResult } from './types.js'

type AuditFocus = Pillar | 'all'

const findingOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    pillar: { type: 'string', enum: ['seo', 'geo', 'aeo'], required: true },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'], required: true },
    message: { type: 'string', required: true },
    evidence: { type: 'string', required: true },
    recommendation: { type: 'string', required: true },
    scoreImpact: { type: 'number', required: true },
  },
} as const

const auditOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    focus: { type: 'string', enum: ['seo', 'geo', 'aeo', 'all'], required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
    unknownReasons: { type: 'array', items: { type: 'string' }, required: true },
    truncated: { type: 'boolean', required: true },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seo: { type: 'number', required: true },
        geo: { type: 'number', required: true },
        aeo: { type: 'number', required: true },
        overall: { type: 'number', required: true },
      },
      required: true,
    },
    stats: {
      type: 'object',
      additionalProperties: false,
      properties: {
        wordCount: { type: 'number', required: true },
        headings: { type: 'number', required: true },
        internalLinks: { type: 'number', required: true },
        externalLinks: { type: 'number', required: true },
        sources: { type: 'number', required: true },
        entities: { type: 'number', required: true },
        questions: { type: 'number', required: true },
      },
      required: true,
    },
    findings: { type: 'array', items: findingOutputSchema, required: true },
    topActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const vaultAuditSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
    unknownReasons: { type: 'array', items: { type: 'string' }, required: true },
    truncated: { type: 'boolean', required: true },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seo: { type: 'number', required: true },
        geo: { type: 'number', required: true },
        aeo: { type: 'number', required: true },
        overall: { type: 'number', required: true },
      },
      required: true,
    },
    stats: { type: 'json', required: true },
    findings: { type: 'array', items: findingOutputSchema, required: true },
    topActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const vaultSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    averageScores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seo: { type: 'number', required: true },
        geo: { type: 'number', required: true },
        aeo: { type: 'number', required: true },
        overall: { type: 'number', required: true },
      },
      required: true,
    },
    missingMetadata: { type: 'number', required: true },
    missingSources: { type: 'number', required: true },
    brokenLinks: { type: 'number', required: true },
    ambiguousLinks: { type: 'number', required: true },
    orphanNotes: { type: 'number', required: true },
    duplicateTitles: { type: 'array', items: { type: 'string' }, required: true },
    staleNotes: { type: 'number', required: true },
    byStatus: { type: 'json', required: true },
    byType: { type: 'json', required: true },
  },
} as const

const vaultFileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    title: { type: 'string', required: true },
    wordCount: { type: 'number', required: true },
    status: { type: 'string' },
    type: { type: 'string' },
    updated: { type: 'string' },
    internalLinks: { type: 'array', items: { type: 'string' }, required: true },
    sourceUrls: { type: 'array', items: { type: 'string' }, required: true },
    audit: vaultAuditSchema,
  },
} as const

const scoreOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seo: { type: 'number', required: true },
    geo: { type: 'number', required: true },
    aeo: { type: 'number', required: true },
    overall: { type: 'number', required: true },
  },
  required: true,
} as const

const vaultOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    scannedFiles: { type: 'number', required: true },
    skippedFiles: { type: 'number', required: true },
    errors: { type: 'array', items: { type: 'string' }, required: true },
    summary: vaultSummarySchema,
    priorityFiles: { type: 'array', items: vaultFileSchema, required: true },
  },
} as const

const briefOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    topic: { type: 'string', required: true },
    intent: { type: 'string', required: true },
    audience: { type: 'string', required: true },
    scores: scoreOutputSchema,
    recommendedTitle: { type: 'string', required: true },
    directAnswer: { type: 'string', required: true },
    outline: { type: 'array', items: { type: 'string' }, required: true },
    questions: { type: 'array', items: { type: 'string' }, required: true },
    entities: { type: 'array', items: { type: 'string' }, required: true },
    sourceGaps: { type: 'array', items: { type: 'string' }, required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const sourceOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    sourceUrls: { type: 'array', items: { type: 'string' }, required: true },
    sourceFields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          value: { type: 'string', required: true },
        },
      },
      required: true,
    },
    updated: { type: 'string', required: true },
    hasSources: { type: 'boolean', required: true },
    freshness: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['fresh', 'stale', 'unknown'], required: true },
        ageDays: { type: 'number', required: true },
        message: { type: 'string', required: true },
      },
      required: true,
    },
    sourceGaps: { type: 'array', items: { type: 'string' }, required: true },
    recommendations: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const previewOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['preview-only', 'applied'], required: true },
    path: { type: 'string', required: true },
    previewToken: { type: 'string', required: true },
    created: { type: 'boolean', required: true },
    oldHash: { type: 'string', required: true },
    newHash: { type: 'string', required: true },
    expiresAt: { type: 'string', required: true },
    changed: { type: 'boolean', required: true },
    applied: { type: 'boolean', required: true },
    guarded: { type: 'boolean', required: true },
  },
} as const

const applyOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['applied'], required: true },
    path: { type: 'string', required: true },
    previewToken: { type: 'string', required: true },
    created: { type: 'boolean', required: true },
    oldHash: { type: 'string', required: true },
    newHash: { type: 'string', required: true },
    changed: { type: 'boolean', required: true },
    applied: { type: 'boolean', required: true },
    guarded: { type: 'boolean', required: true },
  },
} as const

const setupOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    ready: { type: 'boolean', required: true },
    markdownFiles: { type: 'number', required: true },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', enum: ['pass', 'warn', 'fail'], required: true },
          message: { type: 'string', required: true },
        },
      },
      required: true,
    },
    recommendations: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const reportOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    scannedFiles: { type: 'number', required: true },
    skippedFiles: { type: 'number', required: true },
    errors: { type: 'array', items: { type: 'string' }, required: true },
    summary: vaultSummarySchema,
    priorityFiles: { type: 'array', items: vaultFileSchema, required: true },
    reportMarkdown: { type: 'string', required: true },
  },
} as const

const keywordPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ready', 'partial', 'seeds-only'], required: true },
    dataQuality: { type: 'string', enum: ['qualitative', 'seed-only'], required: true },
    volumeDataAvailable: { type: 'boolean', required: true },
    primaryKeyword: { type: 'string', required: true },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string', required: true },
          role: { type: 'string', enum: ['primary', 'secondary', 'question', 'entity'], required: true },
          intent: { type: 'string', enum: ['informational', 'commercial', 'navigational', 'transactional', 'unknown'], required: true },
          evidence: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      required: true,
    },
    searchSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          sourceUrls: { type: 'array', items: { type: 'string' }, required: true },
          observedTitles: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      required: true,
    },
    adjustments: { type: 'array', items: { type: 'string' }, required: true },
    unknownReasons: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const productionPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', enum: ['diagnose', 'keyword-map', 'draft', 'verify'], required: true },
          objective: { type: 'string', required: true },
          actions: { type: 'array', items: { type: 'string' }, required: true },
          deliverable: { type: 'string', required: true },
        },
      },
      required: true,
    },
    draftContract: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requiredSections: { type: 'array', items: { type: 'string' }, required: true },
        evidenceRules: { type: 'array', items: { type: 'string' }, required: true },
        outputFormat: { type: 'string', required: true },
      },
      required: true,
    },
    writebackInstructions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const workflowOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    sourceType: { type: 'string', enum: ['public-url', 'local-markdown', 'private-snapshot'], required: true },
    status: { type: 'string', enum: ['ready', 'partial'], required: true },
    access: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['public-url', 'local-file'], required: true },
        credentialsUsed: { type: 'boolean', required: true },
        limitation: { type: 'string', required: true },
      },
      required: true,
    },
    capture: {
      type: 'object',
      additionalProperties: false,
      properties: {
        finalUrl: { type: 'string', required: true },
        statusCode: { type: 'number', required: true },
        bodyKind: { type: 'string', enum: ['html', 'text', 'markdown', 'snapshot'], required: true },
        capturedAt: { type: 'string', required: true },
        truncated: { type: 'boolean', required: true },
        note: { type: 'string', required: true },
      },
      required: true,
    },
    audit: auditOutputSchema,
    keywordPlan: keywordPlanSchema,
    contentBrief: briefOutputSchema,
    productionPlan: productionPlanSchema,
    writeback: {
      type: 'object',
      additionalProperties: false,
      properties: {
        canPreviewExistingFile: { type: 'boolean', required: true },
        canCreateNewFile: { type: 'boolean', required: true },
        instructions: { type: 'array', items: { type: 'string' }, required: true },
      },
      required: true,
    },
  },
} as const

interface ContentPreview {
  path: string
  content: string
  oldContent: string
  version: unknown
  created: boolean
  oldHash: string
  newHash: string
  expiresAt: number
  used: boolean
}

function renderValue(value: unknown, maxChars: number) {
  const text = JSON.stringify(value, null, 2)
  const rendered = text.length > maxChars ? `${text.slice(0, maxChars)}\n... result presentation truncated by dsh-geo ...` : text
  return [{ type: 'text' as const, text: rendered }]
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function versionKey(version: unknown): string {
  return JSON.stringify(version) ?? String(version)
}

function diffView(path: string, content: string, title: string, oldText: string | null = null) {
  return {
    card: 'diff' as const,
    title,
    diffs: [{ path, oldText, newText: content }],
    locations: [{ path }],
  }
}

function diffOldText(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || !('oldText' in meta)) return null
  const value = meta.oldText
  return typeof value === 'string' ? value : null
}

function projectReport(result: VaultAuditResult): string {
  const { summary } = result
  const priority = result.priorityFiles.length > 0
    ? result.priorityFiles.map((file, index) => String(index + 1) + ". " + file.path + " - " + file.audit.scores.overall + "/100").join('\n')
    : '- No Markdown files were found.'
  const nextSteps = [
    result.priorityFiles.length > 0
      ? `Start with ${result.priorityFiles[0].path}: run geo_audit_note, then preview one focused content change.`
      : '',
    summary.missingSources > 0
      ? `Run geo_source_check on the ${summary.missingSources} note(s) without source URLs and add provenance before rewriting copy.`
      : '',
    summary.brokenLinks > 0 || summary.ambiguousLinks > 0
      ? `Repair ${summary.brokenLinks} broken and ${summary.ambiguousLinks} ambiguous internal link(s) before relying on the vault as a knowledge graph.`
      : '',
    summary.staleNotes > 0
      ? `Review the ${summary.staleNotes} stale note(s) and verify their claims before publishing new answers.`
      : '',
  ].filter(Boolean)
  return [
    '# 生成式引擎优化项目报告 / Generative Engine Optimization Report',
    '',
    `- Root: \`${result.root}\``,
    `- Generated at: ${result.generatedAt}`,
    `- Rule version: ${result.ruleVersion}`,
    `- Scanned files: ${result.scannedFiles}`,
    `- Skipped files: ${result.skippedFiles}`,
    '',
    '## Score summary',
    '',
    `- SEO: ${summary.averageScores.seo}/100`,
    `- GEO: ${summary.averageScores.geo}/100`,
    `- AEO: ${summary.averageScores.aeo}/100`,
    `- Overall: ${summary.averageScores.overall}/100`,
    '',
    '## Governance signals',
    '',
    `- Missing metadata: ${summary.missingMetadata}`,
    `- Missing sources: ${summary.missingSources}`,
    `- Broken links: ${summary.brokenLinks}`,
    `- Ambiguous links: ${summary.ambiguousLinks}`,
    `- Orphan notes: ${summary.orphanNotes}`,
    `- Stale notes: ${summary.staleNotes}`,
    `- Duplicate titles: ${summary.duplicateTitles.length}`,
    '',
    '## Priority files',
    '',
    priority,
    '',
    '## Next steps',
    '',
    nextSteps.length > 0 ? nextSteps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '1. Run geo_audit_note on the note that matters most to the current user or business goal.',
    '',
    result.errors.length > 0 ? '## Scan warnings\n\n' + result.errors.map((error) => `- ${error}`).join('\n') : '',
  ].filter(Boolean).join('\n')
}

function freshnessOf(updated: string): { status: 'fresh' | 'stale' | 'unknown'; ageDays: number; message: string } {
  if (!updated) return { status: 'unknown', ageDays: 0, message: 'No updated date was found.' }
  const timestamp = Date.parse(updated)
  if (Number.isNaN(timestamp)) return { status: 'unknown', ageDays: 0, message: `The updated value is not a valid date: ${updated}` }
  const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)))
  return ageDays > 180
    ? { status: 'stale', ageDays, message: `The note was updated ${ageDays} days ago.` }
    : { status: 'fresh', ageDays, message: `The note was updated ${ageDays} days ago.` }
}

function fsFrom(ctx: Context): FileSystemLike {
  return (ctx as unknown as { fs: FileSystemLike }).fs
}

function applyWorkflowContext(
  document: SourceDocument,
  brief: ContentBrief,
  goal?: string,
  audience?: string,
): ContentBrief {
  const contextNote = goal ? [`Business goal: ${goal}`] : []
  return {
    ...brief,
    source: document.source,
    intent: goal || brief.intent,
    audience: audience || brief.audience,
    nextActions: [...contextNote, ...brief.nextActions],
  }
}

function workflowStatus(document: SourceDocument, keywordPlan: KeywordPlan): 'ready' | 'partial' {
  return document.truncated || keywordPlan.status !== 'ready' ? 'partial' : 'ready'
}

export function resolveRootPath(config: Pick<GeoConfig, 'defaultRoot'>, requested?: string): string {
  const value = requested?.trim()
  if (!value) return config.defaultRoot ? resolvePath(config.defaultRoot) : resolvePath('.')
  if (!config.defaultRoot || isAbsolute(value)) return value
  return resolvePath(config.defaultRoot, value)
}

/** Resolve workspace-relative tool paths against the configured knowledge-base root. */
export function resolveScopedPath(config: GeoConfig, requested: string): string {
  const value = requested.trim()
  if (!config.defaultRoot || isAbsolute(value)) return value
  return resolvePath(config.defaultRoot, value)
}

/** Use the preview-bound content when the caller omits the duplicate payload. */
export function resolvePreviewContent(previewContent: string | undefined, requestedContent?: string): string {
  if (previewContent === undefined) throw new Error('Preview content is unavailable; generate a new preview before applying changes.')
  if (requestedContent !== undefined && requestedContent !== previewContent) {
    throw new Error('Content does not match the preview token.')
  }
  return previewContent
}

function focusAudit(note: Parameters<typeof auditNote>[0], focus?: AuditFocus): ReturnType<typeof auditNote> & { focus: AuditFocus } {
  const audit = auditNote(note)
  if (!focus || focus === 'all') return { ...audit, focus: 'all' }
  const findings = audit.findings.filter((finding) => finding.pillar === focus)
  return {
    ...audit,
    focus,
    findings,
    topActions: findings
      .sort((a, b) => b.scoreImpact - a.scoreImpact)
      .slice(0, 5)
      .map((finding) => `${finding.pillar.toUpperCase()}：${finding.recommendation}`),
  }
}

async function ensureInsideRoot(fs: FileSystemLike, config: GeoConfig, targetPath: string, signal?: AbortSignal): Promise<string> {
  const scopedTarget = resolveScopedPath(config, targetPath)
  if (!config.defaultRoot) return scopedTarget
  const root = await fs.resolve(config.defaultRoot, { signal })
  const target = await fs.resolve(scopedTarget, { signal })
  if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${targetPath}`)
  return scopedTarget
}

export function registerGeoTools(ctx: Context, config: GeoConfig): void {
  const fs = fsFrom(ctx)
  const previews = new Map<string, ContentPreview>()

  const prunePreviews = () => {
    const now = Date.now()
    for (const [token, preview] of previews) {
      if (preview.expiresAt <= now) previews.delete(token)
    }
  }

  const presentationMeta = (_args: unknown, value: unknown) => {
    if (!value || typeof value !== 'object' || !('previewToken' in value)) {
      return { path: '', oldText: null, newText: '', truncated: false }
    }
    const token = value.previewToken
    const preview = typeof token === 'string' ? previews.get(token) : undefined
    const maxDiffChars = 20_000
    return {
      path: preview?.path || '',
      oldText: preview ? preview.oldContent.slice(0, maxDiffChars) : null,
      newText: preview ? preview.content.slice(0, maxDiffChars) : '',
      truncated: preview ? preview.oldContent.length > maxDiffChars || preview.content.length > maxDiffChars : false,
    }
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'geo_apply_content') {
      return {
        kind: 'ask' as const,
        reason: 'This will replace a Markdown file. Review the diff and approve the guarded write.',
      }
    }
    return next()
  })

  ctx.tools.register(defineTool({
    name: 'geo_setup_check',
    description: 'Check whether the configured Markdown root is accessible and ready for a local SEO/GEO/AEO scan. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory to check. Defaults to the configured knowledge-base root.' },
    },
    output: {
      schema: setupOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const root = resolveRootPath(config, args.root)
      const checks: Array<{ id: string; status: 'pass' | 'warn' | 'fail'; message: string }> = []
      try {
        await ensureInsideRoot(fs, config, root, exec.signal)
        checks.push({ id: 'root-boundary', status: 'pass', message: 'The requested root is inside the configured defaultRoot.' })
      } catch (error) {
        checks.push({ id: 'root-boundary', status: 'fail', message: error instanceof Error ? error.message : String(error) })
        return {
          root,
          ready: false,
          markdownFiles: 0,
          checks,
          recommendations: ['Set defaultRoot to the intended Markdown knowledge-base directory, then run geo_setup_check again.'],
        }
      }

      let markdownFiles = 0
      try {
        const target = await fs.resolve(root, { signal: exec.signal })
        const info = await fs.stat(target, exec.signal)
        if (!info || info.type !== 'directory') {
          checks.push({ id: 'root-directory', status: 'fail', message: 'The configured root is not an accessible directory.' })
        } else {
          checks.push({ id: 'root-directory', status: 'pass', message: 'The configured root is an accessible directory.' })
          const entries = await fs.listDir(target, exec.signal)
          markdownFiles = entries.filter((entry) => entry.type === 'file' && /\.md(?:own)?$/i.test(entry.name)).length
          checks.push({
            id: 'markdown-presence',
            status: markdownFiles > 0 ? 'pass' : 'warn',
            message: markdownFiles > 0 ? `Found ${markdownFiles} Markdown file(s) at the root.` : 'No Markdown files were found at the root; nested files may still exist.',
          })
        }
      } catch (error) {
        checks.push({ id: 'root-readable', status: 'fail', message: error instanceof Error ? error.message : String(error) })
      }

      checks.push({ id: 'local-first', status: 'pass', message: 'Analysis uses the local Harness filesystem service and does not require GEO-PRO.' })
      const ready = checks.every((check) => check.status !== 'fail')
      return {
        root,
        ready,
        markdownFiles,
        checks,
        recommendations: ready
          ? ['Run geo_audit_note for one note or geo_audit_vault for the full knowledge base.']
          : ['Fix the failed checks before starting a vault scan.'],
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_workflow',
    description: 'Run the complete SEO/GEO/AEO workflow from one public URL or one local Markdown/HTML snapshot: diagnose, build a qualitative keyword plan, create a content-production brief, and return safe write-back instructions. Reads only.',
    parameters: {
      source: { type: 'string', required: true, description: 'Public http(s) URL, local Markdown path, or local HTML export/snapshot from a public or private account page.' },
      goal: { type: 'string', description: 'Optional business or user goal, such as leads, product education, documentation discovery or support deflection.' },
      audience: { type: 'string', description: 'Optional target audience to use in the production brief.' },
      seedKeywords: { type: 'array', items: { type: 'string' }, description: 'Optional terms supplied by the user; the first term becomes the primary query.' },
    },
    output: {
      schema: workflowOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const source = args.source.trim()
      if (!source) throw new Error('source is required: pass a public URL or a local Markdown/HTML snapshot path.')
      let document: SourceDocument
      if (isPublicUrl(source)) {
        document = await fetchPublicDocument(ctx.web, source, config, exec.signal)
      } else {
        const path = await ensureInsideRoot(fs, config, source, exec.signal)
        if (!/\.(?:md|mdown|html?)$/i.test(path)) {
          throw new Error('Local workflow sources must be .md, .mdown, .html or .htm. Export a private/public account page to Markdown or HTML first.')
        }
        document = await readLocalDocument(fs, path, config, exec.signal)
      }
      const audit = focusAudit(document.note, 'all')
      // Never send terms extracted from a local Markdown/HTML file to public
      // search. This keeps private snapshots and local knowledge bases local.
      const keywordPlan = await buildKeywordPlan(document.note, audit, isPublicUrl(source) ? ctx.web : undefined, args.seedKeywords || [], exec.signal)
      const contentBrief = applyWorkflowContext(
        document,
        createContentBrief(document.note, audit),
        args.goal,
        args.audience,
      )
      const productionPlan = buildProductionPlan(contentBrief, audit, keywordPlan)
      const localFile = document.sourceType !== 'public-url'
      return {
        source,
        sourceType: document.sourceType,
        status: workflowStatus(document, keywordPlan),
        access: {
          mode: isPublicUrl(source) ? 'public-url' as const : 'local-file' as const,
          credentialsUsed: false,
          limitation: isPublicUrl(source)
            ? 'Anonymous public retrieval only. JavaScript-rendered or logged-in pages should be exported as Markdown/HTML and passed as a local snapshot.'
            : document.accessNote,
        },
        capture: {
          finalUrl: document.finalUrl,
          statusCode: document.statusCode,
          bodyKind: document.bodyKind,
          capturedAt: document.capturedAt,
          truncated: document.truncated,
          note: document.accessNote,
        },
        audit,
        keywordPlan,
        contentBrief,
        productionPlan,
        writeback: {
          canPreviewExistingFile: localFile,
          canCreateNewFile: true,
          instructions: localFile
            ? ['Generate the complete Markdown draft from productionPlan, then preview it against the local source path.', 'For a new destination, call geo_preview_content with createIfMissing=true; all destinations remain inside defaultRoot.', 'Apply only after reviewing the diff; geo_apply_content uses a short-lived token and a version guard.']
            : ['The URL itself is read-only. Generate the draft, save/export it to a local Markdown destination, then preview that destination with geo_preview_content.', 'For a private page, keep the exported HTML/Markdown inside defaultRoot; no cookies or credentials are passed to dsh-geo.', 'Apply only after reviewing the diff; geo_apply_content uses a short-lived token and a version guard.'],
        },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_project_report',
    description: 'Create a structured, shareable project report for the Markdown knowledge base. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory. Defaults to the configured knowledge-base root.' },
      maxFiles: { type: 'integer', description: 'Optional scan cap; never exceeds configured maxFiles.' },
    },
    output: {
      schema: reportOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const root = resolveRootPath(config, args.root)
      await ensureInsideRoot(fs, config, root, exec.signal)
      const limits = { ...config, maxFiles: Math.min(config.maxFiles, Math.max(1, args.maxFiles || config.maxFiles)) }
      const scan = await scanVault(fs, root, limits, exec.signal)
      const result = summarizeVault(root, scan)
      return {
        ...result,
        reportMarkdown: projectReport(result),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_audit_note',
    description: 'Audit one Markdown note for explainable SEO, GEO and AEO readiness. Reads only; does not change files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or workspace-relative Markdown path.' },
      focus: { type: 'string', enum: ['seo', 'geo', 'aeo', 'all'], description: 'Optional focus: seo, geo, aeo, or all.' },
    },
    output: {
      schema: auditOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, path, config, exec.signal)
      return focusAudit(note, args.focus)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_audit_vault',
    description: 'Scan a Markdown knowledge base and report metadata, link, source, orphan and SEO/GEO/AEO health. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory. Defaults to the configured knowledge-base root.' },
      maxFiles: { type: 'number', description: 'Optional scan cap; never exceeds configured maxFiles.' },
    },
    output: {
      schema: vaultOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const root = resolveRootPath(config, args.root)
      await ensureInsideRoot(fs, config, root, exec.signal)
      const limits = { ...config, maxFiles: Math.min(config.maxFiles, Math.max(1, args.maxFiles || config.maxFiles)) }
      const scan = await scanVault(fs, root, limits, exec.signal)
      return summarizeVault(root, scan)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_content_brief',
    description: 'Create a structured content brief from a Markdown note, including query, intent, audience, outline, questions and source gaps.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown note path.' },
    },
    output: {
      schema: briefOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, path, config, exec.signal)
      return createContentBrief(note, auditNote(note))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_source_check',
    description: 'Check source URLs, provenance fields, freshness metadata and source gaps in one Markdown note.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown note path.' },
    },
    output: {
      schema: sourceOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, path, config, exec.signal)
      const sourceFields = Object.entries(note.frontmatter)
        .filter(([key]) => /source|citation|reference|url/i.test(key))
        .map(([key, value]) => ({
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value) ?? String(value),
        }))
      const updated = typeof note.frontmatter.updated === 'string' ? note.frontmatter.updated : ''
      const freshness = freshnessOf(updated)
      const sourceGaps = [
        ...(note.sourceUrls.length === 0 ? ['Add at least one primary source URL.'] : []),
        ...(!updated ? ['Add an updated date in frontmatter.'] : []),
        ...(freshness.status === 'unknown' && updated ? ['Use an ISO-compatible updated date so freshness can be checked.'] : []),
      ]
      const result = {
        path: note.path,
        sourceUrls: note.sourceUrls,
        sourceFields,
        updated,
        hasSources: note.sourceUrls.length > 0,
        freshness,
        sourceGaps,
        recommendations: sourceGaps.length > 0
          ? sourceGaps
          : freshness.status === 'stale'
            ? ['Refresh stale sources and record the review date before publishing.']
            : ['Confirm every key claim maps to a source, and distinguish facts, opinions and inferences.'],
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_preview_content',
    description: 'Preview a complete Markdown replacement and return a short-lived token for a later guarded apply. Never changes files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown file to update.' },
      content: { type: 'string', required: true, description: 'Complete replacement Markdown content.' },
      createIfMissing: { type: 'boolean', description: 'Set true to preview creating a new Markdown file. Defaults to false.' },
    },
    output: {
      schema: previewOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
      presentationMeta,
    },
    presentCall(args) {
      return diffView(args.path, args.content, `Preview changes: ${args.path}`)
    },
    presentResult(args, result) {
      if (result.isError) return { card: 'generic', title: `Preview failed: ${args.path}`, content: result.content }
      return diffView(args.path, args.content, `Preview ready: ${args.path}`, diffOldText(result.meta))
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const target = await fs.resolve(path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (info && info.type !== 'file') throw new Error(`Target is not a file: ${args.path}`)
      if (!info && !args.createIfMissing) throw new Error(`File not found: ${args.path}. Set createIfMissing=true to preview a new Markdown file.`)
      if (!/\.(?:md|mdown)$/i.test(path)) throw new Error('Only .md and .mdown destinations can be previewed.')
      if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`)
      const current = info ? await fs.readText(target, exec.signal) : ''
      const token = randomBytes(18).toString('hex')
      const oldHash = contentHash(current)
      const newHash = contentHash(args.content)
      const expiresAt = Date.now() + 10 * 60 * 1000
      prunePreviews()
      previews.set(token, { path, content: args.content, oldContent: current, version: info?.version, created: !info, oldHash, newHash, expiresAt, used: false })
      return {
        status: 'preview-only' as const,
        path,
        previewToken: token,
        created: !info,
        oldHash,
        newHash,
        expiresAt: new Date(expiresAt).toISOString(),
        changed: args.content !== current,
        applied: false,
        guarded: true,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_apply_content',
    description: 'Apply a previously previewed Markdown replacement after explicit approval. Requires a valid preview token, can reuse its bound content when content is omitted, and refuses stale files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown file to update.' },
      content: { type: 'string', description: 'Optional exact content returned for the preview. Omit it to reuse the content bound to previewToken.' },
      previewToken: { type: 'string', required: true, description: 'Short-lived token returned by geo_preview_content.' },
    },
    output: {
      schema: applyOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
      presentationMeta,
    },
    presentCall(args) {
      const preview = previews.get(args.previewToken)
      const content = typeof args.content === 'string' ? args.content : preview?.content || ''
      return diffView(args.path, content, `Apply changes: ${args.path}`, preview?.oldContent.slice(0, 20_000) || null)
    },
    presentResult(args, result) {
      if (result.isError) return { card: 'generic', title: `Apply blocked: ${args.path}`, content: result.content }
      const preview = previews.get(args.previewToken)
      const content = typeof args.content === 'string' ? args.content : preview?.content || ''
      return diffView(args.path, content, `Applied changes: ${args.path}`, diffOldText(result.meta))
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      prunePreviews()
      const preview = previews.get(args.previewToken)
      if (!preview || preview.path !== path || preview.used) throw new Error('Preview token is missing, expired, already used, or belongs to another path.')
      const content = resolvePreviewContent(preview.content, args.content)
      const target = await fs.resolve(path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (preview.created) {
        if (info) throw new Error('The destination appeared after preview; generate a new preview before creating it.')
        await fs.writeText(target, content, { kind: 'createIfAbsent' }, exec.signal)
      } else {
        if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
        const current = await fs.readText(target, exec.signal)
        if (contentHash(current) !== preview.oldHash || versionKey(info.version) !== versionKey(preview.version)) {
          throw new Error('File changed after preview; generate a new preview before applying changes.')
        }
        await fs.writeText(target, content, { kind: 'replaceIfVersion', version: preview.version }, exec.signal)
      }
      preview.used = true
      return {
        status: 'applied' as const,
        path,
        previewToken: args.previewToken,
        created: preview.created,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        changed: true,
        applied: true,
        guarded: true,
      }
    },
  }))

}
