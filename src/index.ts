import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import { registerGeoTools } from './tools.js'
import type { GeoConfig } from './types.js'

export const name = 'dsh-geo'
export const inject = ['tools', 'fs']

export type Config = GeoConfig

export const Config: Schema<GeoConfig> = Schema.object({
  defaultRoot: Schema.string().default('D:\\ObsidianData'),
  maxFiles: Schema.number().default(500),
  maxFileBytes: Schema.number().default(1_048_576),
  maxTextChars: Schema.number().default(180_000),
  maxResultChars: Schema.number().default(50_000),
})

export function apply(ctx: Context, config: GeoConfig): void {
  registerGeoTools(ctx, config)
  console.log(`[${name}] registered SEO/GEO/AEO tools for ${config.defaultRoot}`)
}
