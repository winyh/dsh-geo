import { join } from 'node:path'
import { auditNote, AUDIT_RULE_VERSION } from './audit.js'
import { parseNote } from './markdown.js'
import type { FileSystemLike, NoteSnapshot, ScanLimits, VaultAuditResult, VaultFileRecord } from './types.js'

const ignoredDirectories = new Set(['.git', '.obsidian', '.dsh', 'node_modules', '.venv', '__pycache__'])

function displayPath(target: unknown, fallback: string): string {
  if (target && typeof target === 'object' && 'displayPath' in target && typeof target.displayPath === 'string') {
    return target.displayPath
  }
  return fallback
}

export async function readNote(fs: FileSystemLike, filePath: string, limits: ScanLimits, signal?: AbortSignal): Promise<NoteSnapshot> {
  const target = await fs.resolve(filePath, { signal })
  const info = await fs.stat(target, signal)
  if (!info || info.type !== 'file') throw new Error(`Not a readable file: ${filePath}`)
  if (info.size !== undefined && info.size > limits.maxFileBytes) {
    throw new Error(`File exceeds maxFileBytes (${limits.maxFileBytes}): ${filePath}`)
  }
  const content = await fs.readText(target, signal)
  return parseNote(displayPath(target, filePath), content.slice(0, limits.maxTextChars), {
    truncated: content.length > limits.maxTextChars,
  })
}

export interface VaultScan {
  files: NoteSnapshot[]
  skippedFiles: number
  errors: string[]
}

export async function scanVault(fs: FileSystemLike, rootPath: string, limits: ScanLimits, signal?: AbortSignal): Promise<VaultScan> {
  const root = await fs.resolve(rootPath, { signal })
  const queue: Array<{ target: unknown; path: string }> = [{ target: root, path: displayPath(root, rootPath) }]
  const files: NoteSnapshot[] = []
  const errors: string[] = []
  let skippedFiles = 0
  while (queue.length > 0 && files.length < limits.maxFiles) {
    if (signal?.aborted) throw new Error('Vault scan aborted')
    const current = queue.shift()!
    let entries
    try {
      entries = await fs.listDir(current.target, signal)
    } catch (error) {
      errors.push(`${current.path}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const entry of entries) {
      const childPath = join(current.path, entry.name)
      if (entry.type === 'directory') {
        if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ target: entry.target, path: childPath })
        }
        continue
      }
      if (entry.type !== 'file' || !/\.md(?:own)?$/i.test(entry.name)) continue
      if (files.length >= limits.maxFiles) {
        skippedFiles += 1
        break
      }
      if (entry.size !== undefined && entry.size > limits.maxFileBytes) {
        skippedFiles += 1
        errors.push(`${childPath}: skipped because it exceeds maxFileBytes`)
        continue
      }
      try {
        const rawContent = await fs.readText(entry.target, signal)
        files.push(parseNote(childPath, rawContent.slice(0, limits.maxTextChars), {
          truncated: rawContent.length > limits.maxTextChars,
        }))
      } catch (error) {
        skippedFiles += 1
        errors.push(`${childPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (queue.length > 0) skippedFiles += queue.length
  return { files, skippedFiles, errors }
}

function countValues(values: Array<string | undefined>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) if (value) result[value] = (result[value] || 0) + 1
  return result
}

function linkKey(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\.(?:md|mdown)$/i, '')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

function relativeKey(root: string, path: string): string {
  const rootKey = linkKey(root).replace(/\/$/, '')
  const pathKey = linkKey(path)
  return pathKey.startsWith(`${rootKey}/`) ? pathKey.slice(rootKey.length + 1) : pathKey
}

function stale(updated: string | undefined): boolean {
  if (!updated) return false
  const date = Date.parse(updated)
  if (Number.isNaN(date)) return false
  return Date.now() - date > 180 * 24 * 60 * 60 * 1000
}

export function summarizeVault(root: string, scan: VaultScan): VaultAuditResult {
  const records: VaultFileRecord[] = scan.files.map((file) => {
    const audit = auditNote(file)
    return {
      path: file.path,
      title: file.title,
      wordCount: file.wordCount,
      status: typeof file.frontmatter.status === 'string' ? file.frontmatter.status : undefined,
      type: typeof file.frontmatter.type === 'string' ? file.frontmatter.type : undefined,
      updated: typeof file.frontmatter.updated === 'string' ? file.frontmatter.updated : undefined,
      internalLinks: file.internalLinks,
      sourceUrls: file.sourceUrls,
      audit,
    }
  })
  const pathByLink = new Map<string, string[]>()
  for (const record of records) {
    const relative = relativeKey(root, record.path)
    const segments = relative.split('/')
    const linkKeys = new Set([linkKey(record.path), relative])
    for (let index = 0; index < segments.length; index += 1) {
      linkKeys.add(segments.slice(index).join('/'))
    }
    for (const key of linkKeys) {
      const paths = pathByLink.get(key) || []
      paths.push(record.path)
      pathByLink.set(key, paths)
    }
  }
  const referenced = new Set<string>()
  let brokenLinks = 0
  let ambiguousLinks = 0
  for (const record of records) {
    for (const link of record.internalLinks) {
      const key = linkKey(link)
      const matches = pathByLink.get(key) || []
      if (matches.length === 1) referenced.add(matches[0])
      else if (matches.length > 1) ambiguousLinks += 1
      else brokenLinks += 1
    }
  }
  const titleCounts = countValues(records.map((record) => record.title))
  const duplicateTitles = Object.entries(titleCounts).filter(([, count]) => count > 1).map(([title]) => title)
  const scoreTotals = records.reduce((total, record) => ({
    seo: total.seo + record.audit.scores.seo,
    geo: total.geo + record.audit.scores.geo,
    aeo: total.aeo + record.audit.scores.aeo,
    overall: total.overall + record.audit.scores.overall,
  }), { seo: 0, geo: 0, aeo: 0, overall: 0 })
  const divisor = Math.max(1, records.length)
  const priorityFiles = [...records]
    .sort((a, b) => a.audit.scores.overall - b.audit.scores.overall)
    .slice(0, 20)
  return {
    root,
    generatedAt: new Date().toISOString(),
    ruleVersion: AUDIT_RULE_VERSION,
    scannedFiles: records.length,
    skippedFiles: scan.skippedFiles,
    errors: scan.errors,
    summary: {
      averageScores: {
        seo: Math.round(scoreTotals.seo / divisor),
        geo: Math.round(scoreTotals.geo / divisor),
        aeo: Math.round(scoreTotals.aeo / divisor),
        overall: Math.round(scoreTotals.overall / divisor),
      },
      missingMetadata: records.filter((record) => !record.type || !record.status || !record.updated).length,
      missingSources: records.filter((record) => record.sourceUrls.length === 0).length,
      brokenLinks,
      ambiguousLinks,
      orphanNotes: records.filter((record) => records.length > 1 && !referenced.has(record.path)).length,
      duplicateTitles,
      staleNotes: records.filter((record) => stale(record.updated)).length,
      byStatus: countValues(records.map((record) => record.status)),
      byType: countValues(records.map((record) => record.type)),
    },
    priorityFiles,
  }
}
