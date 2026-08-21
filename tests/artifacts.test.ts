import { describe, expect, it } from 'vitest'
import { attachArtifactMetadata, createArtifactId, reviewArtifact } from '../src/artifacts.js'
describe('geo artifact protocol', () => {
  it('creates an idempotent content-based id', () => { expect(createArtifactId({ artifactType: 'sample', value: 1, generatedAt: '2026-01-01' })).toBe(createArtifactId({ artifactType: 'sample', value: 1, generatedAt: '2026-02-01' })) })
  it('attaches metadata and blocks incomplete artifacts', () => { const value = attachArtifactMetadata({ artifactType: 'sample', generatedAt: '2026-01-01T00:00:00.000Z' }); expect(value).toHaveProperty('artifactId'); expect(reviewArtifact(value).status).toBe('partial'); expect(reviewArtifact({ artifactType: 'sample' }).status).toBe('blocked') })
})
