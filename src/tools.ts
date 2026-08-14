import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { createContentBrief, auditNote } from './audit.js'
import { readNote } from './vault.js'
import { scanVault, summarizeVault } from './vault.js'
import type { FileSystemLike, GeoConfig } from './types.js'

function asJson(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value, null, 2)
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... result truncated by dsh-geo ...` : text
}

function fsFrom(ctx: Context): FileSystemLike {
  return (ctx as unknown as { fs: FileSystemLike }).fs
}

function rootPath(config: GeoConfig, requested?: string): string {
  return requested?.trim() || config.defaultRoot
}

function focusAudit(note: Parameters<typeof auditNote>[0], focus?: string) {
  const audit = auditNote(note)
  if (!focus || focus === 'all') return { ...audit, focus: 'all' }
  if (!['seo', 'geo', 'aeo'].includes(focus)) throw new Error(`Unsupported audit focus: ${focus}`)
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

  ctx.tools.register(defineTool({
    name: 'geo_audit_note',
    description: 'Audit one Markdown note for explainable SEO, GEO and AEO readiness. Reads only; does not change files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or workspace-relative Markdown path.' },
      focus: { type: 'string', description: 'Optional focus: seo, geo, aeo, or all.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
      return asJson(focusAudit(note, args.focus), config.maxResultChars)
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
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const root = rootPath(config, args.root)
      await ensureInsideRoot(fs, config, root, exec.signal)
      const limits = { ...config, maxFiles: Math.min(config.maxFiles, Math.max(1, args.maxFiles || config.maxFiles)) }
      const scan = await scanVault(fs, root, limits, exec.signal)
      return asJson(summarizeVault(root, scan), config.maxResultChars)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_content_brief',
    description: 'Create a structured content brief from a Markdown note, including query, intent, audience, outline, questions and source gaps.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown note path.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
      return asJson(createContentBrief(note, auditNote(note)), config.maxResultChars)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_source_check',
    description: 'Check source URLs, provenance fields, freshness metadata and source gaps in one Markdown note.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown note path.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
      const sourceFields = Object.entries(note.frontmatter)
        .filter(([key]) => /source|citation|reference|url/i.test(key))
        .map(([key, value]) => ({ key, value }))
      const result = {
        path: note.path,
        sourceUrls: note.sourceUrls,
        sourceFields,
        updated: note.frontmatter.updated || null,
        hasSources: note.sourceUrls.length > 0,
        recommendations: note.sourceUrls.length === 0
          ? ['补充原始来源 URL、发布时间、核验日期和适用边界。']
          : ['确认每个关键事实都能回溯到来源，并区分事实、观点和推断。'],
      }
      return asJson(result, config.maxResultChars)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_apply_content',
    description: 'Preview or apply a complete Markdown replacement using a stale-version guard. Set confirm=true only after explicit user approval.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown file to update.' },
      content: { type: 'string', required: true, description: 'Complete replacement Markdown content.' },
      confirm: { type: 'boolean', required: true, description: 'false previews only; true applies the guarded write.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`)
      if (!args.confirm) {
        return asJson({ status: 'preview-only', path: args.path, changed: args.content !== (await fs.readText(target, exec.signal)), applied: false }, config.maxResultChars)
      }
      await fs.writeText(target, args.content, { kind: 'replaceIfVersion', version: info.version }, exec.signal)
      return asJson({ status: 'applied', path: args.path, changed: true, applied: true, guarded: true }, config.maxResultChars)
    },
  }))

}
