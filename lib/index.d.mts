import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";

//#region src/types.d.ts

interface ScanLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTextChars: number;
  maxResultChars: number;
}
interface GeoConfig extends ScanLimits {
  defaultRoot: string;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-geo";
declare const inject: string[];
type Config = GeoConfig;
declare const Config: Schema<GeoConfig>;
declare function apply(ctx: Context, config: GeoConfig): void;
//#endregion
export { Config, apply, inject, name };