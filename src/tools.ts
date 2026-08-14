import { createHash, randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { createContentBrief, auditNote } from './audit.js'
import { readNote } from './vault.js'
import { scanVault, summarizeVault } from './vault.js'
import type { FileSystemLike, GeoConfig, Pillar, VaultAuditResult } from './types.js'

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

interface ContentPreview {
  path: string
  content: string
  oldContent: string
  version: unknown
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

function rootPath(config: GeoConfig, requested?: string): string {
  return requested?.trim() || config.defaultRoot
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

async function ensureInsideRoot(fs: FileSystemLike, config: GeoConfig, targetPath: string, signal?: AbortSignal): Promise<void> {
  if (!config.defaultRoot) return
  const root = await fs.resolve(config.defaultRoot, { signal })
  const target = await fs.resolve(targetPath, { signal })
  if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${targetPath}`)
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
    if (!value || typeof value !== 'object' || !('previewToken' in value)) return {}
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
      const root = rootPath(config, args.root)
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
      const root = rootPath(config, args.root)
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
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
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
      const root = rootPath(config, args.root)
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
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
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
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
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
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`)
      const current = await fs.readText(target, exec.signal)
      const token = randomBytes(18).toString('hex')
      const oldHash = contentHash(current)
      const newHash = contentHash(args.content)
      const expiresAt = Date.now() + 10 * 60 * 1000
      prunePreviews()
      previews.set(token, { path: args.path, content: args.content, oldContent: current, version: info.version, oldHash, newHash, expiresAt, used: false })
      return {
        status: 'preview-only' as const,
        path: args.path,
        previewToken: token,
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
    description: 'Apply a previously previewed Markdown replacement after explicit approval. Requires a valid preview token and refuses stale files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown file to update.' },
      content: { type: 'string', required: true, description: 'The exact content returned for the preview.' },
      previewToken: { type: 'string', required: true, description: 'Short-lived token returned by geo_preview_content.' },
    },
    output: {
      schema: applyOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
      presentationMeta,
    },
    presentCall(args) {
      return diffView(args.path, args.content, `Apply changes: ${args.path}`, previews.get(args.previewToken)?.oldContent.slice(0, 20_000) || null)
    },
    presentResult(args, result) {
      if (result.isError) return { card: 'generic', title: `Apply blocked: ${args.path}`, content: result.content }
      return diffView(args.path, args.content, `Applied changes: ${args.path}`, diffOldText(result.meta))
    },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      prunePreviews()
      const preview = previews.get(args.previewToken)
      if (!preview || preview.path !== args.path || preview.used) throw new Error('Preview token is missing, expired, already used, or belongs to another path.')
      if (preview.content !== args.content) throw new Error('Content does not match the preview token.')
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      const current = await fs.readText(target, exec.signal)
      if (contentHash(current) !== preview.oldHash || versionKey(info.version) !== versionKey(preview.version)) {
        throw new Error('File changed after preview; generate a new preview before applying changes.')
      }
      await fs.writeText(target, args.content, { kind: 'replaceIfVersion', version: preview.version }, exec.signal)
      preview.used = true
      return {
        status: 'applied' as const,
        path: args.path,
        previewToken: args.previewToken,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        changed: true,
        applied: true,
        guarded: true,
      }
    },
  }))

}
