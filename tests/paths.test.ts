import { resolve as pathResolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePreviewContent, resolveRootPath, resolveScopedPath } from '../src/tools.js'
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

describe('resolveRootPath', () => {
  it('resolves the configured relative root once', () => {
    expect(resolveRootPath({ defaultRoot: 'vault' })).toBe(pathResolve('vault'))
  })

  it('resolves an optional relative sub-root under the configured root', () => {
    expect(resolveRootPath({ defaultRoot: 'vault' }, 'team')).toBe(pathResolve('vault', 'team'))
  })
})

describe('resolvePreviewContent', () => {
  it('allows the apply call to reuse the preview-bound content', () => {
    expect(resolvePreviewContent('# updated')).toBe('# updated')
    expect(resolvePreviewContent('# updated', '# updated')).toBe('# updated')
  })

  it('still rejects a mismatched duplicate payload', () => {
    expect(() => resolvePreviewContent('# updated', '# other')).toThrow('Content does not match the preview token.')
  })
})
