import type { ProjectContext, ProjectContextResult } from './types.js'

export const DEFAULT_PROJECT_CONTEXT_PATH = 'seo/project-context.json'

const REQUIRED_CONTEXT_FIELDS: Array<keyof ProjectContext> = ['businessGoal', 'audience', 'language', 'market', 'brandName', 'canonicalDomain']

export function createProjectContext(input: Partial<ProjectContext>): ProjectContext {
  return {
    version: '0.4.0',
    updatedAt: new Date().toISOString(),
    businessGoal: input.businessGoal?.trim() || '',
    audience: input.audience?.trim() || '',
    language: input.language?.trim() || '',
    market: input.market?.trim() || '',
    brandName: input.brandName?.trim() || '',
    canonicalDomain: input.canonicalDomain?.trim() || '',
    brandTerms: [...new Set((input.brandTerms || []).map((value) => value.trim()).filter(Boolean))],
    competitors: [...new Set((input.competitors || []).map((value) => value.trim()).filter(Boolean))],
    keyPages: [...new Set((input.keyPages || []).map((value) => value.trim()).filter(Boolean))],
    conversionGoals: [...new Set((input.conversionGoals || []).map((value) => value.trim()).filter(Boolean))],
    constraints: [...new Set((input.constraints || []).map((value) => value.trim()).filter(Boolean))],
    sourceNotes: [...new Set((input.sourceNotes || []).map((value) => value.trim()).filter(Boolean))],
  }
}

export function projectContextResult(path: string, context?: ProjectContext): ProjectContextResult {
  if (!context) {
    return {
      path,
      status: 'missing',
      missingFields: REQUIRED_CONTEXT_FIELDS.map((field) => String(field)),
      nextActions: ['运行 geo_project_context 并填写业务目标、受众、语言/地区、品牌和 canonical domain。'],
    }
  }
  const missingFields = REQUIRED_CONTEXT_FIELDS.filter((field) => !String(context[field] || '').trim()).map((field) => String(field))
  return {
    path,
    status: missingFields.length === 0 ? 'ready' : 'partial',
    context,
    missingFields,
    nextActions: missingFields.length > 0
      ? [`补充字段：${missingFields.join('、')}，再运行 geo_coach 或 geo_workflow。`]
      : ['将 project context 作为所有 SEO/GEO/AEO 任务的默认背景，不必每次重复描述业务。'],
  }
}

export function parseProjectContext(content: string): ProjectContext {
  const parsed: unknown = JSON.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Project context must be a JSON object.')
  return createProjectContext(parsed as Partial<ProjectContext>)
}
