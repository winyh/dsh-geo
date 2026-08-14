import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import { registerGeoTools } from './tools.js'
import type { GeoConfig } from './types.js'

export const name = 'dsh-geo'
export const inject = ['tools', 'fs']

export type Config = GeoConfig

export const Config: Schema<GeoConfig> = Schema.object({
  defaultRoot: Schema.string().default('.'),
  maxFiles: Schema.number().step(1).min(1).max(5_000).default(500),
  maxFileBytes: Schema.number().step(1).min(1_024).max(10_485_760).default(1_048_576),
  maxTextChars: Schema.number().step(1).min(1_000).max(1_000_000).default(180_000),
  maxResultChars: Schema.number().step(1).min(1_000).max(200_000).default(50_000),
})

export function apply(ctx: Context, config: GeoConfig): void {
  registerGeoTools(ctx, config)
  console.log(`[${name}] registered SEO/GEO/AEO tools for ${config.defaultRoot}`)
}
