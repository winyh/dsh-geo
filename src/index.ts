import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import * as webFetchHttp from '@deepseek-ai/dsh-web-fetch-http'
import type {} from '@deepseek-ai/dsh-web'
import { registerGeoTools } from './tools.js'
import type { GeoConfig } from './types.js'

export const name = 'dsh-geo'
export const inject = ['tools', 'fs', 'web']

export type Config = GeoConfig

export const Config: Schema<GeoConfig> = Schema.object({
  defaultRoot: Schema.string().default('.'),
  maxFiles: Schema.number().step(1).min(1).max(5_000).default(500),
  maxFileBytes: Schema.number().step(1).min(1_024).max(10_485_760).default(1_048_576),
  maxTextChars: Schema.number().step(1).min(1_000).max(1_000_000).default(180_000),
  maxResultChars: Schema.number().step(1).min(1_000).max(200_000).default(50_000),
})

export function apply(ctx: Context, config: GeoConfig): void {
  // The provider is anonymous public HTTP(S) only. Private pages remain local
  // snapshot inputs, so cookies and credentials never enter this plugin.
  if (!ctx.registry.has(webFetchHttp)) {
    void ctx.plugin(webFetchHttp, {
      maxBodyChars: Math.min(config.maxTextChars, 100_000),
      maxResponseBytes: 5_000_000,
      timeoutMs: 30_000,
      maxRedirects: 5,
    })
  }
  registerGeoTools(ctx, config)
  console.log(`[${name}] registered SEO/GEO/AEO tools for ${config.defaultRoot}`)
}
