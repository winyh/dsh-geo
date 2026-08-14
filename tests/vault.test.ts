import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/markdown.js'
import { summarizeVault } from '../src/vault.js'

describe('summarizeVault', () => {
  it('distinguishes resolved, broken and ambiguous WikiLinks', () => {
    const result = summarizeVault('vault', {
      files: [
        parseNote('vault/consumer.md', '# Consumer\n\n[[docs/source]] [[missing]] [[topic]]'),
        parseNote('vault/docs/source.md', '# Source'),
        parseNote('vault/a/topic.md', '# Topic A'),
        parseNote('vault/b/topic.md', '# Topic B'),
      ],
      skippedFiles: 0,
      errors: [],
    })

    expect(result.summary.brokenLinks).toBe(1)
    expect(result.summary.ambiguousLinks).toBe(1)
    expect(result.summary.orphanNotes).toBeGreaterThan(0)
    expect('status' in result.priorityFiles[0]).toBe(false)
    expect('type' in result.priorityFiles[0]).toBe(false)
    expect('updated' in result.priorityFiles[0]).toBe(false)
  })
})
