import type { HandoffRoute } from './handoff-receive.js'

// Locally owned contract; no shared runtime package or cross-repository import.
export const handoffRoutes: Record<string, HandoffRoute> = {
  "product-discoverability-handoff": {
    "from": "dsh-product",
    "nextTool": "geo_content_brief",
    "purpose": "只根据允许公开的产品事实制作内容 Brief，保留禁止承诺和测量指标。",
    "text": [
      "source",
      "productName",
      "audience",
      "targetMetric"
    ],
    "lists": [
      "publicFacts",
      "evidence",
      "claimBoundaries"
    ],
    "mode": "direct"
  }
}
