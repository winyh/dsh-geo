// Deterministic external responses; the web registry itself is the real DSH service.
export const inject = ['web']
export function apply(ctx) {
  ctx.web.registerFetchProvider({
    id: 'fixture', available: () => true,
    async fetch({ url }, signal) {
      signal?.throwIfAborted()
      return { url, statusCode: 200, body: { kind: 'html', content: '<title>Fixture evidence</title><h1>Customer report</h1><p>Source-backed product documentation.</p>' }, truncated: false }
    },
  })
  ctx.web.registerSearchProvider({
    id: 'fixture', available: () => true,
    async search(_request, signal) {
      signal?.throwIfAborted()
      return { sources: [{ url: 'https://example.com/evidence', title: 'Fixture evidence' }], truncated: false }
    },
  })
}
