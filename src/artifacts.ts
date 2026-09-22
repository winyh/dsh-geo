import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { integrityHash, validDate } from './artifact-integrity.js'
export const artifactDomain = 'dsh-geo'
export type ArtifactStatus = 'draft' | 'ready' | 'partial' | 'blocked' | 'stale' | 'applied'
export interface ArtifactFileSystem { resolve(path: string, options?: { signal?: AbortSignal }): Promise<unknown>; stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; version: unknown } | undefined>; readText(target: unknown, signal?: AbortSignal): Promise<string>; writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<unknown> }
export interface ArtifactReview { status: 'ready' | 'partial' | 'blocked' | 'stale'; issues: string[]; warnings: string[]; nextActions: string[]; artifactId?: string; artifactType?: string; sourceHash?: string; contentHash?: string; staleAfter?: string }
function normalized(value: unknown): unknown { if (Array.isArray(value)) return value.map(normalized); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !['artifactId', 'generatedAt', 'capturedAt', 'markdown', 'warnings', 'nextActions'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)])); return value }
export function contentHash(value: unknown): string { const raw = typeof value === 'string' ? value : JSON.stringify(normalized(value)); return createHash('sha256').update(raw).digest('hex').slice(0, 16) }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artifact' }
export function createArtifactId(value: Record<string, unknown>): string { const type = typeof value.artifactType === 'string' ? value.artifactType : 'artifact'; return `${artifactDomain}-${slug(type)}-${contentHash(value).slice(0, 12)}` }
function addDays(iso: string, days: number): string { const date = new Date(iso); date.setUTCDate(date.getUTCDate() + days); return date.toISOString() }
export function attachArtifactMetadata<T>(value: T, options: { staleAfterDays?: number; sourceHash?: string } = {}): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (typeof record.artifactType !== 'string' || !record.artifactType.trim()) return value
  // Never silently re-seal an existing versioned artifact, including altered input.
  if (record.hashVersion === 'sha256-v2') return value
  const generatedAt = typeof record.generatedAt === 'string' && record.generatedAt ? record.generatedAt : new Date().toISOString()
  const result: Record<string, unknown> = {
    ...record,
    schemaVersion: typeof record.schemaVersion === 'string' ? record.schemaVersion : '1.0',
    artifactId: typeof record.artifactId === 'string' && record.artifactId ? record.artifactId : createArtifactId(record),
    generatedAt,
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : generatedAt,
    revision: typeof record.revision === 'number' ? record.revision : 1,
    hashVersion: 'sha256-v2',
  }
  if (options.sourceHash) result.sourceHash = options.sourceHash
  if (options.staleAfterDays !== undefined && !record.staleAfter && validDate(generatedAt)) {
    result.staleAfter = addDays(generatedAt, options.staleAfterDays)
  }
  // Match the JSON actually sent across the tool boundary (omit undefined fields).
  const serialized = JSON.parse(JSON.stringify(result)) as Record<string, unknown>
  serialized.contentHash = integrityHash(serialized)
  return serialized as T
}

export function reviewArtifact(value: unknown, expectedType?: string): ArtifactReview {
  const issues: string[] = []
  const warnings: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'blocked', issues: ['工件必须是 JSON object。'], warnings, nextActions: ['传入插件实际生成的 JSON 工件，而不是 Markdown 展示文本。'] }
  const record = value as Record<string, unknown>
  const artifactType = typeof record.artifactType === 'string' ? record.artifactType : undefined
  const artifactId = typeof record.artifactId === 'string' ? record.artifactId : undefined
  const sourceHash = typeof record.sourceHash === 'string' ? record.sourceHash : undefined
  const artifactContentHash = typeof record.contentHash === 'string' ? record.contentHash : undefined
  const staleAfter = typeof record.staleAfter === 'string' ? record.staleAfter : undefined
  if (record.schemaVersion !== '1.0') issues.push('schemaVersion 必须为 1.0。')
  if (!artifactId?.trim()) issues.push('缺少稳定 artifactId。')
  if (!artifactType?.trim()) issues.push('缺少 artifactType。')
  if (expectedType && artifactType !== expectedType) issues.push(`artifactType 必须为 ${expectedType}。`)
  if (!validDate(record.generatedAt)) issues.push('generatedAt 必须是有效 ISO 日期或时间。')
  else if (Date.parse(record.generatedAt) > Date.now() + 300_000) issues.push('generatedAt 不能是未来时间。')
  if (record.staleAfter !== undefined && !validDate(record.staleAfter)) issues.push('staleAfter 必须是有效 ISO 日期或时间。')
  if (validDate(staleAfter) && validDate(record.generatedAt) && Date.parse(staleAfter) < Date.parse(record.generatedAt)) issues.push('staleAfter 不能早于 generatedAt。')
  if (record.hashVersion === 'sha256-v2') {
    if (!artifactContentHash || artifactContentHash !== integrityHash(record)) issues.push('contentHash 不匹配：内容已变化，请重新生成工件并重新交接。')
  } else if (record.hashVersion !== undefined) {
    issues.push('不支持的 hashVersion。')
  } else {
    warnings.push('旧版或缺少内容校验版本；请由来源插件重新生成，不能自动视为已验证。')
  }
  if (!staleAfter) warnings.push('缺少 staleAfter，无法自动判断证据是否过期。')
  const stale = validDate(staleAfter) && Date.parse(staleAfter) <= Date.now()
  if (stale) warnings.push(`工件已过期：${staleAfter}。`)
  const status = issues.length > 0 ? 'blocked' : stale ? 'stale' : warnings.length > 0 ? 'partial' : 'ready'
  return { status, issues, warnings, artifactId, artifactType, sourceHash, contentHash: artifactContentHash, staleAfter,
    nextActions: status === 'ready' ? ['格式、内容一致性和有效期检查通过；仍需由接收插件审查业务证据与授权边界。'] : ['回到来源插件补齐或更新工件，再交接；不要直接修改 hash 或有效期。'] }
}

export async function appendArtifactAudit(fs: ArtifactFileSystem, root: string, event: Record<string, unknown>, signal?: AbortSignal): Promise<{ path: string; entries: number }> { const path = join(root, '.dsh-geo-audit.jsonl'); const target = await fs.resolve(path, { signal }); const info = await fs.stat(target, signal); const current = info?.type === 'file' ? await fs.readText(target, signal) : ''; const next = `${current}${JSON.stringify({ ...event, plugin: artifactDomain, recordedAt: new Date().toISOString() })}\n`; await fs.writeText(target, next, info ? { kind: 'replaceIfVersion', version: info.version } : { kind: 'createIfAbsent' }, signal); return { path, entries: next.trim() ? next.trim().split(/\r?\n/).length : 0 } }
