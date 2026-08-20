import { describe, expect, it } from 'vitest'
import { buildBacklinkPlan, normalizeBacklinkRecord, recordBacklinkEntry, summarizeBacklinkRecords } from '../src/backlinks.js'

describe('manual backlink workflow', () => {
  it('normalizes tracking parameters and caps quality-mode candidates at ten', () => {
    const plan = buildBacklinkPlan({
      productName: 'Example Product',
      productUrl: 'https://example.com/?utm_source=test#home',
      description: 'A verified product description for teams that need documented answers.',
      mode: 'quality',
      resourceUrls: [
        'https://one.example/submit?utm_source=x',
        'https://two.example/submit',
        'https://three.example/submit',
        'https://four.example/submit',
        'https://five.example/submit',
        'https://six.example/submit',
        'https://seven.example/submit',
        'https://eight.example/submit',
        'https://nine.example/submit',
        'https://ten.example/submit',
        'https://eleven.example/submit',
      ],
    })
    expect(plan.product.url).toBe('https://example.com/')
    expect(plan.candidates).toHaveLength(10)
    expect(plan.excluded).toHaveLength(1)
    expect(plan.candidates[0].normalizedUrl).toBe('https://one.example/submit')
    expect(plan.candidates[0].qualityGate).toBe('not-checked')
    expect(plan.guardrails.join('\n')).toContain('不绕过')
  })

  it('creates an idempotent manual record and prevents a terminal record from being reset', () => {
    const published = normalizeBacklinkRecord({
      productUrl: 'https://example.com',
      resourceUrl: 'https://directory.example/submit?utm_campaign=old',
      status: 'published',
      publicUrl: 'https://directory.example/example-product',
      evidence: ['Public listing: https://directory.example/example-product', 'otp=secret@example.com'],
    })
    const first = recordBacklinkEntry([], published)
    const second = recordBacklinkEntry(first.entries, normalizeBacklinkRecord({
      productUrl: 'https://example.com',
      resourceUrl: 'https://directory.example/submit',
      status: 'not-attempted',
    }))
    expect(first.result.changed).toBe(true)
    expect(second.result.changed).toBe(false)
    expect(second.result.status).toBe('published')
    expect(first.entries[0].evidence.join(' ')).toContain('[redacted]')
  })

  it('summarizes follow-up states without treating submission count as success', () => {
    const entries = [
      normalizeBacklinkRecord({ productUrl: 'https://example.com', resourceUrl: 'https://one.example', status: 'submitted' }),
      normalizeBacklinkRecord({ productUrl: 'https://example.com', resourceUrl: 'https://two.example', status: 'published', publicUrl: 'https://two.example/listing' }),
      normalizeBacklinkRecord({ productUrl: 'https://example.com', resourceUrl: 'https://three.example', status: 'outcome-unknown' }),
    ]
    const summary = summarizeBacklinkRecords(entries)
    expect(summary.total).toBe(3)
    expect(summary.byStatus.submitted).toBe(1)
    expect(summary.byStatus.published).toBe(1)
    expect(summary.needsFollowUp).toHaveLength(2)
    expect(summary.published[0].publicUrl).toBe('https://two.example/listing')
  })
})
