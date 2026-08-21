import { createHash, randomBytes } from 'node:crypto'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { geoResultEnvelope, geoResultSchema } from './output.js'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-web'
import { createContentBrief, auditNote } from './audit.js'
import { buildBacklinkPlan, extractPreflight, normalizeBacklinkRecord, parseBacklinkRecordFile, recordBacklinkEntry, summarizeBacklinkRecords } from './backlinks.js'
import { DEFAULT_PROJECT_CONTEXT_PATH, createProjectContext, parseProjectContext, projectContextResult } from './context.js'
import { buildEffectReview } from './effect.js'
import { buildKeywordOpportunityMap, importKeywordData } from './keywords.js'
import { buildBacklinkProfile, buildCompetitorGap, buildPromptReview, buildSiteAuditPage, buildSiteAuditResult, parseBacklinkProfileRows, sameOriginLinks } from './research.js'
import { readNote } from './vault.js'
import { scanVault, summarizeVault } from './vault.js'
import { extractTechnicalSeo, fetchPublicDocument, isPublicUrl, readLocalDocument, type SourceDocument } from './web.js'
import { buildKeywordPlan, buildProductionPlan, buildSeoSop } from './workflow.js'
import type { BacklinkStatus, CoachResult, ContentBrief, FileSystemLike, GeoConfig, KeywordOpportunity, KeywordOpportunityMap, KeywordPlan, Pillar, VaultAuditResult } from './types.js'
import { appendArtifactAudit, attachArtifactMetadata, reviewArtifact } from './artifacts.js'

type AuditFocus = Pillar | 'all'

const findingOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    pillar: { type: 'string', enum: ['seo', 'geo', 'aeo'], required: true },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'], required: true },
    message: { type: 'string', required: true },
    evidence: { type: 'string', required: true },
    recommendation: { type: 'string', required: true },
    scoreImpact: { type: 'number', required: true },
  },
} as const

const seoStandardSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    framework: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          area: { type: 'string', enum: ['content', 'crawl-index', 'search-presentation', 'links', 'media', 'monitoring'], required: true },
          status: { type: 'string', enum: ['pass', 'warn', 'unknown'], required: true },
          evidence: { type: 'string', required: true },
          recommendation: { type: 'string', required: true },
        },
        required: true,
      },
      required: true,
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pass: { type: 'number', required: true },
        warn: { type: 'number', required: true },
        unknown: { type: 'number', required: true },
      },
      required: true,
    },
    limitations: { type: 'array', items: { type: 'string' }, required: true },
    references: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const auditOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    focus: { type: 'string', enum: ['seo', 'geo', 'aeo', 'all'], required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
    unknownReasons: { type: 'array', items: { type: 'string' }, required: true },
    truncated: { type: 'boolean', required: true },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seo: { type: 'number', required: true },
        geo: { type: 'number', required: true },
        aeo: { type: 'number', required: true },
        overall: { type: 'number', required: true },
      },
      required: true,
    },
    stats: {
      type: 'object',
      additionalProperties: false,
      properties: {
        wordCount: { type: 'number', required: true },
        headings: { type: 'number', required: true },
        internalLinks: { type: 'number', required: true },
        externalLinks: { type: 'number', required: true },
        sources: { type: 'number', required: true },
        entities: { type: 'number', required: true },
        questions: { type: 'number', required: true },
      },
      required: true,
    },
    seoStandard: seoStandardSchema,
    findings: { type: 'array', items: findingOutputSchema, required: true },
    topActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const vaultAuditSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
    unknownReasons: { type: 'array', items: { type: 'string' }, required: true },
    truncated: { type: 'boolean', required: true },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seo: { type: 'number', required: true },
        geo: { type: 'number', required: true },
        aeo: { type: 'number', required: true },
        overall: { type: 'number', required: true },
      },
      required: true,
    },
    stats: { type: 'json', required: true },
    seoStandard: seoStandardSchema,
    findings: { type: 'array', items: findingOutputSchema, required: true },
    topActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const vaultSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    averageScores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seo: { type: 'number', required: true },
        geo: { type: 'number', required: true },
        aeo: { type: 'number', required: true },
        overall: { type: 'number', required: true },
      },
      required: true,
    },
    missingMetadata: { type: 'number', required: true },
    missingSources: { type: 'number', required: true },
    brokenLinks: { type: 'number', required: true },
    ambiguousLinks: { type: 'number', required: true },
    orphanNotes: { type: 'number', required: true },
    duplicateTitles: { type: 'array', items: { type: 'string' }, required: true },
    staleNotes: { type: 'number', required: true },
    byStatus: { type: 'json', required: true },
    byType: { type: 'json', required: true },
  },
} as const

const vaultFileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    title: { type: 'string', required: true },
    wordCount: { type: 'number', required: true },
    status: { type: 'string' },
    type: { type: 'string' },
    updated: { type: 'string' },
    internalLinks: { type: 'array', items: { type: 'string' }, required: true },
    sourceUrls: { type: 'array', items: { type: 'string' }, required: true },
    audit: vaultAuditSchema,
  },
} as const

const scoreOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seo: { type: 'number', required: true },
    geo: { type: 'number', required: true },
    aeo: { type: 'number', required: true },
    overall: { type: 'number', required: true },
  },
  required: true,
} as const

const vaultOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    scannedFiles: { type: 'number', required: true },
    skippedFiles: { type: 'number', required: true },
    errors: { type: 'array', items: { type: 'string' }, required: true },
    summary: vaultSummarySchema,
    priorityFiles: { type: 'array', items: vaultFileSchema, required: true },
  },
} as const

const briefOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    topic: { type: 'string', required: true },
    intent: { type: 'string', required: true },
    audience: { type: 'string', required: true },
    scores: scoreOutputSchema,
    recommendedTitle: { type: 'string', required: true },
    directAnswer: { type: 'string', required: true },
    outline: { type: 'array', items: { type: 'string' }, required: true },
    questions: { type: 'array', items: { type: 'string' }, required: true },
    entities: { type: 'array', items: { type: 'string' }, required: true },
    sourceGaps: { type: 'array', items: { type: 'string' }, required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const sourceOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    sourceUrls: { type: 'array', items: { type: 'string' }, required: true },
    sourceFields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          value: { type: 'string', required: true },
        },
      },
      required: true,
    },
    updated: { type: 'string', required: true },
    hasSources: { type: 'boolean', required: true },
    freshness: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['fresh', 'stale', 'unknown'], required: true },
        ageDays: { type: 'number', required: true },
        message: { type: 'string', required: true },
      },
      required: true,
    },
    sourceGaps: { type: 'array', items: { type: 'string' }, required: true },
    recommendations: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const previewOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['preview-only', 'applied'], required: true },
    path: { type: 'string', required: true },
    previewToken: { type: 'string', required: true },
    created: { type: 'boolean', required: true },
    oldHash: { type: 'string', required: true },
    newHash: { type: 'string', required: true },
    expiresAt: { type: 'string', required: true },
    changed: { type: 'boolean', required: true },
    applied: { type: 'boolean', required: true },
    guarded: { type: 'boolean', required: true },
  },
} as const

const applyOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['applied'], required: true },
    path: { type: 'string', required: true },
    previewToken: { type: 'string', required: true },
    created: { type: 'boolean', required: true },
    oldHash: { type: 'string', required: true },
    newHash: { type: 'string', required: true },
    changed: { type: 'boolean', required: true },
    applied: { type: 'boolean', required: true },
    guarded: { type: 'boolean', required: true },
  },
} as const

const setupOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    ready: { type: 'boolean', required: true },
    markdownFiles: { type: 'number', required: true },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', enum: ['pass', 'warn', 'fail'], required: true },
          message: { type: 'string', required: true },
        },
      },
      required: true,
    },
    recommendations: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const reportOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    generatedAt: { type: 'string', required: true },
    ruleVersion: { type: 'string', required: true },
    scannedFiles: { type: 'number', required: true },
    skippedFiles: { type: 'number', required: true },
    errors: { type: 'array', items: { type: 'string' }, required: true },
    summary: vaultSummarySchema,
    priorityFiles: { type: 'array', items: vaultFileSchema, required: true },
    reportMarkdown: { type: 'string', required: true },
  },
} as const

const keywordPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ready', 'partial', 'seeds-only'], required: true },
    dataQuality: { type: 'string', enum: ['qualitative', 'seed-only'], required: true },
    volumeDataAvailable: { type: 'boolean', required: true },
    primaryKeyword: { type: 'string', required: true },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string', required: true },
          role: { type: 'string', enum: ['primary', 'secondary', 'question', 'entity'], required: true },
          intent: { type: 'string', enum: ['informational', 'commercial', 'navigational', 'transactional', 'unknown'], required: true },
          evidence: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      required: true,
    },
    searchSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          sourceUrls: { type: 'array', items: { type: 'string' }, required: true },
          observedTitles: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      required: true,
    },
    knowledgeSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          title: { type: 'string', required: true },
          score: { type: 'number', required: true },
          matchedTerms: { type: 'array', items: { type: 'string' }, required: true },
          candidateTerms: { type: 'array', items: { type: 'string' }, required: true },
          excerpt: { type: 'string', required: true },
        },
        required: true,
      },
      required: true,
    },
    seoGuidance: { type: 'array', items: { type: 'string' }, required: true },
    adjustments: { type: 'array', items: { type: 'string' }, required: true },
    unknownReasons: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const productionPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contentInputs: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'array', items: { type: 'string' }, required: true },
        knowledgeBase: { type: 'array', items: { type: 'string' }, required: true },
        seoStandard: { type: 'array', items: { type: 'string' }, required: true },
        keywordMap: { type: 'array', items: { type: 'string' }, required: true },
      },
      required: true,
    },
    stages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', enum: ['diagnose', 'keyword-map', 'draft', 'verify'], required: true },
          objective: { type: 'string', required: true },
          actions: { type: 'array', items: { type: 'string' }, required: true },
          deliverable: { type: 'string', required: true },
        },
      },
      required: true,
    },
    draftContract: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requiredSections: { type: 'array', items: { type: 'string' }, required: true },
        evidenceRules: { type: 'array', items: { type: 'string' }, required: true },
        outputFormat: { type: 'string', required: true },
      },
      required: true,
    },
    writebackInstructions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const sopSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    version: { type: 'string', required: true },
    mode: { type: 'string', enum: ['read-only'], required: true },
    currentStep: { type: 'string', enum: ['define-goal', 'connect-source', 'baseline-audit', 'keyword-map', 'content-brief', 'draft', 'verify', 'preview-writeback', 're-audit'], required: true },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', enum: ['define-goal', 'connect-source', 'baseline-audit', 'keyword-map', 'content-brief', 'draft', 'verify', 'preview-writeback', 're-audit'], required: true },
          order: { type: 'number', required: true },
          title: { type: 'string', required: true },
          status: { type: 'string', enum: ['completed', 'ready', 'blocked'], required: true },
          objective: { type: 'string', required: true },
          inputs: { type: 'array', items: { type: 'string' }, required: true },
          outputs: { type: 'array', items: { type: 'string' }, required: true },
          completionCriteria: { type: 'array', items: { type: 'string' }, required: true },
          nextAction: { type: 'string', required: true },
        },
        required: true,
      },
      required: true,
    },
    completionCriteria: { type: 'array', items: { type: 'string' }, required: true },
    limitations: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const backlinkCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    resource: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        url: { type: 'string', required: true },
        route: { type: 'string', enum: ['product-directory', 'startup-directory', 'developer-community', 'software-directory', 'other'], required: true },
        audience: { type: 'string', required: true },
        relevance: { type: 'string', required: true },
        source: { type: 'string', required: true },
        historicalNote: { type: 'string' },
        requiresAccount: { type: 'boolean' },
      },
      required: true,
    },
    normalizedUrl: { type: 'string', required: true },
    idempotencyKey: { type: 'string', required: true },
    status: { type: 'string', enum: ['not-attempted', 'manual-required', 'submitted', 'awaiting-email-verification', 'awaiting-approval', 'published', 'outcome-unknown', 'failed', 'ineligible', 'unavailable'], required: true },
    qualityGate: { type: 'string', enum: ['not-checked', 'passed', 'failed'], required: true },
    preflight: {
      type: 'object',
      additionalProperties: false,
      properties: {
        checked: { type: 'boolean', required: true },
        statusCode: { type: 'number' },
        finalUrl: { type: 'string' },
        title: { type: 'string' },
        note: { type: 'string', required: true },
      },
      required: true,
    },
    exclusionReasons: { type: 'array', items: { type: 'string' }, required: true },
    nextAction: { type: 'string', required: true },
  },
  required: true,
} as const

const backlinkPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'string', required: true },
    mode: { type: 'string', enum: ['quality', 'batch'], required: true },
    status: { type: 'string', enum: ['ready', 'partial'], required: true },
    product: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', required: true },
        url: { type: 'string', required: true },
        canonicalUrl: { type: 'string', required: true },
      },
      required: true,
    },
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['built-in-catalog', 'user-supplied'], required: true },
        reference: { type: 'string', required: true },
        candidateCount: { type: 'number', required: true },
      },
      required: true,
    },
    candidates: { type: 'array', items: backlinkCandidateSchema, required: true },
    manualQueue: { type: 'array', items: { type: 'string' }, required: true },
    excluded: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          reason: { type: 'string', required: true },
        },
        required: true,
      },
      required: true,
    },
    submissionPack: {
      type: 'object',
      additionalProperties: false,
      properties: {
        shortDescription: { type: 'string', required: true },
        longDescription: { type: 'string', required: true },
        suggestedAnchor: { type: 'string', required: true },
        factsToVerify: { type: 'array', items: { type: 'string' }, required: true },
        prohibitedClaims: { type: 'array', items: { type: 'string' }, required: true },
      },
      required: true,
    },
    guardrails: { type: 'array', items: { type: 'string' }, required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const backlinkRecordResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'string', required: true },
    path: { type: 'string', required: true },
    status: { type: 'string', enum: ['not-attempted', 'manual-required', 'submitted', 'awaiting-email-verification', 'awaiting-approval', 'published', 'outcome-unknown', 'failed', 'ineligible', 'unavailable'], required: true },
    idempotencyKey: { type: 'string', required: true },
    recordedAt: { type: 'string', required: true },
    changed: { type: 'boolean', required: true },
    evidence: { type: 'array', items: { type: 'string' }, required: true },
    nextAction: { type: 'string', required: true },
  },
} as const

const backlinkAuditSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    total: { type: 'number', required: true },
    counts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['not-attempted', 'manual-required', 'submitted', 'awaiting-email-verification', 'awaiting-approval', 'published', 'outcome-unknown', 'failed', 'ineligible', 'unavailable'], required: true },
          count: { type: 'number', required: true },
        },
        required: true,
      },
      required: true,
    },
    published: { type: 'array', items: { type: 'string' }, required: true },
    needsFollowUp: { type: 'array', items: { type: 'string' }, required: true },
    errors: { type: 'array', items: { type: 'string' }, required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const effectSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    period: { type: 'string', required: true },
    source: { type: 'string', required: true },
    impressions: { type: 'number' },
    clicks: { type: 'number' },
    ctrPercent: { type: 'number' },
    averagePosition: { type: 'number' },
    conversions: { type: 'number' },
    indexedPages: { type: 'number' },
    referralVisits: { type: 'number' },
    referralConversions: { type: 'number' },
  },
  required: true,
} as const

const effectReviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'string', required: true },
    target: { type: 'string', required: true },
    status: { type: 'string', enum: ['improving', 'declining', 'mixed', 'inconclusive'], required: true },
    baseline: effectSnapshotSchema,
    current: effectSnapshotSchema,
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          metric: { type: 'string', required: true },
          baseline: { type: 'number' },
          current: { type: 'number' },
          delta: { type: 'number' },
          relativeChangePercent: { type: 'number' },
          direction: { type: 'string', enum: ['up', 'down', 'unchanged', 'unknown'], required: true },
          interpretation: { type: 'string', required: true },
        },
        required: true,
      },
      required: true,
    },
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['striking-distance', 'low-ctr', 'indexing', 'cannibalization'], required: true },
          query: { type: 'string' },
          page: { type: 'string' },
          evidence: { type: 'string', required: true },
          nextAction: { type: 'string', required: true },
        },
        required: true,
      },
      required: true,
    },
    anomalies: { type: 'array', items: { type: 'string' }, required: true },
    dataQuality: { type: 'string', enum: ['comparable', 'partial', 'insufficient'], required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
    limitations: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const projectContextSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
    businessGoal: { type: 'string', required: true },
    audience: { type: 'string', required: true },
    language: { type: 'string', required: true },
    market: { type: 'string', required: true },
    brandName: { type: 'string', required: true },
    canonicalDomain: { type: 'string', required: true },
    brandTerms: { type: 'array', items: { type: 'string' }, required: true },
    competitors: { type: 'array', items: { type: 'string' }, required: true },
    keyPages: { type: 'array', items: { type: 'string' }, required: true },
    conversionGoals: { type: 'array', items: { type: 'string' }, required: true },
    constraints: { type: 'array', items: { type: 'string' }, required: true },
    sourceNotes: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const projectContextResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    status: { type: 'string', enum: ['missing', 'partial', 'ready'], required: true },
    context: projectContextSchema,
    missingFields: { type: 'array', items: { type: 'string' }, required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
  },
  required: true,
} as const

const keywordImportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    imported: { type: 'number', required: true },
    updated: { type: 'number', required: true },
    skipped: { type: 'number', required: true },
    errors: { type: 'array', items: { type: 'string' }, required: true },
    total: { type: 'number', required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
  },
  required: true,
} as const

const keywordOpportunityMapSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    total: { type: 'number', required: true },
    clusters: { type: 'json', required: true },
    cannibalization: { type: 'json', required: true },
    unassigned: { type: 'array', items: { type: 'string' }, required: true },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const coachSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    currentStep: { type: 'string', enum: ['project-context', 'source', 'keyword-import', 'keyword-map', 'effect-review', 'backlink-plan', 'next-diagnosis'], required: true },
    status: { type: 'string', enum: ['ready', 'blocked', 'complete'], required: true },
    reason: { type: 'string', required: true },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          status: { type: 'string', enum: ['present', 'missing', 'partial'], required: true },
          path: { type: 'string' },
          note: { type: 'string', required: true },
        },
        required: true,
      },
      required: true,
    },
    nextActions: { type: 'array', items: { type: 'string' }, required: true },
    suggestedPrompt: { type: 'string', required: true },
  },
  required: true,
} as const

const researchJsonSchema = { type: 'json', required: true } as const

const workflowOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    sourceType: { type: 'string', enum: ['public-url', 'local-markdown', 'private-snapshot'], required: true },
    status: { type: 'string', enum: ['ready', 'partial'], required: true },
    access: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['public-url', 'local-file'], required: true },
        credentialsUsed: { type: 'boolean', required: true },
        limitation: { type: 'string', required: true },
      },
      required: true,
    },
    capture: {
      type: 'object',
      additionalProperties: false,
      properties: {
        finalUrl: { type: 'string', required: true },
        statusCode: { type: 'number', required: true },
        bodyKind: { type: 'string', enum: ['html', 'text', 'markdown', 'snapshot'], required: true },
        capturedAt: { type: 'string', required: true },
        truncated: { type: 'boolean', required: true },
        note: { type: 'string', required: true },
      },
      required: true,
    },
    knowledgeBase: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', required: true },
        scannedFiles: { type: 'number', required: true },
        skippedFiles: { type: 'number', required: true },
        relatedNotes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', required: true },
              title: { type: 'string', required: true },
              score: { type: 'number', required: true },
              matchedTerms: { type: 'array', items: { type: 'string' }, required: true },
              candidateTerms: { type: 'array', items: { type: 'string' }, required: true },
              excerpt: { type: 'string', required: true },
            },
            required: true,
          },
          required: true,
        },
        errors: { type: 'array', items: { type: 'string' }, required: true },
        privacy: { type: 'string', required: true },
      },
      required: true,
    },
    projectContext: projectContextResultSchema,
    audit: auditOutputSchema,
    sop: sopSchema,
    keywordPlan: keywordPlanSchema,
    keywordOpportunities: keywordOpportunityMapSchema,
    contentBrief: briefOutputSchema,
    productionPlan: productionPlanSchema,
    writeback: {
      type: 'object',
      additionalProperties: false,
      properties: {
        canPreviewExistingFile: { type: 'boolean', required: true },
        canCreateNewFile: { type: 'boolean', required: true },
        instructions: { type: 'array', items: { type: 'string' }, required: true },
      },
      required: true,
    },
  },
} as const

interface ContentPreview {
  path: string
  content: string
  oldContent: string
  version: unknown
  created: boolean
  oldHash: string
  newHash: string
  expiresAt: number
  used: boolean
}

function renderValue(value: unknown, maxChars: number) {
  const text = JSON.stringify(value, null, 2)
  const rendered = text.length > maxChars ? `${text.slice(0, maxChars)}\n... result presentation truncated by dsh-geo ...` : text
  return [{ type: 'text' as const, text: rendered }]
}

function jsonResult<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function versionKey(version: unknown): string {
  return JSON.stringify(version) ?? String(version)
}

function diffView(path: string, content: string, title: string, oldText: string | null = null) {
  return {
    card: 'diff' as const,
    title,
    diffs: [{ path, oldText, newText: content }],
    locations: [{ path }],
  }
}

function diffOldText(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || !('oldText' in meta)) return null
  const value = meta.oldText
  return typeof value === 'string' ? value : null
}

function projectReport(result: VaultAuditResult): string {
  const { summary } = result
  const priority = result.priorityFiles.length > 0
    ? result.priorityFiles.map((file, index) => String(index + 1) + ". " + file.path + " - " + file.audit.scores.overall + "/100").join('\n')
    : '- No Markdown files were found.'
  const nextSteps = [
    result.priorityFiles.length > 0
      ? `Start with ${result.priorityFiles[0].path}: run geo_audit_note, then preview one focused content change.`
      : '',
    summary.missingSources > 0
      ? `Run geo_source_check on the ${summary.missingSources} note(s) without source URLs and add provenance before rewriting copy.`
      : '',
    summary.brokenLinks > 0 || summary.ambiguousLinks > 0
      ? `Repair ${summary.brokenLinks} broken and ${summary.ambiguousLinks} ambiguous internal link(s) before relying on the vault as a knowledge graph.`
      : '',
    summary.staleNotes > 0
      ? `Review the ${summary.staleNotes} stale note(s) and verify their claims before publishing new answers.`
      : '',
  ].filter(Boolean)
  return [
    '# 生成式引擎优化项目报告 / Generative Engine Optimization Report',
    '',
    `- Root: \`${result.root}\``,
    `- Generated at: ${result.generatedAt}`,
    `- Rule version: ${result.ruleVersion}`,
    `- Scanned files: ${result.scannedFiles}`,
    `- Skipped files: ${result.skippedFiles}`,
    '',
    '## Score summary',
    '',
    `- SEO: ${summary.averageScores.seo}/100`,
    `- GEO: ${summary.averageScores.geo}/100`,
    `- AEO: ${summary.averageScores.aeo}/100`,
    `- Overall: ${summary.averageScores.overall}/100`,
    '',
    '## Governance signals',
    '',
    `- Missing metadata: ${summary.missingMetadata}`,
    `- Missing sources: ${summary.missingSources}`,
    `- Broken links: ${summary.brokenLinks}`,
    `- Ambiguous links: ${summary.ambiguousLinks}`,
    `- Orphan notes: ${summary.orphanNotes}`,
    `- Stale notes: ${summary.staleNotes}`,
    `- Duplicate titles: ${summary.duplicateTitles.length}`,
    '',
    '## Priority files',
    '',
    priority,
    '',
    '## Next steps',
    '',
    nextSteps.length > 0 ? nextSteps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '1. Run geo_audit_note on the note that matters most to the current user or business goal.',
    '',
    result.errors.length > 0 ? '## Scan warnings\n\n' + result.errors.map((error) => `- ${error}`).join('\n') : '',
  ].filter(Boolean).join('\n')
}

function freshnessOf(updated: string): { status: 'fresh' | 'stale' | 'unknown'; ageDays: number; message: string } {
  if (!updated) return { status: 'unknown', ageDays: 0, message: 'No updated date was found.' }
  const timestamp = Date.parse(updated)
  if (Number.isNaN(timestamp)) return { status: 'unknown', ageDays: 0, message: `The updated value is not a valid date: ${updated}` }
  const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)))
  return ageDays > 180
    ? { status: 'stale', ageDays, message: `The note was updated ${ageDays} days ago.` }
    : { status: 'fresh', ageDays, message: `The note was updated ${ageDays} days ago.` }
}

function fsFrom(ctx: Context): FileSystemLike {
  return (ctx as unknown as { fs: FileSystemLike }).fs
}

function applyWorkflowContext(
  document: SourceDocument,
  brief: ContentBrief,
  goal?: string,
  audience?: string,
): ContentBrief {
  const contextNote = goal ? [`Business goal: ${goal}`] : []
  return {
    ...brief,
    source: document.source,
    intent: goal || brief.intent,
    audience: audience || brief.audience,
    nextActions: [...contextNote, ...brief.nextActions],
  }
}

function workflowStatus(document: SourceDocument, keywordPlan: KeywordPlan, knowledgeErrors: string[] = []): 'ready' | 'partial' {
  return document.truncated || keywordPlan.status !== 'ready' || knowledgeErrors.length > 0 ? 'partial' : 'ready'
}

export function resolveRootPath(config: Pick<GeoConfig, 'defaultRoot'>, requested?: string): string {
  const value = requested?.trim()
  if (!value) return config.defaultRoot ? resolvePath(config.defaultRoot) : resolvePath('.')
  if (!config.defaultRoot || isAbsolute(value)) return value
  return resolvePath(config.defaultRoot, value)
}

/** Resolve workspace-relative tool paths against the configured knowledge-base root. */
export function resolveScopedPath(config: GeoConfig, requested: string): string {
  const value = requested.trim()
  if (!config.defaultRoot || isAbsolute(value)) return value
  return resolvePath(config.defaultRoot, value)
}

/** Use the preview-bound content when the caller omits the duplicate payload. */
export function resolvePreviewContent(previewContent: string | undefined, requestedContent?: string): string {
  if (previewContent === undefined) throw new Error('Preview content is unavailable; generate a new preview before applying changes.')
  if (requestedContent !== undefined && requestedContent !== previewContent) {
    throw new Error('Content does not match the preview token.')
  }
  return previewContent
}

function focusAudit(note: Parameters<typeof auditNote>[0], focus?: AuditFocus, context?: Parameters<typeof auditNote>[1]): ReturnType<typeof auditNote> & { focus: AuditFocus } {
  const audit = auditNote(note, context)
  if (!focus || focus === 'all') return { ...audit, focus: 'all' }
  const findings = audit.findings.filter((finding) => finding.pillar === focus)
  return {
    ...audit,
    focus,
    findings,
    topActions: findings
      .sort((a, b) => b.scoreImpact - a.scoreImpact)
      .slice(0, 5)
      .map((finding) => `${finding.pillar.toUpperCase()}：${finding.recommendation}`),
  }
}

async function ensureInsideRoot(fs: FileSystemLike, config: GeoConfig, targetPath: string, signal?: AbortSignal): Promise<string> {
  const scopedTarget = resolveScopedPath(config, targetPath)
  if (!config.defaultRoot) return scopedTarget
  const root = await fs.resolve(config.defaultRoot, { signal })
  const target = await fs.resolve(scopedTarget, { signal })
  if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${targetPath}`)
  return scopedTarget
}

async function readBacklinkRecords(fs: FileSystemLike, path: string, config: GeoConfig, signal?: AbortSignal): Promise<{ path: string; target: unknown; info?: { type: string; size?: number; version: unknown }; entries: ReturnType<typeof parseBacklinkRecordFile> }> {
  const scopedPath = await ensureInsideRoot(fs, config, path, signal)
  const target = await fs.resolve(scopedPath, { signal })
  const info = await fs.stat(target, signal)
  if (!info) return { path: scopedPath, target, entries: [] }
  if (info.type !== 'file') throw new Error(`Backlink record path is not a file: ${path}`)
  if (info.size !== undefined && info.size > config.maxTextChars) throw new Error(`Backlink record exceeds maxTextChars (${config.maxTextChars}): ${path}`)
  const content = await fs.readText(target, signal)
  return { path: scopedPath, target, info, entries: parseBacklinkRecordFile(content) }
}

async function readOptionalTextFile(fs: FileSystemLike, path: string, config: GeoConfig, signal?: AbortSignal): Promise<{ path: string; target: unknown; info?: { type: string; size?: number; version: unknown }; content: string } | undefined> {
  const scopedPath = await ensureInsideRoot(fs, config, path, signal)
  const target = await fs.resolve(scopedPath, { signal })
  const info = await fs.stat(target, signal)
  if (!info) return undefined
  if (info.type !== 'file') throw new Error(`Path is not a file: ${path}`)
  if (info.size !== undefined && info.size > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars}): ${path}`)
  return { path: scopedPath, target, info, content: await fs.readText(target, signal) }
}

