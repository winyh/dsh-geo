import { describe, expect, it } from 'vitest'
import { geoResultEnvelope } from '../src/output.js'

describe('shared result envelope', () => {
  it('preserves data, warnings and lineage for downstream consumers', () => {
    const result = geoResultEnvelope({
      data: { artifactType: 'content-brief', score: 80 },
      warnings: ['仅为本地内容审查'],
      lineage: [{ source: 'brief.md', fields: ['score'] }],
    })

    expect(result.schemaVersion).toBe('1.0')
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ artifactType: 'content-brief', score: 80 })
    expect(result.lineage[0]?.source).toBe('brief.md')
  })
})
