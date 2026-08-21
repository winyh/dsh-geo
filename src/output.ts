export interface GeoResultLineage {
  source: string
  fields?: string[]
}

export interface GeoResultEnvelope {
  schemaVersion: '1.0'
  ok: true
  data: JsonValue
  warnings: string[]
  assumptions: string[]
  lineage: Array<Record<string, JsonValue>>
  nextActions: string[]
}

export const geoResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string' as const, required: true },
    ok: { type: 'boolean' as const, required: true },
    data: { type: 'json' as const, required: true },
    warnings: { type: 'array' as const, items: { type: 'string' as const }, required: true },
    assumptions: { type: 'array' as const, items: { type: 'string' as const }, required: true },
    lineage: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true as const }, required: true },
    nextActions: { type: 'array' as const, items: { type: 'string' as const }, required: true },
  },
} as const

export function geoResultEnvelope(input: { data: JsonValue; warnings?: string[]; assumptions?: string[]; lineage?: GeoResultLineage[]; nextActions?: string[] }): GeoResultEnvelope {
  return { schemaVersion: '1.0', ok: true, data: input.data, warnings: input.warnings ?? [], assumptions: input.assumptions ?? [], lineage: [...(input.lineage ?? [])] as unknown as Array<Record<string, JsonValue>>, nextActions: input.nextActions ?? [] }
}
import type { JsonValue } from '@deepseek-ai/dsh-tools'
