import { resolve as pathResolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveScopedPath } from '../src/tools.js'
import type { GeoConfig } from '../src/types.js'

describe('resolveScopedPath', () => {
  it('resolves workspace-relative paths under defaultRoot', () => {
    expect(resolveScopedPath({ defaultRoot: 'vault' } as GeoConfig, 'notes/topic.md')).toBe(pathResolve('vault', 'notes/topic.md'))
  })

  it('preserves absolute paths for boundary validation', () => {
    const absolutePath = pathResolve('outside', 'topic.md')
    expect(resolveScopedPath({ defaultRoot: 'vault' } as GeoConfig, absolutePath)).toBe(absolutePath)
  })
})