function parseJsonArray(content: string, path: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { keywords?: unknown }).keywords)) return (parsed as { keywords: unknown[] }).keywords
    throw new Error(`Expected a JSON array in ${path}.`)
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readKeywordFile(fs: FileSystemLike, path: string, config: GeoConfig, signal?: AbortSignal): Promise<{ path: string; target: unknown; info?: { type: string; size?: number; version: unknown }; items: KeywordOpportunity[] }> {
  const loaded = await readOptionalTextFile(fs, path, config, signal)
  if (!loaded) return { path: await ensureInsideRoot(fs, config, path, signal), target: await fs.resolve(await ensureInsideRoot(fs, config, path, signal), { signal }), items: [] }
  const values = parseJsonArray(loaded.content, path)
  const items = values.filter((value): value is KeywordOpportunity => Boolean(value && typeof value === 'object' && typeof (value as { term?: unknown }).term === 'string'))
  return { ...loaded, items }
}

export function registerGeoTools(ctx: Context, config: GeoConfig): void {
  const fs = fsFrom(ctx)
  const previews = new Map<string, ContentPreview>()

  ctx.tools.register(defineTool({
    name: 'geo_contract_wrap',
    description: 'Normalize a GEO result or imported artifact into the shared six-plugin result envelope. This is a read-only contract adapter and does not validate the underlying analysis.',
    parameters: {
      resultJson: { type: 'string', required: true, description: 'JSON result or artifact to wrap.' },
      artifactType: { type: 'string', description: 'Optional artifact type used in the lineage entry.' },
      source: { type: 'string', description: 'Optional source path, URL or upstream plugin identifier.' },
    },
    output: {
      schema: geoResultSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args) {
      let data: unknown
      try {
        data = JSON.parse(args.resultJson) as unknown
      } catch (error) {
        throw new Error(`resultJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
      const warnings = typeof data === 'object' && data !== null && 'warnings' in data && Array.isArray(data.warnings)
        ? data.warnings.filter((item): item is string => typeof item === 'string')
        : []
      return geoResultEnvelope({
        data: jsonResult(attachArtifactMetadata(data, { staleAfterDays: 30 })),
        warnings,
        lineage: args.source ? [{ source: args.source, ...(args.artifactType ? { fields: [`artifactType:${args.artifactType}`] } : {}) }] : [],
        nextActions: ['保留原始结果和来源；下游插件只消费结构化字段，不把 SEO/GEO 分数直接当作业务结果。'],
      })
    },
  }))

  const prunePreviews = () => {
    const now = Date.now()
    for (const [token, preview] of previews) {
      if (preview.expiresAt <= now) previews.delete(token)
    }
  }

  const presentationMeta = (_args: unknown, value: unknown) => {
    if (!value || typeof value !== 'object' || !('previewToken' in value)) {
      return { path: '', oldText: null, newText: '', truncated: false }
    }
    const token = value.previewToken
    const preview = typeof token === 'string' ? previews.get(token) : undefined
    const maxDiffChars = 20_000
    return {
      path: preview?.path || '',
      oldText: preview ? preview.oldContent.slice(0, maxDiffChars) : null,
      newText: preview ? preview.content.slice(0, maxDiffChars) : '',
      truncated: preview ? preview.oldContent.length > maxDiffChars || preview.content.length > maxDiffChars : false,
    }
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'geo_apply_content') {
      return {
        kind: 'ask' as const,
        reason: 'This will replace a Markdown file. Review the diff and approve the guarded write.',
      }
    }
    return next()
  })

  ctx.tools.register(defineTool({
    name: 'geo_setup_check',
    description: 'Check whether the configured Markdown root is accessible and ready for a local SEO/GEO/AEO scan. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory to check. Defaults to the configured knowledge-base root.' },
    },
    output: {
      schema: setupOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const root = resolveRootPath(config, args.root)
      const checks: Array<{ id: string; status: 'pass' | 'warn' | 'fail'; message: string }> = []
      try {
        await ensureInsideRoot(fs, config, root, exec.signal)
        checks.push({ id: 'root-boundary', status: 'pass', message: 'The requested root is inside the configured defaultRoot.' })
      } catch (error) {
        checks.push({ id: 'root-boundary', status: 'fail', message: error instanceof Error ? error.message : String(error) })
        return {
          root,
          ready: false,
          markdownFiles: 0,
          checks,
          recommendations: ['Set defaultRoot to the intended Markdown knowledge-base directory, then run geo_setup_check again.'],
        }
      }

      let markdownFiles = 0
      try {
        const target = await fs.resolve(root, { signal: exec.signal })
        const info = await fs.stat(target, exec.signal)
        if (!info || info.type !== 'directory') {
          checks.push({ id: 'root-directory', status: 'fail', message: 'The configured root is not an accessible directory.' })
        } else {
          checks.push({ id: 'root-directory', status: 'pass', message: 'The configured root is an accessible directory.' })
          const entries = await fs.listDir(target, exec.signal)
          markdownFiles = entries.filter((entry) => entry.type === 'file' && /\.md(?:own)?$/i.test(entry.name)).length
          checks.push({
            id: 'markdown-presence',
            status: markdownFiles > 0 ? 'pass' : 'warn',
            message: markdownFiles > 0 ? `Found ${markdownFiles} Markdown file(s) at the root.` : 'No Markdown files were found at the root; nested files may still exist.',
          })
        }
      } catch (error) {
        checks.push({ id: 'root-readable', status: 'fail', message: error instanceof Error ? error.message : String(error) })
      }

      checks.push({ id: 'local-first', status: 'pass', message: 'Analysis uses the local Harness filesystem service and does not require GEO-PRO.' })
      const ready = checks.every((check) => check.status !== 'fail')
      return {
        root,
        ready,
        markdownFiles,
        checks,
        recommendations: ready
          ? ['Run geo_audit_note for one note or geo_audit_vault for the full knowledge base.']
          : ['Fix the failed checks before starting a vault scan.'],
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_project_context',
    description: 'Read or safely write the local SEO project context used as the default business, audience, market and brand background. It never sends the context to public search. Reads by default; writing only updates a JSON file inside defaultRoot.',
    parameters: {
      action: { type: 'string', enum: ['read', 'write'], required: true },
      path: { type: 'string', description: `Optional JSON path; defaults to ${DEFAULT_PROJECT_CONTEXT_PATH}.` },
      context: {
        type: 'object',
        additionalProperties: false,
        properties: {
          businessGoal: { type: 'string' },
          audience: { type: 'string' },
          language: { type: 'string' },
          market: { type: 'string' },
          brandName: { type: 'string' },
          canonicalDomain: { type: 'string' },
          brandTerms: { type: 'array', items: { type: 'string' } },
          competitors: { type: 'array', items: { type: 'string' } },
          keyPages: { type: 'array', items: { type: 'string' } },
          conversionGoals: { type: 'array', items: { type: 'string' } },
          constraints: { type: 'array', items: { type: 'string' } },
          sourceNotes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    output: {
      schema: projectContextResultSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const path = args.path?.trim() || DEFAULT_PROJECT_CONTEXT_PATH
      const loaded = await readOptionalTextFile(fs, path, config, exec.signal)
      if (args.action === 'read') {
        if (!loaded) return projectContextResult(path)
        return projectContextResult(path, parseProjectContext(loaded.content))
      }
      const context = createProjectContext(args.context || {})
      const target = loaded?.target || await fs.resolve(await ensureInsideRoot(fs, config, path, exec.signal), { signal: exec.signal })
      const expected = loaded?.info ? { kind: 'replaceIfVersion' as const, version: loaded.info.version } : { kind: 'createIfAbsent' as const }
      await fs.writeText(target, JSON.stringify(context, null, 2) + '\n', expected, exec.signal)
      return projectContextResult(path, context)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_keyword_import',
    description: 'Import user-provided keyword opportunities from CSV, JSON or a Markdown table into a local JSON opportunity file. It preserves qualitative/unknown boundaries and never invents volume or difficulty.',
    parameters: {
      path: { type: 'string', required: true, description: 'JSON path inside defaultRoot, for example seo/keyword-opportunities.json.' },
      data: { type: 'string', required: true, description: 'CSV, JSON array/object with keywords, or Markdown table. Supported fields include term, intent, volume, difficulty, country, targetPage, cluster and status.' },
      source: { type: 'string', description: 'Source label such as Search Console export, Ads export or manual research.' },
    },
    output: {
      schema: keywordImportSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      if (args.data.length > config.maxTextChars) throw new Error(`Keyword import exceeds maxTextChars (${config.maxTextChars}).`)
      const loaded = await readKeywordFile(fs, args.path, config, exec.signal)
      const imported = importKeywordData(loaded.path, loaded.items, args.data, args.source?.trim() || 'manual-import')
      const content = JSON.stringify(imported.items, null, 2) + '\n'
      if (content.length > config.maxTextChars) throw new Error(`Keyword opportunity file exceeds maxTextChars (${config.maxTextChars}). Split the import into focused files.`)
      const expected = loaded.info ? { kind: 'replaceIfVersion' as const, version: loaded.info.version } : { kind: 'createIfAbsent' as const }
      await fs.writeText(loaded.target, content, expected, exec.signal)
      return imported.result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_keyword_opportunities',
    description: 'Build a keyword opportunity map from a local imported JSON file: clusters, target-page mapping, unassigned terms and cannibalization risks. Reads only.',
    parameters: {
      path: { type: 'string', required: true, description: 'JSON opportunity file inside defaultRoot.' },
    },
    output: {
      schema: keywordOpportunityMapSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const loaded = await readKeywordFile(fs, args.path, config, exec.signal)
      return buildKeywordOpportunityMap(loaded.path, loaded.items)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_coach',
    description: 'Route a manual SEO/GEO/AEO project to its next useful action by checking project context, source, keyword map and effect evidence. It is a lightweight SOP guide, not an approval or role workflow.',
    parameters: {
      source: { type: 'string', description: 'Optional public URL or local Markdown/HTML snapshot already chosen for this cycle.' },
      projectContextPath: { type: 'string', description: `Optional context path; defaults to ${DEFAULT_PROJECT_CONTEXT_PATH}.` },
      keywordPath: { type: 'string', description: 'Optional local keyword opportunity JSON path.' },
      effectDataProvided: { type: 'boolean', description: 'Set true when same-scope before/after performance data is ready for geo_effect_review.' },
      backlinkPath: { type: 'string', description: 'Optional local backlink campaign JSON path.' },
      includeBacklink: { type: 'boolean', description: 'Optional; if true, recommend the manual backlink branch after effect review.' },
    },
    output: {
      schema: coachSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec): Promise<CoachResult> {
      const projectContextPath = args.projectContextPath?.trim() || DEFAULT_PROJECT_CONTEXT_PATH
      const contextFile = await readOptionalTextFile(fs, projectContextPath, config, exec.signal)
      const context = contextFile ? parseProjectContext(contextFile.content) : undefined
      const contextStatus = projectContextResult(projectContextPath, context)
      const inputs: Array<{ name: string; status: 'present' | 'missing' | 'partial'; path?: string; note: string }> = [
        { name: 'project-context', status: contextStatus.status === 'ready' ? 'present' : contextStatus.status === 'partial' ? 'partial' : 'missing', path: projectContextPath, note: contextStatus.missingFields.length > 0 ? `缺少：${contextStatus.missingFields.join('、')}` : '业务目标、受众和市场背景已就绪。' },
        { name: 'source', status: args.source?.trim() ? 'present' as const : 'missing' as const, note: args.source?.trim() ? '已有本轮分析来源。' : '尚未指定公开 URL 或本地快照。' },
      ]
      if (contextStatus.status !== 'ready') {
        return {
          currentStep: 'project-context',
          status: 'blocked',
          reason: '先补齐项目上下文，后续关键词和内容优先级才有业务边界。',
          inputs,
          nextActions: contextStatus.nextActions,
          suggestedPrompt: `请运行 geo_project_context action=write，填写 businessGoal、audience、language、market、brandName 和 canonicalDomain；路径使用 ${projectContextPath}。`,
        }
      }
      if (!args.source?.trim()) {
        return {
          currentStep: 'source',
          status: 'blocked',
          reason: '没有来源就无法建立页面基线。',
          inputs,
          nextActions: ['选择公开 URL；若页面需要登录或 JavaScript，先导出 Markdown/HTML 放到 defaultRoot。', '然后运行 geo_workflow，保持只读。'],
          suggestedPrompt: '请运行 geo_workflow，来源是 <公开URL或defaultRoot内的快照路径>，使用 project context 作为默认目标背景，不写文件。',
        }
      }
      const keywordPath = args.keywordPath?.trim()
      if (!keywordPath) {
        return {
          currentStep: 'keyword-import',
          status: 'ready',
          reason: '项目上下文和来源已具备，但还没有独立关键词机会库。',
          inputs: [...inputs, { name: 'keyword-opportunities', status: 'missing', note: '未提供本地关键词 JSON 文件。' }],
          nextActions: ['导入 Search Console、Ads、关键词工具或人工研究结果；缺失字段保持空白。'],
          suggestedPrompt: '请运行 geo_keyword_import，将我的 CSV/JSON/Markdown 关键词数据写入 seo/keyword-opportunities.json，然后运行 geo_keyword_opportunities。',
        }
      }
      const keywordFile = await readKeywordFile(fs, keywordPath, config, exec.signal)
      const map = buildKeywordOpportunityMap(keywordFile.path, keywordFile.items)
      inputs.push({ name: 'keyword-opportunities', status: keywordFile.items.length > 0 ? 'present' : 'missing', path: keywordFile.path, note: `${keywordFile.items.length} 个关键词机会。` })
      if (keywordFile.items.length === 0) {
        return {
          currentStep: 'keyword-import',
          status: 'ready',
          reason: '关键词文件存在但没有可用机会项。',
          inputs,
          nextActions: ['导入至少一组带 term/keyword 的数据；不要用模型估算搜索量。'],
          suggestedPrompt: `请运行 geo_keyword_import，path=${keywordPath}，导入已核实的关键词数据。`,
        }
      }
      if (map.cannibalization.length > 0 || map.unassigned.length > 0) {
        return {
          currentStep: 'keyword-map',
          status: 'ready',
          reason: map.cannibalization.length > 0 ? '发现关键词蚕食，需要先分配主页面。' : '仍有关键词没有目标页面，需要完成页面映射。',
          inputs,
          nextActions: map.nextActions,
          suggestedPrompt: `请运行 geo_keyword_opportunities，path=${keywordPath}，根据结果为每个高优先级词指定唯一目标页面；先解决蚕食，再生产新内容。`,
        }
      }
      if (!args.effectDataProvided) {
        return {
          currentStep: 'effect-review',
          status: 'ready',
          reason: '关键词已经映射，但本轮还没有同口径前后效果数据。',
          inputs,
          nextActions: ['从 Search Console/站点分析导出同页面、同地区/设备和相邻周期的指标。', '把查询级 rows 一并传给 geo_effect_review，以识别第二页、低 CTR、未收录和蚕食机会。'],
          suggestedPrompt: '请运行 geo_effect_review，提供 baseline、current 和 query/page 级 rows；不要把一次变化归因于单一动作。',
        }
      }
      if (args.includeBacklink && !args.backlinkPath?.trim()) {
        return {
          currentStep: 'backlink-plan',
          status: 'ready',
          reason: '内容和效果复盘完成，可以选择相关的手动产品发现/外链分发。',
          inputs: [...inputs, { name: 'backlink-campaign', status: 'missing', note: '未提供外链记录文件；这不是必需项。' }],
          nextActions: ['仅选择真正相关的资源，先运行 geo_backlink_plan 做预检。', '用户在平台原生页面手动完成后，用 geo_backlink_record 记录真实结果。'],
          suggestedPrompt: '请运行 geo_backlink_plan，先做质量筛选和匿名预检，不提交表单；完成平台动作后再记录结果。',
        }
      }
      return {
        currentStep: 'next-diagnosis',
        status: 'complete',
        reason: '当前周期输入齐全，可以回到页面诊断并选择下一项最高影响动作。',
        inputs,
        nextActions: ['运行 geo_workflow 或 geo_audit_note，围绕效果复盘中最高优先级机会做一次小范围改动。', '改动先 geo_preview_content，再写回并重新审计；下一周期保持相同数据口径。'],
        suggestedPrompt: `请对 ${args.source.trim()} 运行 geo_workflow，结合 project context 和已映射关键词，只处理本周期最高优先级问题，并返回新的验证清单。`,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_workflow',
    description: 'Run the complete SEO/GEO/AEO workflow from one public URL or one local Markdown/HTML snapshot: diagnose, build a qualitative keyword plan, create a content-production brief, and return safe write-back instructions. Reads only.',
    parameters: {
      source: { type: 'string', required: true, description: 'Public http(s) URL, local Markdown path, or local HTML export/snapshot from a public or private account page.' },
      goal: { type: 'string', description: 'Optional business or user goal, such as leads, product education, documentation discovery or support deflection.' },
      audience: { type: 'string', description: 'Optional target audience to use in the production brief.' },
      projectContextPath: { type: 'string', description: `Optional local context JSON path; defaults to ${DEFAULT_PROJECT_CONTEXT_PATH}.` },
      keywordPath: { type: 'string', description: 'Optional local imported keyword opportunity JSON path. When supplied, its clusters and page mapping are included in productionPlan.contentInputs.' },
      seedKeywords: { type: 'array', items: { type: 'string' }, description: 'Optional terms supplied by the user; the first term becomes the primary query.' },
      useKnowledgeBase: { type: 'boolean', description: 'Optional; defaults to true and uses local Markdown titles, headings, entities, queries and bounded excerpts as private context for related terms and content inputs.' },
      knowledgeMaxFiles: { type: 'integer', description: 'Optional local knowledge-base scan cap; never exceeds configured maxFiles.' },
    },
    output: {
      schema: workflowOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const source = args.source.trim()
      if (!source) throw new Error('source is required: pass a public URL or a local Markdown/HTML snapshot path.')
      const projectContextPath = args.projectContextPath?.trim() || DEFAULT_PROJECT_CONTEXT_PATH
      const projectContextFile = await readOptionalTextFile(fs, projectContextPath, config, exec.signal)
      const projectContext = projectContextFile ? parseProjectContext(projectContextFile.content) : undefined
      const contextResult = projectContextResult(projectContextPath, projectContext)
      const keywordOpportunityFile = args.keywordPath?.trim() ? await readKeywordFile(fs, args.keywordPath.trim(), config, exec.signal) : undefined
      const keywordOpportunities: KeywordOpportunityMap | undefined = keywordOpportunityFile
        ? buildKeywordOpportunityMap(keywordOpportunityFile.path, keywordOpportunityFile.items)
        : undefined
      const effectiveGoal = args.goal?.trim() || projectContext?.businessGoal || undefined
      const effectiveAudience = args.audience?.trim() || projectContext?.audience || undefined
      let document: SourceDocument
      if (isPublicUrl(source)) {
        document = await fetchPublicDocument(ctx.web, source, config, exec.signal)
      } else {
        const path = await ensureInsideRoot(fs, config, source, exec.signal)
        if (!/\.(?:md|mdown|html?)$/i.test(path)) {
          throw new Error('Local workflow sources must be .md, .mdown, .html or .htm. Export a private/public account page to Markdown or HTML first.')
        }
        document = await readLocalDocument(fs, path, config, exec.signal)
      }
      const audit = focusAudit(document.note, 'all', { sourceType: document.sourceType, finalUrl: document.finalUrl })
      const knowledgeEnabled = args.useKnowledgeBase !== false
      let knowledgeNotes: Awaited<ReturnType<typeof scanVault>>['files'] = []
      let knowledgeSkippedFiles = 0
      let knowledgeErrors: string[] = []
      if (knowledgeEnabled) {
        try {
          const knowledgeRoot = resolveRootPath(config)
          await ensureInsideRoot(fs, config, knowledgeRoot, exec.signal)
          const limits = {
            ...config,
            maxFiles: Math.min(config.maxFiles, Math.max(1, args.knowledgeMaxFiles || config.maxFiles)),
          }
          const scan = await scanVault(fs, knowledgeRoot, limits, exec.signal)
          knowledgeNotes = scan.files
          knowledgeSkippedFiles = scan.skippedFiles
          knowledgeErrors = scan.errors
        } catch (error) {
          knowledgeErrors = [error instanceof Error ? error.message : String(error)]
        }
      }
      // Never send terms extracted from a local Markdown/HTML file to public
      // search. This keeps private snapshots and local knowledge bases local.
      const keywordPlan = await buildKeywordPlan(
        document.note,
        audit,
        isPublicUrl(source) ? ctx.web : undefined,
        args.seedKeywords || [],
        exec.signal,
        knowledgeNotes,
        audit.seoStandard,
      )
      const contentBrief = applyWorkflowContext(
        document,
        createContentBrief(document.note, audit),
        effectiveGoal,
        effectiveAudience,
      )
      const productionPlan = buildProductionPlan(contentBrief, audit, keywordPlan, keywordOpportunities)
      const sop = buildSeoSop({
        source,
        sourceType: document.sourceType,
        sourceTruncated: document.truncated,
        goal: effectiveGoal,
        audience: effectiveAudience,
        knowledgeBaseEnabled: knowledgeEnabled,
        knowledgeBaseIssues: knowledgeErrors,
        audit,
        keywordPlan,
        brief: contentBrief,
      })
      const localFile = document.sourceType !== 'public-url'
      return {
        source,
        sourceType: document.sourceType,
        status: workflowStatus(document, keywordPlan, knowledgeErrors),
        access: {
          mode: isPublicUrl(source) ? 'public-url' as const : 'local-file' as const,
          credentialsUsed: false,
          limitation: isPublicUrl(source)
            ? 'Anonymous public retrieval only. JavaScript-rendered or logged-in pages should be exported as Markdown/HTML and passed as a local snapshot.'
            : document.accessNote,
        },
        capture: {
          finalUrl: document.finalUrl,
          statusCode: document.statusCode,
          bodyKind: document.bodyKind,
          capturedAt: document.capturedAt,
          truncated: document.truncated,
          note: document.accessNote,
        },
        knowledgeBase: {
          enabled: knowledgeEnabled,
          scannedFiles: knowledgeNotes.length,
          skippedFiles: knowledgeSkippedFiles,
          relatedNotes: keywordPlan.knowledgeSignals,
          errors: knowledgeErrors,
          privacy: 'Knowledge-base context stays inside the Harness filesystem. Its titles, headings, entities, queries and bounded excerpts are not sent to public search; only explicit user seedKeywords may be used for URL search signals.',
        },
        projectContext: contextResult,
        audit,
        sop,
        keywordPlan,
        ...(keywordOpportunities ? { keywordOpportunities } : {}),
        contentBrief,
        productionPlan,
        writeback: {
          canPreviewExistingFile: localFile,
          canCreateNewFile: true,
          instructions: localFile
            ? ['Generate the complete Markdown draft from productionPlan, then preview it against the local source path.', 'For a new destination, call geo_preview_content with createIfMissing=true; all destinations remain inside defaultRoot.', 'Apply only after reviewing the diff; geo_apply_content uses a short-lived token and a version guard.']
            : ['The URL itself is read-only. Generate the draft, save/export it to a local Markdown destination, then preview that destination with geo_preview_content.', 'For a private page, keep the exported HTML/Markdown inside defaultRoot; no cookies or credentials are passed to dsh-geo.', 'Apply only after reviewing the diff; geo_apply_content uses a short-lived token and a version guard.'],
        },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_backlink_plan',
    description: 'Build a quality-gated, manual backlink and product-discovery plan from the bundled candidate catalog or user-supplied URLs. It can anonymously preflight public pages, but it never logs in, submits forms, bypasses CAPTCHA, or changes external sites.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Verified public product or company name.' },
      productUrl: { type: 'string', required: true, description: 'Verified canonical public product URL.' },
      description: { type: 'string', required: true, description: 'Verified product description used to prepare submission copy; do not include invented claims.' },
      mode: { type: 'string', enum: ['quality', 'batch'], description: 'quality checks at most 10 candidates per plan; batch can prepare a larger user-supplied queue.' },
      route: { type: 'string', enum: ['product-directory', 'startup-directory', 'developer-community', 'software-directory', 'other'], description: 'Optional route filter.' },
      resourceUrls: { type: 'array', items: { type: 'string' }, description: 'Optional candidate URLs. If omitted, use the bundled catalog adapted from backlink_skills.' },
      maxCandidates: { type: 'integer', description: 'Optional candidate cap. Quality mode is capped at 10.' },
      verifyResources: { type: 'boolean', description: 'Optional; defaults to true and performs anonymous read-only HTTP preflight.' },
    },
    output: {
      schema: backlinkPlanSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const baseInput = {
        productName: args.productName.trim(),
        productUrl: args.productUrl.trim(),
        description: args.description.trim(),
        mode: args.mode,
        route: args.route,
        resourceUrls: args.resourceUrls,
        maxCandidates: args.maxCandidates,
      }
      if (!baseInput.productName || !baseInput.productUrl || !baseInput.description) throw new Error('productName, productUrl and verified description are required.')
      let plan = buildBacklinkPlan(baseInput)
      if (args.verifyResources !== false) {
        const preflights = []
        for (const candidate of plan.candidates) {
          try {
            const result = await ctx.web.fetch({ url: candidate.normalizedUrl }, exec.signal)
            preflights.push(extractPreflight(result, `匿名只读预检完成：HTTP ${result.statusCode}。这不是平台提交结果。`, candidate.normalizedUrl))
          } catch (error) {
            preflights.push({
              url: candidate.normalizedUrl,
              note: `匿名只读预检失败：${error instanceof Error ? error.message : String(error)}。请在浏览器中人工核验，不要直接提交。`,
            })
          }
        }
        plan = buildBacklinkPlan({ ...baseInput, preflights })
      }
      return plan
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_backlink_record',
    description: 'Record a user-completed backlink or product-directory action in a local JSON campaign file. This does not submit forms or access credentials; it prevents ambiguous outcomes from being retried and keeps a manual audit trail.',
    parameters: {
      path: { type: 'string', required: true, description: 'JSON record path inside defaultRoot, for example backlinks/campaign.json.' },
      productUrl: { type: 'string', required: true, description: 'Canonical product URL used to derive the idempotency key.' },
      resourceUrl: { type: 'string', required: true, description: 'The candidate resource or submission route URL.' },
      status: { type: 'string', enum: ['not-attempted', 'manual-required', 'submitted', 'awaiting-email-verification', 'awaiting-approval', 'published', 'outcome-unknown', 'failed', 'ineligible', 'unavailable'], required: true },
      evidence: { type: 'array', items: { type: 'string' }, description: 'Short, non-sensitive evidence such as a public listing URL, visible receipt text, or an opaque screenshot reference.' },
      publicUrl: { type: 'string', description: 'Public listing URL after publication, if available.' },
      anchorText: { type: 'string', description: 'Actual public anchor text, if visible.' },
      linkRel: { type: 'string', description: 'Actual rel attribute, if visible; do not request a preferred link attribute.' },
      note: { type: 'string', description: 'Short factual note. Do not include passwords, cookies, OTPs, raw email addresses or session URLs.' },
    },
    output: {
      schema: backlinkRecordResultSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const loaded = await readBacklinkRecords(fs, args.path, config, exec.signal)
      const entry = normalizeBacklinkRecord({
        productUrl: args.productUrl,
        resourceUrl: args.resourceUrl,
        status: args.status,
        evidence: args.evidence,
        publicUrl: args.publicUrl,
        anchorText: args.anchorText,
        linkRel: args.linkRel,
        note: args.note,
      })
      const recorded = recordBacklinkEntry(loaded.entries, entry)
      recorded.result.path = loaded.path
      if (recorded.result.changed) {
        const content = JSON.stringify(recorded.entries, null, 2) + '\n'
        if (content.length > config.maxTextChars) throw new Error(`Backlink record exceeds maxTextChars (${config.maxTextChars}). Use a new campaign file or archive old records.`)
        const expected = loaded.info ? { kind: 'replaceIfVersion' as const, version: loaded.info.version } : { kind: 'createIfAbsent' as const }
        await fs.writeText(loaded.target, content, expected, exec.signal)
      }
      return recorded.result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_backlink_audit',
    description: 'Audit a local backlink campaign record and return manual follow-up items, terminal outcomes and data-quality errors. Reads only.',
    parameters: {
      path: { type: 'string', required: true, description: 'JSON record path inside defaultRoot.' },
    },
    output: {
      schema: backlinkAuditSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const loaded = await readBacklinkRecords(fs, args.path, config, exec.signal)
      const summary = summarizeBacklinkRecords(loaded.entries)
      const statuses: BacklinkStatus[] = ['not-attempted', 'manual-required', 'submitted', 'awaiting-email-verification', 'awaiting-approval', 'published', 'outcome-unknown', 'failed', 'ineligible', 'unavailable']
      return {
        path: loaded.path,
        total: summary.total,
        counts: statuses.map((status) => ({ status, count: summary.byStatus[status] })),
        published: summary.published.map((entry) => entry.publicUrl || entry.resourceUrl),
        needsFollowUp: summary.needsFollowUp.map((entry) => entry.idempotencyKey),
        errors: summary.errors,
        nextActions: [
          ...(summary.needsFollowUp.length > 0 ? ['先核对提交回执、邮箱和公开页面，再更新 pending 或 outcome-unknown 记录。'] : []),
          ...(summary.published.length > 0 ? ['把公开条目、推荐访问和转化纳入下一轮手动效果评估。'] : []),
          ...(summary.errors.length > 0 ? ['修复重复 idempotencyKey 或非法状态后再继续提交。'] : []),
          ...(summary.total === 0 ? ['先运行 geo_backlink_plan，再在用户完成真实平台动作后记录结果。'] : []),
        ],
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_effect_review',
    description: 'Compare two manually supplied SEO, site-analytics or referral snapshots and return a cautious effect review plus the next diagnosis action. Reads only; it does not connect to external analytics accounts or invent missing metrics.',
    parameters: {
      target: { type: 'string', required: true, description: 'Page, campaign or product being evaluated.' },
      baseline: {
        type: 'object',
        additionalProperties: false,
        properties: {
          period: { type: 'string', required: true, description: 'Baseline period, using the same timezone and device/region scope as current.' },
          source: { type: 'string', required: true, description: 'Data source, such as Search Console export or site analytics.' },
          impressions: { type: 'number' },
          clicks: { type: 'number' },
          ctrPercent: { type: 'number', description: 'CTR as percentage points, for example 2.4 means 2.4%.' },
          averagePosition: { type: 'number' },
          conversions: { type: 'number' },
          indexedPages: { type: 'number' },
          referralVisits: { type: 'number' },
          referralConversions: { type: 'number' },
        },
        required: true,
      },
      current: {
        type: 'object',
        additionalProperties: false,
        properties: {
          period: { type: 'string', required: true },
          source: { type: 'string', required: true },
          impressions: { type: 'number' },
          clicks: { type: 'number' },
          ctrPercent: { type: 'number' },
          averagePosition: { type: 'number' },
          conversions: { type: 'number' },
          indexedPages: { type: 'number' },
          referralVisits: { type: 'number' },
          referralConversions: { type: 'number' },
        },
        required: true,
      },
      rows: {
        type: 'array',
        description: 'Optional query/page-level rows from the same reporting scope. Used only to route second-page, low-CTR, indexing and cannibalization opportunities.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            page: { type: 'string' },
            impressions: { type: 'number' },
            clicks: { type: 'number' },
            ctrPercent: { type: 'number' },
            averagePosition: { type: 'number' },
            indexed: { type: 'boolean' },
            indexNote: { type: 'string' },
          },
        },
      },
    },
    output: {
      schema: effectReviewSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args) {
      if (!args.target.trim() || !args.baseline.period.trim() || !args.current.period.trim()) throw new Error('target, baseline.period and current.period are required.')
      return buildEffectReview({ target: args.target.trim(), baseline: args.baseline, current: args.current, rows: args.rows })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_competitor_gap',
    description: 'Compare user-supplied target and competitor keyword/topic/page inventories to identify research gaps. Reads only; it does not scrape competitor sites or infer traffic and rankings.',
    parameters: {
      target: {
        type: 'object',
        additionalProperties: false,
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          topics: { type: 'array', items: { type: 'string' } },
          pages: { type: 'array', items: { type: 'string' } },
        },
        required: true,
      },
      competitors: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            url: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            topics: { type: 'array', items: { type: 'string' } },
            pages: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: true,
        },
      },
    },
    output: {
      schema: researchJsonSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args) {
      return jsonResult(buildCompetitorGap({ target: args.target, competitors: args.competitors }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_backlink_profile',
    description: 'Review user-supplied backlink CSV/JSON rows for broken, lost, nofollow/sponsored/ugc, risky and competitor-gap signals. Reads only and does not judge links by quantity alone.',
    parameters: {
      rows: {
        type: 'array',
        required: true,
        description: 'Rows with sourceUrl and optional targetUrl, referringDomain, nofollow, sponsored, ugc, broken, lost, spamScore.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceUrl: { type: 'string', required: true },
            targetUrl: { type: 'string' },
            referringDomain: { type: 'string' },
            anchor: { type: 'string' },
            nofollow: { type: 'boolean' },
            sponsored: { type: 'boolean' },
            ugc: { type: 'boolean' },
            broken: { type: 'boolean' },
            lost: { type: 'boolean' },
            spamScore: { type: 'number' },
            competitor: { type: 'string' },
            capturedAt: { type: 'string' },
          },
          required: true,
        },
      },
      competitorRows: {
        type: 'array',
        description: 'Optional competitor backlink rows in the same shape, used only for referring-domain gap hints.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceUrl: { type: 'string', required: true },
            referringDomain: { type: 'string' },
          },
          required: true,
        },
      },
    },
    output: {
      schema: researchJsonSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args) {
      const rows = parseBacklinkProfileRows(args.rows)
      const competitorRows = parseBacklinkProfileRows(args.competitorRows || [])
      if (rows.length === 0) throw new Error('At least one backlink row with sourceUrl is required.')
      return jsonResult(buildBacklinkProfile(rows, competitorRows))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_site_audit',
    description: 'Run a bounded, same-origin, anonymous HTML audit from a public URL. It checks page-level title, description, canonical, robots, H1, links, image alt and structured-data signals; it does not crawl private areas or claim Lighthouse/Search Console results.',
    parameters: {
      startUrl: { type: 'string', required: true, description: 'Public http(s) start URL.' },
      maxPages: { type: 'integer', description: 'Optional cap, never above 50; defaults to 10.' },
      maxDepth: { type: 'integer', description: 'Optional same-origin link depth, 0-2; defaults to 1.' },
    },
    output: {
      schema: researchJsonSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const startUrl = args.startUrl.trim()
      if (!isPublicUrl(startUrl)) throw new Error('geo_site_audit requires a public http(s) URL.')
      const maxPages = Math.min(50, Math.max(1, args.maxPages ?? 10))
      const maxDepth = Math.min(2, Math.max(0, args.maxDepth ?? 1))
      const origin = new URL(startUrl).origin
      const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }]
      const queued = new Set([startUrl])
      const visited = new Set<string>()
      const pages = []
      const skippedLinks: string[] = []
      while (queue.length > 0 && pages.length < maxPages) {
        const next = queue.shift()
        if (!next || visited.has(next.url)) continue
        visited.add(next.url)
        try {
          const result = await ctx.web.fetch({ url: next.url }, exec.signal)
          const html = result.body.content
          const isHtml = result.body.kind === 'html'
          const technical = isHtml ? extractTechnicalSeo(html, result.url) : undefined
          pages.push(buildSiteAuditPage({
            url: next.url,
            finalUrl: result.url,
            statusCode: result.statusCode,
            html: isHtml ? html : '',
            technical,
            truncated: result.truncated,
          }))
          if (isHtml && next.depth < maxDepth && result.statusCode >= 200 && result.statusCode < 400) {
            const discovered = sameOriginLinks(html, result.url)
            skippedLinks.push(...discovered.skipped)
            for (const link of discovered.links) {
              try {
                if (new URL(link).origin !== origin || queued.has(link)) continue
                queued.add(link)
                queue.push({ url: link, depth: next.depth + 1 })
              } catch {
                skippedLinks.push(link)
              }
            }
          }
        } catch (error) {
          skippedLinks.push(`${next.url}：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return jsonResult(buildSiteAuditResult({ startUrl, pages, skippedLinks, maxPages, depth: maxDepth }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_prompt_review',
    description: 'Review manually captured answer-engine prompts across models for brand mention and citation evidence. Reads only; it does not scrape model interfaces or claim universal AI visibility.',
    parameters: {
      runs: {
        type: 'array',
        required: true,
        description: 'Manual records with prompt, model, capturedAt, answer, citedUrls and optional brandMentioned.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: { type: 'string', required: true },
            model: { type: 'string', required: true },
            capturedAt: { type: 'string', required: true },
            answer: { type: 'string', required: true },
            citedUrls: { type: 'array', items: { type: 'string' }, required: true },
            brandMentioned: { type: 'boolean' },
          },
          required: true,
        },
      },
    },
    output: {
      schema: researchJsonSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args) {
      if (args.runs.length === 0) throw new Error('At least one manually captured prompt run is required.')
      return jsonResult(buildPromptReview(args.runs))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_project_report',
    description: 'Create a structured, shareable project report for the Markdown knowledge base. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory. Defaults to the configured knowledge-base root.' },
      maxFiles: { type: 'integer', description: 'Optional scan cap; never exceeds configured maxFiles.' },
    },
    output: {
      schema: reportOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const root = resolveRootPath(config, args.root)
      await ensureInsideRoot(fs, config, root, exec.signal)
      const limits = { ...config, maxFiles: Math.min(config.maxFiles, Math.max(1, args.maxFiles || config.maxFiles)) }
      const scan = await scanVault(fs, root, limits, exec.signal)
      const result = summarizeVault(root, scan)
      return {
        ...result,
        reportMarkdown: projectReport(result),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_audit_note',
    description: 'Audit one Markdown note for explainable SEO, GEO and AEO readiness. Reads only; does not change files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or workspace-relative Markdown path.' },
      focus: { type: 'string', enum: ['seo', 'geo', 'aeo', 'all'], description: 'Optional focus: seo, geo, aeo, or all.' },
    },
    output: {
      schema: auditOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, path, config, exec.signal)
      return focusAudit(note, args.focus)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_audit_vault',
    description: 'Scan a Markdown knowledge base and report metadata, link, source, orphan and SEO/GEO/AEO health. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory. Defaults to the configured knowledge-base root.' },
      maxFiles: { type: 'number', description: 'Optional scan cap; never exceeds configured maxFiles.' },
    },
    output: {
      schema: vaultOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const root = resolveRootPath(config, args.root)
      await ensureInsideRoot(fs, config, root, exec.signal)
      const limits = { ...config, maxFiles: Math.min(config.maxFiles, Math.max(1, args.maxFiles || config.maxFiles)) }
      const scan = await scanVault(fs, root, limits, exec.signal)
      return summarizeVault(root, scan)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_content_brief',
    description: 'Create a structured content brief from a Markdown note, including query, intent, audience, outline, questions and source gaps.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown note path.' },
    },
    output: {
      schema: briefOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, path, config, exec.signal)
      return createContentBrief(note, auditNote(note))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_source_check',
    description: 'Check source URLs, provenance fields, freshness metadata and source gaps in one Markdown note.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown note path.' },
    },
    output: {
      schema: sourceOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, path, config, exec.signal)
      const sourceFields = Object.entries(note.frontmatter)
        .filter(([key]) => /source|citation|reference|url/i.test(key))
        .map(([key, value]) => ({
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value) ?? String(value),
        }))
      const updated = typeof note.frontmatter.updated === 'string' ? note.frontmatter.updated : ''
      const freshness = freshnessOf(updated)
      const sourceGaps = [
        ...(note.sourceUrls.length === 0 ? ['Add at least one primary source URL.'] : []),
        ...(!updated ? ['Add an updated date in frontmatter.'] : []),
        ...(freshness.status === 'unknown' && updated ? ['Use an ISO-compatible updated date so freshness can be checked.'] : []),
      ]
      const result = {
        path: note.path,
        sourceUrls: note.sourceUrls,
        sourceFields,
        updated,
        hasSources: note.sourceUrls.length > 0,
        freshness,
        sourceGaps,
        recommendations: sourceGaps.length > 0
          ? sourceGaps
          : freshness.status === 'stale'
            ? ['Refresh stale sources and record the review date before publishing.']
            : ['Confirm every key claim maps to a source, and distinguish facts, opinions and inferences.'],
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_preview_content',
    description: 'Preview a complete Markdown replacement and return a short-lived token for a later guarded apply. Never changes files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown file to update.' },
      content: { type: 'string', required: true, description: 'Complete replacement Markdown content.' },
      createIfMissing: { type: 'boolean', description: 'Set true to preview creating a new Markdown file. Defaults to false.' },
    },
    output: {
      schema: previewOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
      presentationMeta,
    },
    presentCall(args) {
      return diffView(args.path, args.content, `Preview changes: ${args.path}`)
    },
    presentResult(args, result) {
      if (result.isError) return { card: 'generic', title: `Preview failed: ${args.path}`, content: result.content }
      return diffView(args.path, args.content, `Preview ready: ${args.path}`, diffOldText(result.meta))
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      const target = await fs.resolve(path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (info && info.type !== 'file') throw new Error(`Target is not a file: ${args.path}`)
      if (!info && !args.createIfMissing) throw new Error(`File not found: ${args.path}. Set createIfMissing=true to preview a new Markdown file.`)
      if (!/\.(?:md|mdown)$/i.test(path)) throw new Error('Only .md and .mdown destinations can be previewed.')
      if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`)
      const current = info ? await fs.readText(target, exec.signal) : ''
      const token = randomBytes(18).toString('hex')
      const oldHash = contentHash(current)
      const newHash = contentHash(args.content)
      const expiresAt = Date.now() + 10 * 60 * 1000
      prunePreviews()
      previews.set(token, { path, content: args.content, oldContent: current, version: info?.version, created: !info, oldHash, newHash, expiresAt, used: false })
      return {
        status: 'preview-only' as const,
        path,
        previewToken: token,
        created: !info,
        oldHash,
        newHash,
        expiresAt: new Date(expiresAt).toISOString(),
        changed: args.content !== current,
        applied: false,
        guarded: true,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_growth_measurement_plan',
    description: 'Create a measurable GEO-to-growth handoff for one content or search asset. It defines the target metric and window but never claims causality.',
    parameters: {
      contentId: { type: 'string', required: true, description: 'Stable content, page or asset ID.' },
      channel: { type: 'string', required: true, description: 'Channel such as organic-search, ai-answer, referral or directory.' },
      targetMetric: { type: 'string', required: true, description: 'Metric to observe, such as qualifiedSignup, activation or paidConversion.' },
      query: { type: 'string', description: 'Primary query or topic.' },
      audience: { type: 'string', description: 'Target audience or segment.' },
      publishAt: { type: 'string', required: true, description: 'ISO timestamp or date when the asset became observable.' },
      baselineWindow: { type: 'string', required: true, description: 'Baseline window, for example 2026-07-01/2026-07-31.' },
      source: { type: 'string', description: 'Source note, URL or content brief.' },
    },
    output: { schema: geoResultSchema, render: (_args, value) => renderValue(value, config.maxResultChars), presentationMeta },
    async execute(args) {
      const plan = attachArtifactMetadata({ artifactType: 'geo-growth-measurement-plan', generatedAt: new Date().toISOString(), contentId: args.contentId.trim(), channel: args.channel.trim(), targetMetric: args.targetMetric.trim(), ...(args.query?.trim() ? { query: args.query.trim() } : {}), ...(args.audience?.trim() ? { audience: args.audience.trim() } : {}), publishAt: args.publishAt.trim(), baselineWindow: args.baselineWindow.trim(), ...(args.source?.trim() ? { source: args.source.trim() } : {}), warnings: ['此计划只建立可观测关系；没有实验设计或对照组时，不得宣称因果。'], nextActions: ['在增长数据中用相同 contentId/channel 记录观察窗口，再交给 growth_attribution_review。'] }, { staleAfterDays: 90 })
      return geoResultEnvelope({ data: jsonResult(plan), lineage: args.source?.trim() ? [{ source: args.source.trim() }] : [], nextActions: plan.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_artifact_review',
    description: 'Validate a GEO/SEO/AEO artifact before using it as a growth input. Checks schema, stable ID and freshness without changing files.',
    parameters: {
      artifactJson: { type: 'string', required: true, description: 'JSON returned by a plugin tool.' },
      expectedType: { type: 'string', description: 'Optional expected artifactType.' },
    },
    output: { schema: geoResultSchema, render: (_args, value) => renderValue(value, config.maxResultChars), presentationMeta },
    async execute(args) {
      let value: unknown
      try { value = JSON.parse(args.artifactJson) as unknown } catch (error) { throw new Error(`artifactJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
      const data = typeof value === 'object' && value !== null && 'data' in value ? (value as { data: unknown }).data : value
      const review = reviewArtifact(data, args.expectedType?.trim() || undefined)
      return geoResultEnvelope({ data: jsonResult({ artifactType: 'geo-artifact-review', generatedAt: new Date().toISOString(), ...review }), nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'geo_apply_content',
    description: 'Apply a previously previewed Markdown replacement after explicit approval. Requires a valid preview token, can reuse its bound content when content is omitted, and refuses stale files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown file to update.' },
      content: { type: 'string', description: 'Optional exact content returned for the preview. Omit it to reuse the content bound to previewToken.' },
      previewToken: { type: 'string', required: true, description: 'Short-lived token returned by geo_preview_content.' },
    },
    output: {
      schema: applyOutputSchema,
      render: (_args, value) => renderValue(value, config.maxResultChars),
      presentationMeta,
    },
    presentCall(args) {
      const preview = previews.get(args.previewToken)
      const content = typeof args.content === 'string' ? args.content : preview?.content || ''
      return diffView(args.path, content, `Apply changes: ${args.path}`, preview?.oldContent.slice(0, 20_000) || null)
    },
    presentResult(args, result) {
      if (result.isError) return { card: 'generic', title: `Apply blocked: ${args.path}`, content: result.content }
      const preview = previews.get(args.previewToken)
      const content = typeof args.content === 'string' ? args.content : preview?.content || ''
      return diffView(args.path, content, `Applied changes: ${args.path}`, diffOldText(result.meta))
    },
    async execute(args, exec) {
      const path = await ensureInsideRoot(fs, config, args.path, exec.signal)
      prunePreviews()
      const preview = previews.get(args.previewToken)
      if (!preview || preview.path !== path || preview.used) throw new Error('Preview token is missing, expired, already used, or belongs to another path.')
      const content = resolvePreviewContent(preview.content, args.content)
      const target = await fs.resolve(path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (preview.created) {
        if (info) throw new Error('The destination appeared after preview; generate a new preview before creating it.')
        await fs.writeText(target, content, { kind: 'createIfAbsent' }, exec.signal)
      } else {
        if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
        const current = await fs.readText(target, exec.signal)
        if (contentHash(current) !== preview.oldHash || versionKey(info.version) !== versionKey(preview.version)) {
          throw new Error('File changed after preview; generate a new preview before applying changes.')
        }
        await fs.writeText(target, content, { kind: 'replaceIfVersion', version: preview.version }, exec.signal)
      }
      preview.used = true
      let audit: unknown
      try { audit = await appendArtifactAudit(fs, config.defaultRoot, { action: 'apply', path, beforeHash: preview.oldHash, afterHash: contentHash(content), approved: true }, exec.signal) } catch (error) { audit = { status: 'audit-failed', warning: error instanceof Error ? error.message : String(error) } }
      return {
        status: 'applied' as const,
        path,
        previewToken: args.previewToken,
        created: preview.created,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        changed: true,
        applied: true,
        guarded: true,
        audit,
      }
    },
  }))

}
