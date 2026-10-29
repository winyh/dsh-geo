import Schema from "@deepseek-ai/schemastery";
import { createHash, randomBytes } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/artifact-integrity.ts
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
	return value;
}
function integrityHash(value) {
	const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contentHash"));
	return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}
function validDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
	const day = value.slice(0, 10);
	const parsed = Date.parse(day + "T00:00:00Z");
	return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}

//#endregion
//#region src/artifacts.ts
const artifactDomain = "dsh-geo";
function normalized(value) {
	if (Array.isArray(value)) return value.map(normalized);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => ![
		"artifactId",
		"generatedAt",
		"capturedAt",
		"markdown",
		"warnings",
		"nextActions"
	].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
	return value;
}
function contentHash$1(value) {
	const raw = typeof value === "string" ? value : JSON.stringify(normalized(value));
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}
function slug(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "artifact";
}
function createArtifactId(value) {
	return `${artifactDomain}-${slug(typeof value.artifactType === "string" ? value.artifactType : "artifact")}-${contentHash$1(value).slice(0, 12)}`;
}
function addDays(iso, days) {
	const date = new Date(iso);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString();
}
function attachArtifactMetadata(value, options = {}) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const record = value;
	if (typeof record.artifactType !== "string" || !record.artifactType.trim()) return value;
	if (record.hashVersion === "sha256-v2") return value;
	const generatedAt = typeof record.generatedAt === "string" && record.generatedAt ? record.generatedAt : (/* @__PURE__ */ new Date()).toISOString();
	const result = {
		...record,
		schemaVersion: typeof record.schemaVersion === "string" ? record.schemaVersion : "1.0",
		artifactId: typeof record.artifactId === "string" && record.artifactId ? record.artifactId : createArtifactId(record),
		generatedAt,
		capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : generatedAt,
		revision: typeof record.revision === "number" ? record.revision : 1,
		hashVersion: "sha256-v2"
	};
	if (options.sourceHash) result.sourceHash = options.sourceHash;
	if (options.staleAfterDays !== void 0 && !record.staleAfter && validDate(generatedAt)) result.staleAfter = addDays(generatedAt, options.staleAfterDays);
	const serialized = JSON.parse(JSON.stringify(result));
	serialized.contentHash = integrityHash(serialized);
	return serialized;
}
function reviewArtifact(value, expectedType) {
	const issues = [];
	const warnings = [];
	if (!value || typeof value !== "object" || Array.isArray(value)) return {
		status: "blocked",
		issues: ["工件必须是 JSON object。"],
		warnings,
		nextActions: ["传入插件实际生成的 JSON 工件，而不是 Markdown 展示文本。"]
	};
	const record = value;
	const artifactType = typeof record.artifactType === "string" ? record.artifactType : void 0;
	const artifactId = typeof record.artifactId === "string" ? record.artifactId : void 0;
	const sourceHash = typeof record.sourceHash === "string" ? record.sourceHash : void 0;
	const artifactContentHash = typeof record.contentHash === "string" ? record.contentHash : void 0;
	const staleAfter = typeof record.staleAfter === "string" ? record.staleAfter : void 0;
	if (record.schemaVersion !== "1.0") issues.push("schemaVersion 必须为 1.0。");
	if (!artifactId?.trim()) issues.push("缺少稳定 artifactId。");
	if (!artifactType?.trim()) issues.push("缺少 artifactType。");
	if (expectedType && artifactType !== expectedType) issues.push(`artifactType 必须为 ${expectedType}。`);
	if (!validDate(record.generatedAt)) issues.push("generatedAt 必须是有效 ISO 日期或时间。");
	else if (Date.parse(record.generatedAt) > Date.now() + 3e5) issues.push("generatedAt 不能是未来时间。");
	if (record.staleAfter !== void 0 && !validDate(record.staleAfter)) issues.push("staleAfter 必须是有效 ISO 日期或时间。");
	if (validDate(staleAfter) && validDate(record.generatedAt) && Date.parse(staleAfter) < Date.parse(record.generatedAt)) issues.push("staleAfter 不能早于 generatedAt。");
	if (record.hashVersion === "sha256-v2") {
		if (!artifactContentHash || artifactContentHash !== integrityHash(record)) issues.push("contentHash 不匹配：内容已变化，请重新生成工件并重新交接。");
	} else if (record.hashVersion !== void 0) issues.push("不支持的 hashVersion。");
	else warnings.push("旧版或缺少内容校验版本；请由来源插件重新生成，不能自动视为已验证。");
	if (!staleAfter) warnings.push("缺少 staleAfter，无法自动判断证据是否过期。");
	const stale$1 = validDate(staleAfter) && Date.parse(staleAfter) <= Date.now();
	if (stale$1) warnings.push(`工件已过期：${staleAfter}。`);
	const status = issues.length > 0 ? "blocked" : stale$1 ? "stale" : warnings.length > 0 ? "partial" : "ready";
	return {
		status,
		issues,
		warnings,
		artifactId,
		artifactType,
		sourceHash,
		contentHash: artifactContentHash,
		staleAfter,
		nextActions: status === "ready" ? ["格式、内容一致性和有效期检查通过；仍需由接收插件审查业务证据与授权边界。"] : ["回到来源插件补齐或更新工件，再交接；不要直接修改 hash 或有效期。"]
	};
}
async function appendArtifactAudit(fs, root, event, signal) {
	const path = join(root, ".dsh-geo-audit.jsonl");
	const target = await fs.resolve(path, { signal });
	const info = await fs.stat(target, signal);
	const next = `${info?.type === "file" ? await fs.readText(target, signal) : ""}${JSON.stringify({
		...event,
		plugin: artifactDomain,
		recordedAt: (/* @__PURE__ */ new Date()).toISOString()
	})}\n`;
	await fs.writeText(target, next, info ? {
		kind: "replaceIfVersion",
		version: info.version
	} : { kind: "createIfAbsent" }, signal);
	return {
		path,
		entries: next.trim() ? next.trim().split(/\r?\n/).length : 0
	};
}

//#endregion
//#region src/handoff-routes.ts
const handoffRoutes = { "product-discoverability-handoff": {
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
} };

//#endregion
//#region src/handoff-receive.ts
const handoffParameters = {
	artifactJson: {
		type: "string",
		required: true,
		description: "Original JSON artifact or successful result envelope; preserve its checksum."
	},
	initiativeId: {
		type: "string",
		required: true,
		description: "Stable ID shared by all receipts for this business initiative."
	},
	owner: {
		type: "string",
		required: true,
		description: "Human responsible for the next action."
	},
	action: {
		type: "string",
		required: true,
		description: "Concrete next action, not a claim of completion."
	},
	dueDate: {
		type: "string",
		required: true,
		description: "ISO date or timestamp for the action deadline."
	}
};
function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text(value) {
	return typeof value === "string" ? value.trim() : "";
}
function meaningful(value) {
	return typeof value === "string" ? !!value.trim() : Object.keys(asRecord(value)).length > 0;
}
function receiveHandoff(value, options) {
	const envelope = asRecord(value);
	const isEnvelope = Object.hasOwn(envelope, "data");
	const source = asRecord(isEnvelope ? envelope.data : value);
	const review = reviewArtifact(source);
	const issues = [...review.issues];
	const warnings = [...review.warnings];
	const missing = [];
	const sourceType = text(source.artifactType);
	const route = Object.hasOwn(handoffRoutes, sourceType) ? handoffRoutes[sourceType] : void 0;
	if (isEnvelope && envelope.ok !== true) issues.push("来源工具未成功，不能消费其 data。");
	if (!route) issues.push(`本插件不接收 ${sourceType || "unknown"}，请按职责交接。`);
	if (route) {
		if (source.handoffFrom !== route.from) issues.push(`handoffFrom 必须为 ${route.from}。`);
		if (route.mode === "direct" && source.handoffTo !== artifactDomain) issues.push(`handoffTo 必须为 ${artifactDomain}，不能消费发给其他插件的交接。`);
		for (const field of route.text) if (!text(source[field])) missing.push(field);
		for (const field of route.lists) {
			const values = source[field];
			if (!Array.isArray(values) || values.length === 0 || !values.every(meaningful)) missing.push(field);
		}
	}
	for (const field of [
		"initiativeId",
		"owner",
		"action"
	]) if (!options[field].trim()) missing.push(field);
	if (!validDate(options.dueDate)) issues.push("dueDate 必须是有效 ISO 日期或时间。");
	else if (Date.parse(options.dueDate.length === 10 ? options.dueDate + "T23:59:59Z" : options.dueDate) < Date.now()) missing.push("dueDate 已逾期，请明确新的行动日期");
	if (source.initiativeId && source.initiativeId !== options.initiativeId.trim()) issues.push("initiativeId 与来源不一致。");
	if ([
		"blocked",
		"stale",
		"rejected"
	].includes(text(source.status)) || ["hold", "stop"].includes(text(source.decision))) issues.push("上游工件要求停止或重新审查，不能向下推进。");
	if ([
		"partial",
		"draft",
		"open",
		"implemented",
		"accepted"
	].includes(text(source.status))) missing.push("上游尚未完成验证");
	if (review.status === "stale") issues.push("来源已过期，必须回到生产插件重新核验。");
	if (sourceType === "opportunity-handoff" && Object.keys(asRecord(source.validationExperiment)).length === 0) missing.push("validationExperiment");
	if (sourceType === "product-sales-handoff" && !["proceed", "scale"].includes(text(source.productDecision))) missing.push("productDecision");
	if (sourceType === "product-feedback-closure" && source.status !== "verified") missing.push("反馈尚未 verified");
	if (sourceType === "sales-feedback-handoff") {
		if (!["dsh-growth"].includes(artifactDomain) && (!Array.isArray(source.feedback) || !source.feedback.length || !source.feedback.every((value$1) => {
			const row = asRecord(value$1);
			return typeof row.reason === "string" && !!row.reason.trim() && typeof row.count === "number" && Number.isInteger(row.count) && row.count > 0;
		}))) missing.push("feedback.reason/count");
		const summary$1 = asRecord(source.summary);
		if (![summary$1.won, summary$1.lost].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)) missing.push("summary.won/lost");
		else if (Number(summary$1.won) + Number(summary$1.lost) === 0) missing.push("没有可复盘的成交或失单记录");
	}
	const sourceWarnings = [source.warnings, envelope.warnings].flatMap((items) => Array.isArray(items) ? items.filter((item) => typeof item === "string" && !!item.trim()) : []);
	const status = issues.length > 0 ? "blocked" : missing.length > 0 || review.status !== "ready" ? "needs-validation" : "accepted";
	const contextKeys = [...new Set([
		...route?.text ?? [],
		...route?.lists ?? [],
		"validationExperiment",
		"riskiestAssumption",
		"summary",
		"feedback",
		"openQuestions",
		"commercialQuestions",
		"requiredApprovals",
		"risks",
		"claimBoundaries",
		"sourceArtifactId"
	])];
	const context = Object.fromEntries(contextKeys.filter((key) => source[key] !== void 0).map((key) => [key, source[key]]));
	const nextActions = status === "accepted" ? [
		`${options.owner.trim()}：在 ${options.dueDate} 前${options.action.trim()}。`,
		`下一工具：${route?.nextTool}。`,
		route?.purpose ?? ""
	] : [
		...issues,
		...missing.map((field) => `补齐或核验：${field}。`),
		"修正来源并重新接收；不要修改回执状态冒充完成。"
	];
	return {
		artifactType: "handoff-receipt",
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		initiativeId: options.initiativeId.trim(),
		receivedBy: artifactDomain,
		mode: route?.mode ?? "direct",
		status,
		sourceArtifactId: text(source.artifactId),
		sourceArtifactType: sourceType,
		sourceContentHash: text(source.contentHash),
		sourceProducer: text(source.handoffFrom),
		sourceStatus: text(source.status),
		owner: options.owner.trim(),
		action: options.action.trim(),
		dueDate: options.dueDate,
		nextTool: route?.nextTool ?? "",
		purpose: route?.purpose ?? "",
		context,
		issues,
		missing,
		warnings: [...new Set([...warnings, ...sourceWarnings])],
		approvalGranted: false,
		completionClaimed: false,
		nextActions
	};
}

//#endregion
//#region src/output.ts
const geoResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		schemaVersion: {
			type: "string",
			required: true
		},
		ok: {
			type: "boolean",
			required: true
		},
		data: {
			type: "json",
			required: true
		},
		warnings: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		assumptions: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		lineage: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: true
			},
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
function geoResultEnvelope(input) {
	return {
		schemaVersion: "1.0",
		ok: true,
		data: input.data,
		warnings: input.warnings ?? [],
		assumptions: input.assumptions ?? [],
		lineage: [...input.lineage ?? []],
		nextActions: input.nextActions ?? []
	};
}

//#endregion
//#region src/seo.ts
const SEO_STANDARD_VERSION = "google-search-essentials-2025-12";
const references = [
	"https://developers.google.com/search/docs/essentials?hl=zh-cn",
	"https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=zh-cn",
	"https://developers.google.com/search/docs/fundamentals/get-started?hl=zh-cn",
	"https://developers.google.com/search/docs/appearance/title-link?hl=zh-cn",
	"https://developers.google.com/search/docs/appearance/snippet?hl=zh-cn",
	"https://developers.google.com/search/docs/crawling-indexing?hl=zh-cn"
];
function textValue(value) {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}
function frontmatterValue(note, pattern) {
	for (const [key, value] of Object.entries(note.frontmatter)) if (pattern.test(key)) {
		const text$1 = textValue(value);
		if (text$1) return text$1;
	}
	return "";
}
function containsTopic(text$1, topic) {
	if (!text$1 || !topic) return false;
	const normalizedText$1 = text$1.toLocaleLowerCase();
	const normalizedTopic = topic.toLocaleLowerCase().trim();
	if (normalizedText$1.includes(normalizedTopic)) return true;
	const words = normalizedTopic.split(/\s+/).filter((word) => word.length > 2);
	return words.length > 0 && words.every((word) => normalizedText$1.includes(word));
}
function countOccurrences(text$1, term) {
	if (!term) return 0;
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return (text$1.match(new RegExp(escaped, "gi")) || []).length;
}
function check(id, area, status, evidence, recommendation) {
	return {
		id,
		area,
		status,
		evidence,
		recommendation
	};
}
function summary(checks) {
	return checks.reduce((result, item) => {
		result[item.status] += 1;
		return result;
	}, {
		pass: 0,
		warn: 0,
		unknown: 0
	});
}
function sourceLabel(context) {
	if (context.sourceType === "public-url") return "公开 URL 快照";
	if (context.sourceType === "private-snapshot") return "本地 HTML 私有快照";
	if (context.sourceType === "local-markdown") return "本地 Markdown 源文件";
	return "本地内容源";
}
function buildSeoStandardReport(note, context = {}) {
	const technical = note.technical;
	const label = sourceLabel(context);
	const description = technical?.metaDescription || frontmatterValue(note, /^(description|meta_description|seo_description)$/i);
	const canonical$1 = technical?.canonicalUrl || frontmatterValue(note, /^(canonical|canonical_url)$/i);
	const primary = note.primaryQuery || note.title;
	const title = technical?.htmlTitle || note.title;
	const checks = [];
	checks.push(check("content.people-first", "content", note.wordCount >= 120 && note.firstParagraph.length >= 40 && note.headings.length >= 2 ? "pass" : "warn", note.wordCount >= 120 ? `检测到约 ${note.wordCount} 个词、${note.headings.length} 个标题和首段直接回答。` : `当前约 ${note.wordCount} 个词、${note.headings.length} 个标题；内容价值不能只靠扩写补足。`, "围绕用户任务补充定义、步骤、边界、例子和来源；不要为了长度添加与用户无关的段落。"));
	checks.push(check("content.topic-language", "content", primary && containsTopic(`${title}\n${note.firstParagraph}\n${note.headings.join("\n")}`, primary) ? "pass" : "warn", primary ? `主题信号“${primary}”${containsTopic(`${title}\n${note.firstParagraph}\n${note.headings.join("\n")}`, primary) ? "出现在标题、首段或标题层级中。" : "没有稳定出现在标题、首段或标题层级中。"}` : "未检测到明确主题信号。", "使用用户可能采用的字词描述页面主题，并把主查询自然放入标题、H1、首段和相关章节；不要机械重复。"));
	const descriptionStatus = description ? "pass" : technical ? "warn" : "unknown";
	checks.push(check("search-presentation.description", "search-presentation", descriptionStatus, description ? `检测到描述字段，长度约 ${description.length} 个字符。` : `${label}没有可验证的 meta description/description 字段。`, "为页面准备独有、准确、简洁的描述；Google 可能根据页面正文而不是元描述生成摘要。"));
	const genericTitle = /^(home|homepage|首页|主页|profile|个人资料|untitled)$/i.test(title.trim());
	checks.push(check("search-presentation.title", "search-presentation", title && !genericTitle ? "pass" : "warn", title ? `检测到标题“${title}”。` : "未检测到页面标题。", "为每个页面提供独有、简洁、准确的标题；不要使用“首页”“个人资料”等无法说明内容的标题。"));
	const occurrenceCount = countOccurrences(note.content, note.primaryQuery || "");
	const density = note.primaryQuery && note.wordCount > 0 ? occurrenceCount / note.wordCount : 0;
	checks.push(check("content.no-keyword-stuffing", "content", !note.primaryQuery ? "unknown" : density > .08 ? "warn" : "pass", note.primaryQuery ? `主查询在源文本中约出现 ${occurrenceCount} 次，占估算词数 ${(density * 100).toFixed(1)}%。` : "没有主查询，无法进行重复度检查。", "让内容先服务用户；关键词只用于表达主题和覆盖问题，不要为了排名重复词语。"));
	const links = note.internalLinks.length + note.externalLinks.length;
	checks.push(check("crawl-index.links", "links", links > 0 ? "pass" : "warn", links > 0 ? `检测到 ${links} 个内部/外部链接信号。` : "未检测到 Markdown 链接或 WikiLink。", "提供指向相关页面的可抓取链接，并使用能说明目标内容的链接文字；部署后仍需检查渲染出的 HTML。"));
	const finalUrl = context.finalUrl || "";
	const httpsStatus = finalUrl ? finalUrl.startsWith("https://") ? "pass" : "warn" : "unknown";
	checks.push(check("crawl-index.https", "crawl-index", httpsStatus, finalUrl ? `最终 URL：${finalUrl}` : `${label}没有可验证的部署 URL。`, "上线页面优先使用 HTTPS；本地 Markdown 无法证明部署后的协议。"));
	const canonicalStatus = canonical$1 ? "pass" : technical ? "unknown" : "unknown";
	checks.push(check("crawl-index.canonical", "crawl-index", canonicalStatus, canonical$1 ? `检测到规范 URL：${canonical$1}` : `${label}未检测到可验证的规范 URL。`, "如果同一内容存在多个 URL，选择一个规范 URL，并确保 Sitemap、内部链接和 canonical 信号不要互相冲突。"));
	const robots = technical?.robots || "";
	const robotsStatus = technical ? /\bnoindex\b/i.test(robots) ? "warn" : "pass" : "unknown";
	checks.push(check("crawl-index.robots", "crawl-index", robotsStatus, technical ? robots ? `检测到 robots 指令：${robots}` : "未检测到限制索引的 robots meta 指令。" : "本地源文件无法验证部署后的 robots.txt 或 robots meta。", "不要用 robots.txt 代替 noindex；如果页面应出现在搜索结果中，确认没有意外的 noindex 或访问限制。"));
	const structuredStatus = technical ? technical.structuredDataTypes.length > 0 ? "pass" : "unknown" : "unknown";
	checks.push(check("search-presentation.structured-data", "search-presentation", structuredStatus, technical ? technical.structuredDataTypes.length > 0 ? `检测到结构化数据类型：${technical.structuredDataTypes.join(", ")}。` : "未检测到 JSON-LD 结构化数据；并非所有页面都需要结构化数据。" : "本地 Markdown 不包含可验证的部署结构化数据。", "仅在内容类型适用时补充符合 Google 要求的结构化数据，并在部署后用富媒体搜索结果测试验证；结构化数据不保证展示富媒体结果。"));
	const mediaStatus = technical ? technical.imageCount === 0 || technical.imagesMissingAlt === 0 ? "pass" : "warn" : "unknown";
	checks.push(check("media.image-alt", "media", mediaStatus, technical ? technical.imageCount === 0 ? "页面未检测到图片。" : `检测到 ${technical.imageCount} 张图片，其中 ${technical.imagesMissingAlt} 张缺少 alt。` : "本地 Markdown 无法证明最终 HTML 中的图片和 alt 属性。", "在相关文字附近放置清晰图片，并为有信息价值的图片提供准确 alt；装饰性图片按站点模板处理。"));
	const viewportStatus = technical ? technical.hasViewport ? "pass" : "warn" : "unknown";
	checks.push(check("media.mobile-viewport", "media", viewportStatus, technical ? technical.hasViewport ? "检测到移动端 viewport。" : "未检测到移动端 viewport。" : "本地源文件无法验证部署页面的移动端 viewport。", "部署后验证移动端呈现、核心网页指标和资源可访问性；这些指标不能从 Markdown 分数推断。"));
	checks.push(check("crawl-index.sitemap", "crawl-index", "unknown", "单页 URL 或 Markdown 源文件不能证明整个站点的 Sitemap 状态。", "在站点层面生成并提交包含首选规范 URL 的 Sitemap；大型站点再按目录或类型拆分并监控。"));
	checks.push(check("monitoring.search-console", "monitoring", "unknown", "插件没有 Search Console 账号数据、索引覆盖率、查询展现或点击数据。", "上线后用 Search Console 的网址检查、索引编制和效果报告验证抓取、收录、查询、点击与变化趋势。"));
	return {
		framework: "Google Search Essentials + Google SEO Starter Guide",
		ruleVersion: SEO_STANDARD_VERSION,
		checks,
		summary: summary(checks),
		limitations: [
			"Markdown 审计只能评估源内容与声明的 frontmatter，不能证明部署后的 HTML、robots.txt、Sitemap、渲染、性能或 Search Console 状态。",
			"公开 URL 只读取匿名可访问内容；登录态、JavaScript 渲染后的差异和站点级覆盖需要导出快照或外部站点工具补充。",
			"Google 官方文档明确指出，满足技术要求和最佳实践也不保证一定抓取、收录或展示；本报告是提效用的检查清单，不是排名承诺。"
		],
		references
	};
}

//#endregion
//#region src/audit.ts
const AUDIT_RULE_VERSION = "0.4.0";
const severityByImpact = [
	[18, "critical"],
	[14, "high"],
	[9, "medium"],
	[1, "low"]
];
function severityFor(impact) {
	return severityByImpact.find(([threshold]) => impact >= threshold)?.[1] || "info";
}
function clampScore(value) {
	return Math.max(0, Math.min(100, Math.round(value)));
}
function auditNote(note, context = {}) {
	const scores = {
		seo: 100,
		geo: 100,
		aeo: 100
	};
	const findings = [];
	const add = (pillar, id, impact, message, evidence, recommendation) => {
		scores[pillar] -= impact;
		findings.push({
			id,
			pillar,
			severity: severityFor(impact),
			message,
			evidence,
			recommendation,
			scoreImpact: impact
		});
	};
	if (!note.title || note.title.length < 6) add("seo", "seo.title", 18, "标题不够明确", `当前标题：${note.title || "未检测到标题"}`, "使用包含主题和用户意图的具体标题。");
	if (!note.primaryQuery) add("seo", "seo.primary-query", 12, "缺少主关键词或主题字段", "未检测到 dsh_geo_query、seo_keyword、keyword 或 topic。", "在 frontmatter 中补充 dsh_geo_query 或 topic。");
	if (note.headings.length === 0) add("seo", "seo.headings", 10, "缺少分层标题", "正文没有 Markdown 标题。", "按用户问题拆分为 2-5 个清晰小节。");
	if (note.headingLevels.some((level, index) => index > 0 && level - note.headingLevels[index - 1] > 1)) add("seo", "seo.heading-hierarchy", 6, "标题层级存在跳跃", "检测到从较低层级直接跳到更深层级的标题。", "保持 H1 → H2 → H3 的连续层级。");
	if (note.wordCount < 120) add("seo", "seo.thin-content", 10, "正文信息密度偏低", `正文约 ${note.wordCount} 个词。`, "补充定义、过程、例子、边界和来源，不追求无意义扩写。");
	if (note.internalLinks.length === 0) add("seo", "seo.internal-links", 8, "缺少知识库内部链接", "未检测到 [[WikiLink]]。", "至少连接一个上位主题和一个相关实践笔记。");
	if (note.sourceUrls.length === 0) add("seo", "seo.sources", 14, "缺少可核验来源", "未检测到来源 URL 或引用字段。", "为事实、数据和外部结论补充来源、日期和适用边界。");
	if (note.entities.length === 0) add("geo", "geo.entities", 18, "实体边界不清晰", "未检测到 brand、product、entity 或 topic 属性。", "明确本文讨论的品牌、产品、组织、平台或核心概念。");
	if (!note.hasDefinition) add("geo", "geo.definition", 16, "缺少可直接引用的定义句", "首段没有检测到“是指/定义/means”等定义表达。", "在开头用一句话回答“它是什么、解决什么问题”。");
	if (!note.hasFacts) add("geo", "geo.evidence", 12, "事实和证据表达不足", "未检测到明显数字、年份或来源归因。", "区分事实、观点和推断，并给关键事实补充来源。");
	if (note.sourceUrls.length === 0) add("geo", "geo.provenance", 18, "来源链路不完整", "没有可供 AI 复核的外部来源。", "记录原始出处、发布时间、核验状态和使用边界。");
	if (note.headings.length < 2) add("geo", "geo.chunkability", 8, "内容不利于分块检索", `当前仅有 ${note.headings.length} 个标题。`, "将长段落拆成独立、可引用、主题单一的内容块。");
	if (!note.primaryQuery && note.entities.length === 0) add("geo", "geo.intent", 6, "主题意图不明确", "没有主问题、主题或实体信号。", "补充用户要解决的问题和本文覆盖范围。");
	if (note.firstParagraph.length < 40) add("aeo", "aeo.direct-answer", 18, "首段缺少直接回答", `首段长度约 ${note.firstParagraph.length} 个字符。`, "开头先给出 1-3 句直接答案，再展开解释。");
	if (note.questionHeadings.length === 0) add("aeo", "aeo.question-headings", 12, "缺少问题式小标题", "未检测到以问题或疑问词开头的标题。", "把用户真实提问转化为 H2/H3 标题。");
	if (note.listCount + note.tableCount === 0) add("aeo", "aeo.answer-format", 8, "缺少结构化答案格式", "未检测到列表或表格。", "对步骤、比较项、条件和结论使用列表或表格。");
	if (!note.hasNextStep) add("aeo", "aeo.next-step", 6, "缺少下一步行动", "未检测到行动建议或下一步。", "结尾补充读者下一步可以执行的动作。");
	const score = {
		seo: clampScore(scores.seo),
		geo: clampScore(scores.geo),
		aeo: clampScore(scores.aeo)
	};
	const overall = clampScore((score.seo + score.geo + score.aeo) / 3);
	const topActions = [...findings].sort((a, b) => b.scoreImpact - a.scoreImpact).slice(0, 5).map((finding) => `${finding.pillar.toUpperCase()}：${finding.recommendation}`);
	return {
		target: note.path,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		ruleVersion: AUDIT_RULE_VERSION,
		confidence: note.truncated ? .65 : .9,
		unknownReasons: note.truncated ? ["内容超过 maxTextChars，部分判断可能基于截断内容。"] : [],
		truncated: note.truncated,
		scores: {
			...score,
			overall
		},
		stats: {
			wordCount: note.wordCount,
			headings: note.headings.length,
			internalLinks: note.internalLinks.length,
			externalLinks: note.externalLinks.length,
			sources: note.sourceUrls.length,
			entities: note.entities.length,
			questions: note.questionHeadings.length
		},
		seoStandard: buildSeoStandardReport(note, context),
		findings,
		topActions
	};
}
function createContentBrief(note, audit) {
	const query = note.primaryQuery || note.title;
	const intent = note.frontmatter.dsh_geo_intent || note.frontmatter.geo_intent || "信息理解与决策支持";
	const audience = note.frontmatter.audience || note.frontmatter.scope || "需要快速理解并执行该主题的读者";
	const questions = note.questionHeadings.length > 0 ? note.questionHeadings : [
		`什么是${query}？`,
		`${query}适合什么场景？`,
		`如何判断${query}是否有效？`,
		`${query}有哪些常见误区？`
	];
	return {
		source: note.path,
		topic: query,
		intent: String(intent),
		audience: String(audience),
		scores: audit.scores,
		recommendedTitle: `${query}：定义、方法、场景与常见问题`,
		directAnswer: note.firstParagraph || `本文解释${query}的核心定义、适用场景和执行方法。`,
		outline: [
			`一、${query}是什么`,
			`二、${query}解决什么问题`,
			`三、执行步骤与判断标准`,
			`四、常见问题与边界`,
			"五、来源与下一步行动"
		],
		questions,
		entities: note.entities,
		sourceGaps: note.sourceUrls.length === 0 ? ["补充原始来源、日期、核验状态和适用边界"] : [],
		nextActions: audit.topActions
	};
}

//#endregion
//#region src/backlinks.ts
const BACKLINK_RESOURCE_SOURCE = "https://github.com/flaqai/backlink_skills/blob/main/Free-backlink-list.md";
const BUILTIN_BACKLINK_RESOURCES = [
	{
		id: "producthunt",
		name: "Product Hunt",
		url: "https://www.producthunt.com/",
		route: "product-directory",
		audience: "technology adopters and startup builders",
		relevance: "Good for a real product launch or product page with a clear user benefit.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list records this as a product discovery platform; current submission rules must be checked before use.",
		requiresAccount: true
	},
	{
		id: "devto",
		name: "DEV Community",
		url: "https://dev.to/",
		route: "developer-community",
		audience: "software developers and technical practitioners",
		relevance: "Use only for an original technical tutorial or engineering experience, not a thin promotional post.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list suggests an article route; article publishing is a separate user-led content workflow.",
		requiresAccount: true
	},
	{
		id: "qiita",
		name: "Qiita",
		url: "https://qiita.com/",
		route: "developer-community",
		audience: "Japanese software developers",
		relevance: "Use for genuinely useful Japanese engineering content with local reader value.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list suggests an article route; confirm language and community rules first.",
		requiresAccount: true
	},
	{
		id: "osalt",
		name: "osalt.com",
		url: "https://osalt.com/suggest",
		route: "software-directory",
		audience: "people looking for open-source software alternatives",
		relevance: "Relevant only when the product has a truthful open-source alternative or comparison use case.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list identifies this as an open-source alternative directory; verify the current suggestion form."
	},
	{
		id: "awesomeindie",
		name: "Awesome Indie",
		url: "https://awesomeindie.com/",
		route: "startup-directory",
		audience: "indie makers and people discovering newly launched products",
		relevance: "Suitable for a real indie product with a concise, accurate product profile.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list records a product discovery route; availability and submission policy are not guaranteed."
	},
	{
		id: "microlaunch",
		name: "MicroLaunch",
		url: "https://microlaunch.net/",
		route: "startup-directory",
		audience: "indie makers and early product adopters",
		relevance: "Suitable for a genuine product launch with a clear audience and useful landing page.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list records a product launch community; recheck the current route and terms.",
		requiresAccount: true
	},
	{
		id: "startupbase",
		name: "StartupBase",
		url: "https://startupbase.io/",
		route: "startup-directory",
		audience: "startup founders and product discovery readers",
		relevance: "Use when the product profile contributes real information to the startup community.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list notes that community participation may be expected; never fabricate engagement.",
		requiresAccount: true
	},
	{
		id: "startupranking",
		name: "Startup Ranking",
		url: "https://www.startupranking.com/",
		route: "startup-directory",
		audience: "people researching startups and company profiles",
		relevance: "Use for an accurate company or product profile; do not treat ranking placement as an SEO KPI.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list identifies a company profile route; verify current profile and submission rules.",
		requiresAccount: true
	},
	{
		id: "launchingnext",
		name: "Launching Next",
		url: "https://www.launchingnext.com/submit/",
		route: "startup-directory",
		audience: "startup and new product discovery readers",
		relevance: "Suitable for a real new product with a differentiated, factual description.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list includes this submission route; current availability needs a fresh check."
	},
	{
		id: "nocodefamily",
		name: "NoCode Family",
		url: "https://nocodefamily.com/submit-tool",
		route: "software-directory",
		audience: "no-code builders and tool buyers",
		relevance: "Relevant only when the product genuinely serves no-code workflows or their users.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list identifies a tool submission route; confirm that the form is currently open."
	},
	{
		id: "saashub",
		name: "SaaSHub",
		url: "https://saashub.com/",
		route: "software-directory",
		audience: "SaaS buyers comparing software and alternatives",
		relevance: "Use for an accurate software profile and alternative/comparison context, not link volume.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list includes this SaaS discovery platform and notes that submission behavior may vary.",
		requiresAccount: true
	},
	{
		id: "pitchwall",
		name: "PitchWall",
		url: "https://pitchwall.co/",
		route: "startup-directory",
		audience: "people discovering AI products and startups",
		relevance: "Suitable for a real product profile with a clear use case and working website.",
		source: BACKLINK_RESOURCE_SOURCE,
		historicalNote: "The upstream list contains duplicate historical entries; this catalog keeps one normalized route."
	}
];
const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref)$/i;
function normalizePublicUrl(value) {
	const url = new URL(value.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are supported.");
	for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
	url.hash = "";
	url.hostname = url.hostname.toLowerCase();
	if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString();
}
function backlinkIdempotencyKey(resourceUrl, productUrl) {
	return createHash("sha256").update(`${normalizePublicUrl(resourceUrl)}\n${normalizePublicUrl(productUrl)}`).digest("hex").slice(0, 20);
}
function resourceForUrl(value) {
	const normalized$1 = normalizePublicUrl(value);
	const known = BUILTIN_BACKLINK_RESOURCES.find((resource) => normalizePublicUrl(resource.url) === normalized$1);
	if (known) return known;
	const parsed = new URL(normalized$1);
	return {
		id: `custom-${parsed.hostname.replace(/[^a-z0-9]+/gi, "-")}`,
		name: parsed.hostname,
		url: normalized$1,
		route: "other",
		audience: "unknown",
		relevance: "User-supplied candidate; confirm audience and discovery value before use.",
		source: "user-supplied"
	};
}
function extractHtmlTitle(content) {
	return (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(content)?.[1])?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || void 0;
}
function buildBacklinkPlan(input) {
	const productUrl = normalizePublicUrl(input.productUrl);
	const mode = input.mode || "quality";
	const sourceUrls = input.resourceUrls?.length ? input.resourceUrls : BUILTIN_BACKLINK_RESOURCES.map((resource) => resource.url);
	const uniqueUrls = [...new Set(sourceUrls.map(normalizePublicUrl))];
	const filtered = uniqueUrls.map(resourceForUrl).filter((resource) => !input.route || resource.route === input.route);
	const limit = Math.max(1, Math.min(input.maxCandidates || (mode === "quality" ? 10 : 50), mode === "quality" ? 10 : 100));
	const selected = filtered.slice(0, limit);
	const preflights = new Map((input.preflights || []).map((item) => [normalizePublicUrl(item.url), item]));
	const candidates = selected.map((resource) => {
		const normalizedUrl = normalizePublicUrl(resource.url);
		const preflight = preflights.get(normalizedUrl);
		const exclusionReasons = ["候选来自外部资源清单，必须重新核验当前入口、受众、条款和收费状态。", ...resource.historicalNote ? [resource.historicalNote] : []];
		if (resource.route === "other") exclusionReasons.push("未识别为产品/软件/创业目录，需先确认是否属于允许的发布路线。");
		if (preflight?.statusCode !== void 0 && (preflight.statusCode < 200 || preflight.statusCode >= 400)) exclusionReasons.push(`预检返回 HTTP ${preflight.statusCode}，暂不提交。`);
		const unavailable = preflight?.statusCode !== void 0 && (preflight.statusCode < 200 || preflight.statusCode >= 400);
		return {
			id: resource.id,
			resource,
			normalizedUrl,
			idempotencyKey: backlinkIdempotencyKey(normalizedUrl, productUrl),
			status: unavailable ? "unavailable" : "not-attempted",
			qualityGate: unavailable ? "failed" : "not-checked",
			preflight: {
				checked: Boolean(preflight),
				...preflight?.statusCode === void 0 ? {} : { statusCode: preflight.statusCode },
				...preflight?.finalUrl ? { finalUrl: preflight.finalUrl } : {},
				...preflight?.title ? { title: preflight.title } : {},
				note: preflight?.note || "未联网预检；请在浏览器中打开并进行只读检查。"
			},
			exclusionReasons,
			nextAction: unavailable ? "不要重试提交；更换候选或先确认入口恢复。" : resource.route === "developer-community" ? "先确认内容对社区有独立价值，再准备平台专用文章；不要复制官网宣传文案。" : "先只读核验受众、规则、收费、互链要求和登录/验证码，再决定是否手动提交。"
		};
	});
	const excluded = filtered.slice(selected.length).map((resource) => ({
		url: resource.url,
		reason: `超过本次 ${mode === "quality" ? "质量模式最多 10 个" : "批量模式上限"} 候选；下一轮再处理。`
	}));
	const manualQueue = candidates.filter((candidate) => candidate.status === "not-attempted").map((candidate) => candidate.id);
	const source = {
		kind: input.resourceUrls?.length ? "user-supplied" : "built-in-catalog",
		reference: input.resourceUrls?.length ? "用户提供的候选 URL" : BACKLINK_RESOURCE_SOURCE,
		candidateCount: uniqueUrls.length
	};
	const shortDescription = input.description.trim().slice(0, 240);
	const longDescription = input.description.trim();
	return {
		version: "0.4.0",
		mode,
		status: candidates.some((candidate) => candidate.status === "unavailable") ? "partial" : "ready",
		product: {
			name: input.productName.trim(),
			url: productUrl,
			canonicalUrl: productUrl
		},
		source,
		candidates,
		manualQueue,
		excluded,
		submissionPack: {
			shortDescription,
			longDescription,
			suggestedAnchor: input.productName.trim(),
			factsToVerify: [
				"产品名称和官网 URL",
				"产品用途和目标用户",
				"定价、发布状态和公司信息（如填写）",
				"平台要求的分类、Logo 和截图"
			],
			prohibitedClaims: [
				"保证排名、流量、收录或 dofollow",
				"虚构用户数、客户、价格、奖项或测评",
				"使用重复的精确商业关键词作为锚文本",
				"要求平台修改链接属性或绕过验证码/验证"
			]
		},
		guardrails: [
			"外链以产品发现、推荐访问和准确资料为目的，不以操纵排名或堆积链接为目的。",
			"质量模式每轮最多 10 个候选；先研究和预检，再逐个手动处理。",
			"插件不接收账号密码、Cookie、OTP、验证码或私有会话，也不绕过平台安全机制。",
			"用户完成平台操作后，用 geo_backlink_record 记录真实状态和公开证据；结果不明确时不要重试。"
		],
		nextActions: [
			"先执行候选的只读预检，排除停服、无关、强制互链、只卖链接和明显低质量渠道。",
			"只对质量门槛通过的候选准备平台专用资料，使用品牌名或裸 URL，不批量复制同一篇文章。",
			"用户在平台完成提交、邮箱验证或人工审核后，记录 published、awaiting-email-verification、awaiting-approval 或 outcome-unknown。",
			"把推荐访问、转化、条目存活和资料准确性纳入下一轮手动效果评估，不把提交数量当成成功。"
		]
	};
}
function redactEvidence(value) {
	return value.replace(/(password|passwd|token|secret|cookie|otp|authorization|bearer|session|recovery[-_ ]?code)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]").replace(/(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g, "[phone redacted]");
}
function normalizeBacklinkRecord(input) {
	const productUrl = normalizePublicUrl(input.productUrl);
	const resourceUrl = normalizePublicUrl(input.resourceUrl);
	return {
		idempotencyKey: backlinkIdempotencyKey(resourceUrl, productUrl),
		productUrl,
		resourceUrl,
		status: input.status,
		recordedAt: input.recordedAt || (/* @__PURE__ */ new Date()).toISOString(),
		...input.publicUrl ? { publicUrl: normalizePublicUrl(input.publicUrl) } : {},
		...input.anchorText?.trim() ? { anchorText: input.anchorText.trim() } : {},
		...input.linkRel?.trim() ? { linkRel: input.linkRel.trim() } : {},
		evidence: (input.evidence || []).map(redactEvidence).filter(Boolean),
		...input.note?.trim() ? { note: redactEvidence(input.note.trim()) } : {}
	};
}
function recordBacklinkEntry(existing, entry) {
	const terminal = new Set([
		"submitted",
		"published",
		"outcome-unknown"
	]);
	const duplicate = existing.find((item) => item.idempotencyKey === entry.idempotencyKey);
	if (duplicate && terminal.has(duplicate.status) && entry.status === "not-attempted") return {
		entries: existing,
		result: {
			version: "0.4.0",
			path: "",
			status: duplicate.status,
			idempotencyKey: entry.idempotencyKey,
			recordedAt: entry.recordedAt,
			changed: false,
			evidence: duplicate.evidence,
			nextAction: "该候选已有终态记录；先核对公开页面、邮箱或平台后台，不要重复提交。"
		}
	};
	return {
		entries: duplicate ? existing.map((item) => item.idempotencyKey === entry.idempotencyKey ? entry : item) : [...existing, entry],
		result: {
			version: "0.4.0",
			path: "",
			status: entry.status,
			idempotencyKey: entry.idempotencyKey,
			recordedAt: entry.recordedAt,
			changed: true,
			evidence: entry.evidence,
			nextAction: entry.status === "published" ? "记录公开页面 URL、实际 href/rel，并在下一轮手动评估推荐访问和转化。" : entry.status === "outcome-unknown" ? "先核对平台后台、邮箱和公开页面，确认前不要再次提交。" : entry.status === "awaiting-email-verification" ? "完成平台原生邮箱验证后，再用 geo_backlink_record 更新状态。" : entry.status === "awaiting-approval" ? "等待平台审核；不要把提交动作当成已发布。" : "继续按候选的 nextAction 手动处理，并为每个结果留存可核验的公开证据。"
		}
	};
}
function parseBacklinkRecordFile(content) {
	if (!content.trim()) return [];
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed)) throw new Error("Backlink record must be a JSON array.");
	return parsed;
}
function summarizeBacklinkRecords(entries) {
	const statuses = [
		"not-attempted",
		"manual-required",
		"submitted",
		"awaiting-email-verification",
		"awaiting-approval",
		"published",
		"outcome-unknown",
		"failed",
		"ineligible",
		"unavailable"
	];
	const byStatus = Object.fromEntries(statuses.map((status) => [status, 0]));
	const errors = [];
	const keys = /* @__PURE__ */ new Set();
	for (const entry of entries) {
		if (!statuses.includes(entry.status)) errors.push(`Unknown status: ${entry.status}`);
		byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
		if (keys.has(entry.idempotencyKey)) errors.push(`Duplicate idempotency key: ${entry.idempotencyKey}`);
		keys.add(entry.idempotencyKey);
	}
	return {
		total: entries.length,
		byStatus,
		published: entries.filter((entry) => entry.status === "published"),
		needsFollowUp: entries.filter((entry) => [
			"submitted",
			"awaiting-email-verification",
			"awaiting-approval",
			"outcome-unknown"
		].includes(entry.status)),
		errors
	};
}
function extractPreflight(value, note, requestedUrl = value.url) {
	return {
		url: requestedUrl,
		statusCode: value.statusCode,
		finalUrl: value.url,
		title: value.body.kind === "html" ? extractHtmlTitle(value.body.content) : void 0,
		note
	};
}

//#endregion
//#region src/context.ts
const DEFAULT_PROJECT_CONTEXT_PATH = "seo/project-context.json";
const REQUIRED_CONTEXT_FIELDS = [
	"businessGoal",
	"audience",
	"language",
	"market",
	"brandName",
	"canonicalDomain"
];
function createProjectContext(input) {
	return {
		version: "0.4.0",
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		businessGoal: input.businessGoal?.trim() || "",
		audience: input.audience?.trim() || "",
		language: input.language?.trim() || "",
		market: input.market?.trim() || "",
		brandName: input.brandName?.trim() || "",
		canonicalDomain: input.canonicalDomain?.trim() || "",
		brandTerms: [...new Set((input.brandTerms || []).map((value) => value.trim()).filter(Boolean))],
		competitors: [...new Set((input.competitors || []).map((value) => value.trim()).filter(Boolean))],
		keyPages: [...new Set((input.keyPages || []).map((value) => value.trim()).filter(Boolean))],
		conversionGoals: [...new Set((input.conversionGoals || []).map((value) => value.trim()).filter(Boolean))],
		constraints: [...new Set((input.constraints || []).map((value) => value.trim()).filter(Boolean))],
		sourceNotes: [...new Set((input.sourceNotes || []).map((value) => value.trim()).filter(Boolean))]
	};
}
function projectContextResult(path, context) {
	if (!context) return {
		path,
		status: "missing",
		missingFields: REQUIRED_CONTEXT_FIELDS.map((field) => String(field)),
		nextActions: ["运行 geo_project_context 并填写业务目标、受众、语言/地区、品牌和 canonical domain。"]
	};
	const missingFields = REQUIRED_CONTEXT_FIELDS.filter((field) => !String(context[field] || "").trim()).map((field) => String(field));
	return {
		path,
		status: missingFields.length === 0 ? "ready" : "partial",
		context,
		missingFields,
		nextActions: missingFields.length > 0 ? [`补充字段：${missingFields.join("、")}，再运行 geo_coach 或 geo_workflow。`] : ["将 project context 作为所有 SEO/GEO/AEO 任务的默认背景，不必每次重复描述业务。"]
	};
}
function parseProjectContext(content) {
	const parsed = JSON.parse(content);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Project context must be a JSON object.");
	return createProjectContext(parsed);
}

//#endregion
//#region src/effect.ts
const METRICS = [
	{
		key: "impressions",
		label: "展现",
		higherIsBetter: true
	},
	{
		key: "clicks",
		label: "点击",
		higherIsBetter: true
	},
	{
		key: "ctrPercent",
		label: "CTR（百分比）",
		higherIsBetter: true
	},
	{
		key: "averagePosition",
		label: "平均排名位置",
		higherIsBetter: false
	},
	{
		key: "conversions",
		label: "转化",
		higherIsBetter: true
	},
	{
		key: "indexedPages",
		label: "已收录页面",
		higherIsBetter: true
	},
	{
		key: "referralVisits",
		label: "推荐访问",
		higherIsBetter: true
	},
	{
		key: "referralConversions",
		label: "推荐转化",
		higherIsBetter: true
	}
];
function metricValue(snapshot, key) {
	const value = snapshot[key];
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function changePercent(baseline, delta) {
	if (baseline === 0) return void 0;
	return Number((delta / Math.abs(baseline) * 100).toFixed(2));
}
function buildEffectReview(input) {
	let improved = 0;
	let declined = 0;
	let comparable = 0;
	const changes = [];
	for (const metric of METRICS) {
		const before = metricValue(input.baseline, metric.key);
		const after = metricValue(input.current, metric.key);
		if (before === void 0 || after === void 0) {
			changes.push({
				metric: metric.label,
				...before === void 0 ? {} : { baseline: before },
				...after === void 0 ? {} : { current: after },
				direction: "unknown",
				interpretation: "缺少可比较的前后周期数据，不能判断变化。"
			});
			continue;
		}
		comparable += 1;
		const delta = Number((after - before).toFixed(4));
		const relativeChangePercent = changePercent(before, delta);
		const direction = delta === 0 ? "unchanged" : delta > 0 ? "up" : "down";
		if (delta !== 0) if (metric.higherIsBetter && delta > 0 || !metric.higherIsBetter && delta < 0) improved += 1;
		else declined += 1;
		const interpretation = delta === 0 ? "前后周期没有变化。" : metric.key === "averagePosition" ? delta < 0 ? "数值下降代表平均排名位置改善。" : "数值上升代表平均排名位置变差。" : metric.higherIsBetter ? delta > 0 ? "数值上升，属于正向变化。" : "数值下降，属于负向变化。" : delta > 0 ? "数值上升，属于负向变化。" : "数值下降，属于正向变化。";
		changes.push({
			metric: metric.label,
			baseline: before,
			current: after,
			delta,
			...relativeChangePercent === void 0 ? {} : { relativeChangePercent },
			direction,
			interpretation
		});
	}
	const status = comparable === 0 ? "inconclusive" : improved > 0 && declined > 0 ? "mixed" : improved > 0 ? "improving" : declined > 0 ? "declining" : "inconclusive";
	const dataQuality = comparable >= 3 ? "comparable" : comparable > 0 ? "partial" : "insufficient";
	const opportunities = [];
	const anomalies = [];
	const rows = input.rows || [];
	for (const row of rows) {
		if (row.impressions !== void 0 && row.clicks !== void 0 && row.clicks > row.impressions) anomalies.push(`${row.query || row.page || "未命名行"}：clicks 大于 impressions，检查导入口径。`);
		if (row.ctrPercent !== void 0 && (row.ctrPercent < 0 || row.ctrPercent > 100)) anomalies.push(`${row.query || row.page || "未命名行"}：CTR 超出 0～100%，检查单位是否传成小数。`);
		if (row.averagePosition !== void 0 && row.averagePosition > 8 && row.averagePosition <= 20 && (row.impressions || 0) > 0) opportunities.push({
			type: "striking-distance",
			...row.query ? { query: row.query } : {},
			...row.page ? { page: row.page } : {},
			evidence: `平均排名位置 ${row.averagePosition}，展现 ${row.impressions || 0}；属于可优先推动的第二页/临界机会。`,
			nextAction: "回到 geo_workflow，检查该查询对应页面的意图覆盖、直接答案、内部链接和来源证据。"
		});
		if (row.impressions !== void 0 && row.impressions >= 100 && row.ctrPercent !== void 0 && row.ctrPercent < 2) opportunities.push({
			type: "low-ctr",
			...row.query ? { query: row.query } : {},
			...row.page ? { page: row.page } : {},
			evidence: `展现 ${row.impressions}，CTR ${row.ctrPercent}%；这是启发式提示，不是行业基准结论。`,
			nextAction: "重新检查标题、摘要、页面承诺和搜索意图，确认 SERP 文案与正文一致。"
		});
		if (row.indexed === false) opportunities.push({
			type: "indexing",
			...row.query ? { query: row.query } : {},
			...row.page ? { page: row.page } : {},
			evidence: row.indexNote || "导入数据标记为未收录。",
			nextAction: "检查 URL 检查、canonical、robots、Sitemap、内部链接和页面质量。"
		});
	}
	const queryPages = /* @__PURE__ */ new Map();
	for (const row of rows) {
		if (!row.query || !row.page) continue;
		const pages = queryPages.get(row.query.toLocaleLowerCase()) || /* @__PURE__ */ new Set();
		pages.add(row.page);
		queryPages.set(row.query.toLocaleLowerCase(), pages);
	}
	for (const [query, pages] of queryPages) if (pages.size > 1) opportunities.push({
		type: "cannibalization",
		query,
		evidence: `同一查询对应 ${pages.size} 个页面：${[...pages].join("、")}。`,
		nextAction: "选择一个主页面，其他页面改为支持性内容或重新分配搜索意图。"
	});
	const nextActions = [];
	if (dataQuality === "insufficient") nextActions.push("补充同一页面、同一地区/设备口径和相邻周期的 Search Console 或站点分析数据。");
	if (status === "declining" || status === "mixed") {
		if (changes.some((change) => change.metric === "展现" && change.interpretation.includes("负向"))) nextActions.push("重新运行 geo_workflow，检查主题覆盖、收录边界、标题和搜索意图是否匹配。");
		if (changes.some((change) => (change.metric === "点击" || change.metric === "CTR（百分比）") && change.interpretation.includes("负向"))) nextActions.push("重新检查标题、摘要、直接答案和页面承诺，避免搜索结果承诺与正文不一致。");
		if (changes.some((change) => change.metric === "平均排名位置" && change.interpretation.includes("变差"))) nextActions.push("重新审计内部链接、来源、内容深度和页面之间的主题关系。");
		if (changes.some((change) => (change.metric === "推荐访问" || change.metric === "推荐转化") && change.interpretation.includes("负向"))) nextActions.push("审计 geo_backlink_record 中的渠道相关性、公开条目准确性和真实推荐访问，不以提交数量替代效果。");
	}
	if (status === "improving") nextActions.push("保留本次变更和数据口径，继续观察一个相邻周期，再决定是否扩大内容或分发范围。");
	if (opportunities.some((opportunity) => opportunity.type === "striking-distance")) nextActions.push("优先处理第二页机会词，再扩大新的主题范围。");
	if (opportunities.some((opportunity) => opportunity.type === "indexing")) nextActions.push("先处理未收录页面的技术和质量问题，不要用内容改写掩盖抓取/索引问题。");
	if (anomalies.length > 0) nextActions.push("先修正导入数据口径，再使用效果结论指导下一轮诊断。");
	if (nextActions.length === 0) nextActions.push("记录本次结果，下一周期继续使用相同口径复查；出现新问题时回到 geo_workflow 或 geo_audit_note。");
	return {
		version: "0.4.0",
		target: input.target,
		status,
		baseline: input.baseline,
		current: input.current,
		changes,
		opportunities,
		anomalies,
		dataQuality,
		nextActions,
		limitations: [
			"这是基于用户提供数据的定性复盘，不证明变化由某一次内容或外链动作单独造成。",
			"CTR 使用百分比数值，例如 2.4 表示 2.4%，不要混用 0.024。",
			"插件不会连接 Search Console、站点分析或外链平台，也不会编造缺失指标。"
		]
	};
}

//#endregion
//#region src/keywords.ts
function asNumber$1(value) {
	if (value === void 0 || value === null || value === "") return void 0;
	const parsed = typeof value === "number" ? value : Number(String(value).replace(/[%$,]/g, "").trim());
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
function asIntent(value) {
	const normalized$1 = String(value || "").trim().toLowerCase();
	return [
		"informational",
		"commercial",
		"navigational",
		"transactional"
	].includes(normalized$1) ? normalized$1 : "unknown";
}
function asStatus(value) {
	const normalized$1 = String(value || "").trim().toLowerCase();
	return [
		"candidate",
		"planned",
		"writing",
		"published",
		"tracking",
		"discarded"
	].includes(normalized$1) ? normalized$1 : "candidate";
}
function rowValue(row, ...names) {
	for (const name$1 of names) {
		const value = row[name$1] ?? row[name$1.toLowerCase()] ?? row[name$1.replace(/_/g, " ")];
		if (value !== void 0) return value;
	}
}
function normalizeRow(row, source, index) {
	const term = String(rowValue(row, "term", "keyword", "query", "关键词") || "").trim();
	if (!term) throw new Error(`Row ${index + 1} is missing term/keyword.`);
	return {
		term,
		intent: asIntent(rowValue(row, "intent", "search_intent", "意图")),
		...asNumber$1(rowValue(row, "volume", "search_volume", "搜索量")) === void 0 ? {} : { volume: asNumber$1(rowValue(row, "volume", "search_volume", "搜索量")) },
		...asNumber$1(rowValue(row, "difficulty", "kd", "keyword_difficulty", "难度")) === void 0 ? {} : { difficulty: asNumber$1(rowValue(row, "difficulty", "kd", "keyword_difficulty", "难度")) },
		...asNumber$1(rowValue(row, "cpc", "每次点击成本")) === void 0 ? {} : { cpc: asNumber$1(rowValue(row, "cpc", "每次点击成本")) },
		...String(rowValue(row, "country", "国家", "地区") || "").trim() ? { country: String(rowValue(row, "country", "国家", "地区")).trim() } : {},
		...String(rowValue(row, "device", "设备") || "").trim() ? { device: String(rowValue(row, "device", "设备")).trim().toLowerCase() } : {},
		source: String(rowValue(row, "source", "来源") || source).trim(),
		capturedAt: String(rowValue(row, "capturedAt", "captured_at", "采集时间") || (/* @__PURE__ */ new Date()).toISOString()).trim(),
		...String(rowValue(row, "targetPage", "target_page", "page", "目标页面") || "").trim() ? { targetPage: String(rowValue(row, "targetPage", "target_page", "page", "目标页面")).trim() } : {},
		...String(rowValue(row, "cluster", "topic", "主题") || "").trim() ? { cluster: String(rowValue(row, "cluster", "topic", "主题")).trim() } : {},
		status: asStatus(rowValue(row, "status", "状态")),
		...String(rowValue(row, "notes", "note", "备注") || "").trim() ? { notes: String(rowValue(row, "notes", "note", "备注")).trim() } : {}
	};
}
function splitCsvLine(line) {
	const values = [];
	let current = "";
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === "\"") if (quoted && line[index + 1] === "\"") {
			current += "\"";
			index += 1;
		} else quoted = !quoted;
		else if (char === "," && !quoted) {
			values.push(current.trim());
			current = "";
		} else current += char;
	}
	values.push(current.trim());
	return values;
}
function parseCsv(content) {
	const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (lines.length < 2) return [];
	const headers = splitCsvLine(lines[0]).map((header) => header.replace(/^"|"$/g, "").trim());
	return lines.slice(1).map((line) => {
		const values = splitCsvLine(line);
		return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
	});
}
function parseMarkdownTable(content) {
	const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("|"));
	if (lines.length < 3) return [];
	const headers = lines[0].split("|").slice(1, -1).map((value) => value.trim());
	return lines.slice(2).map((line) => {
		const values = line.split("|").slice(1, -1).map((value) => value.trim());
		return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
	});
}
function parseKeywordData(content, source) {
	const trimmed = content.trim();
	if (!trimmed) return {
		items: [],
		errors: ["Keyword import is empty."]
	};
	let rows = [];
	try {
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			const parsed = JSON.parse(trimmed);
			rows = (Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.keywords) ? parsed.keywords : []).filter((value) => Boolean(value && typeof value === "object" && !Array.isArray(value)));
		} else if (trimmed.includes("|") && /\|\s*[-:]+/.test(trimmed)) rows = parseMarkdownTable(trimmed);
		else rows = parseCsv(trimmed);
	} catch (error) {
		return {
			items: [],
			errors: [error instanceof Error ? error.message : String(error)]
		};
	}
	const items = [];
	const errors = [];
	rows.forEach((row, index) => {
		try {
			items.push(normalizeRow(row, source, index));
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	});
	return {
		items,
		errors
	};
}
function mergeKeywordOpportunities(existing, incoming) {
	const map = new Map(existing.map((item) => [`${item.term.toLocaleLowerCase()}|${item.country || ""}|${item.device || ""}|${item.targetPage || ""}`, item]));
	let updated = 0;
	let added = 0;
	for (const item of incoming) {
		const key = `${item.term.toLocaleLowerCase()}|${item.country || ""}|${item.device || ""}|${item.targetPage || ""}`;
		if (map.has(key)) updated += 1;
		else added += 1;
		map.set(key, item);
	}
	return {
		items: [...map.values()],
		updated,
		added
	};
}
function derivedCluster(term) {
	return term.toLocaleLowerCase().split(/[\s\-_/]+/).filter((token) => token.length > 1 && ![
		"how",
		"what",
		"the",
		"and",
		"for",
		"的",
		"是",
		"怎么",
		"如何"
	].includes(token)).slice(0, 2).join(" ") || term.slice(0, 12);
}
function priorityFor(items) {
	const scored = items.filter((item) => item.volume !== void 0 && item.difficulty !== void 0);
	if (scored.some((item) => (item.volume || 0) >= 100 && (item.difficulty || 100) <= 40)) return "high";
	if (scored.length > 0 || items.some((item) => ["planned", "writing"].includes(item.status))) return "medium";
	return "low";
}
function buildKeywordOpportunityMap(path, items) {
	const clusters = /* @__PURE__ */ new Map();
	for (const item of items) {
		const cluster = item.cluster?.trim() || derivedCluster(item.term);
		const list = clusters.get(cluster) || [];
		list.push(item);
		clusters.set(cluster, list);
	}
	const mapped = [...clusters.entries()].map(([name$1, values]) => ({
		name: name$1,
		terms: values.map((item) => item.term),
		targetPages: [...new Set(values.map((item) => item.targetPage).filter((value) => Boolean(value)))],
		priority: priorityFor(values)
	}));
	const byTerm = /* @__PURE__ */ new Map();
	for (const item of items) {
		if (!item.targetPage) continue;
		const pages = byTerm.get(item.term.toLocaleLowerCase()) || /* @__PURE__ */ new Set();
		pages.add(item.targetPage);
		byTerm.set(item.term.toLocaleLowerCase(), pages);
	}
	const cannibalization = [...byTerm.entries()].filter(([, pages]) => pages.size > 1).map(([term, pages]) => ({
		term,
		targetPages: [...pages],
		nextAction: "确认一个主页面，其他页面改为支持性内容或调整意图，避免多个页面争夺同一查询。"
	}));
	return {
		path,
		total: items.length,
		clusters: mapped,
		cannibalization,
		unassigned: items.filter((item) => !item.targetPage).map((item) => item.term),
		nextActions: [
			...cannibalization.length > 0 ? ["先处理关键词蚕食，再扩展新页面。"] : [],
			...items.some((item) => item.volume === void 0) ? ["补充真实搜索量或保留为 seed-only，不要自行估算。"] : [],
			...items.some((item) => !item.targetPage) ? ["为高优先级关键词指定目标页面或内容 Brief。"] : [],
			"把已发布页面的 GSC 查询导入 geo_effect_review，继续找第二页机会和 CTR 异常。"
		]
	};
}
function importKeywordData(path, existing, content, source) {
	const parsed = parseKeywordData(content, source);
	const merged = mergeKeywordOpportunities(existing, parsed.items);
	return {
		items: merged.items,
		result: {
			path,
			imported: merged.added,
			updated: merged.updated,
			skipped: parsed.errors.length,
			errors: parsed.errors,
			total: merged.items.length,
			nextActions: parsed.errors.length > 0 ? ["修复无法解析的行后重新导入；不要把未知列解释成真实 SEO 指标。"] : ["运行 geo_keyword_opportunities 查看聚类、页面映射和蚕食风险。"]
		}
	};
}

//#endregion
//#region src/research.ts
function unique$3(values) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const value of values.map((item) => item.trim()).filter(Boolean)) {
		const key = value.toLocaleLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			result.push(value);
		}
	}
	return result;
}
function normalizedSet(values) {
	return new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
}
function asList(value) {
	if (Array.isArray(value)) return unique$3(value.map((item) => String(item)));
	if (typeof value === "string") return unique$3(value.split(/[\n,，、;；]/g));
	return [];
}
function asNumber(value) {
	if (value === void 0 || value === null || value === "") return void 0;
	const parsed = Number(String(value).replace(/[%$,]/g, "").trim());
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
function normalizeCompetitorDataset(input) {
	const name$1 = String(input.name || "").trim();
	if (!name$1) throw new Error("Competitor name is required.");
	return {
		name: name$1,
		...input.url?.trim() ? { url: input.url.trim() } : {},
		keywords: asList(input.keywords),
		topics: asList(input.topics),
		pages: asList(input.pages),
		...input.notes?.trim() ? { notes: input.notes.trim() } : {}
	};
}
function buildCompetitorGap(input) {
	const target = {
		keywords: asList(input.target.keywords),
		topics: asList(input.target.topics),
		pages: asList(input.target.pages)
	};
	const competitors = input.competitors.map(normalizeCompetitorDataset);
	const targetKeywords = normalizedSet(target.keywords);
	const targetTopics = normalizedSet(target.topics);
	const targetPages = normalizedSet(target.pages);
	const missingKeywords = unique$3(competitors.flatMap((item) => item.keywords).filter((term) => !targetKeywords.has(term.toLocaleLowerCase())));
	const missingTopics = unique$3(competitors.flatMap((item) => item.topics).filter((term) => !targetTopics.has(term.toLocaleLowerCase())));
	const pageGaps = unique$3(competitors.flatMap((item) => item.pages).filter((page) => !targetPages.has(page.toLocaleLowerCase())));
	return {
		target,
		competitors,
		missingKeywords,
		missingTopics,
		pageGaps,
		caveats: ["竞争对手差距只基于用户提供的词、主题和页面清单；没有自动推断竞争对手真实流量、排名或内容质量。", "差距项先作为研究候选，必须结合业务相关性、搜索意图、已有页面和事实来源再决定是否生产。"],
		nextActions: [
			...missingTopics.length > 0 ? ["把最相关的缺口主题加入 geo_keyword_import，再运行 geo_keyword_opportunities。"] : [],
			...pageGaps.length > 0 ? ["逐个确认页面缺口是否服务不同搜索意图，不要复制竞争对手页面。"] : [],
			"对确认后的候选词运行 geo_workflow，先做诊断和内容 Brief，再进入写作。"
		]
	};
}
function buildBacklinkProfile(rows, competitorRows = []) {
	const domains = new Set(rows.map((row) => {
		if (row.referringDomain?.trim()) return row.referringDomain.trim().toLocaleLowerCase();
		try {
			return new URL(row.sourceUrl).hostname.toLocaleLowerCase();
		} catch {
			return row.sourceUrl.toLocaleLowerCase();
		}
	}));
	const broken = unique$3(rows.filter((row) => row.broken).map((row) => row.sourceUrl));
	const lost = unique$3(rows.filter((row) => row.lost).map((row) => row.sourceUrl));
	const nofollow = unique$3(rows.filter((row) => row.nofollow || row.sponsored || row.ugc).map((row) => row.sourceUrl));
	const risky = rows.filter((row) => row.spamScore !== void 0 && row.spamScore >= 60).map((row) => ({
		sourceUrl: row.sourceUrl,
		reason: `导入的 spamScore 为 ${row.spamScore}，需人工核验，不等同于搜索引擎处罚。`
	}));
	const ownDomains = new Set(domains);
	const competitorGaps = [...new Set(competitorRows.map((row) => {
		try {
			return new URL(row.sourceUrl).hostname.toLocaleLowerCase();
		} catch {
			return row.sourceUrl.toLocaleLowerCase();
		}
	}))].filter((domain) => !ownDomains.has(domain)).map((domain) => `竞争对手有而当前清单没有的 referring domain：${domain}`);
	return {
		total: rows.length,
		referringDomains: domains.size,
		broken,
		lost,
		nofollow,
		risky,
		competitorGaps,
		caveats: ["外链画像依赖用户导入的 CSV/JSON；插件不会把链接数量解释为排名收益。", "nofollow、sponsored、ugc 和 spamScore 只保留导入信号；是否有价值需要结合相关性、真实推荐访问和页面存活复核。"],
		nextActions: [
			...broken.length > 0 ? ["先修复或移除 broken links，并核对目标页面是否仍然相关。"] : [],
			...lost.length > 0 ? ["复查 lost links 的公开页面和推荐访问，再决定是否联系站点方。"] : [],
			...risky.length > 0 ? ["人工审查高风险来源；不要批量购买链接或以 spamScore 单字段做结论。"] : [],
			...competitorGaps.length > 0 ? ["把竞争对手差距转成相关资源研究，不要直接复制或群发提交。"] : [],
			"将确认的公开条目纳入 geo_backlink_record，并在下一周期用 geo_effect_review 评估推荐访问和转化。"
		]
	};
}
function sameOriginLinks(html, baseUrl) {
	const links = [];
	const skipped = [];
	let base;
	try {
		base = new URL(baseUrl);
	} catch {
		return {
			links: [],
			skipped: [baseUrl]
		};
	}
	for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
		const raw = (match[1] || match[2] || match[3] || "").trim();
		if (!raw || raw.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(raw)) continue;
		try {
			const url = new URL(raw, base);
			if (url.origin !== base.origin) continue;
			url.hash = "";
			if (/\.(?:pdf|zip|png|jpe?g|gif|webp|svg|css|js|xml|json)(?:$|\?)/i.test(url.pathname)) {
				skipped.push(url.toString());
				continue;
			}
			links.push(url.toString());
		} catch {
			skipped.push(raw);
		}
	}
	return {
		links: unique$3(links),
		skipped: unique$3(skipped)
	};
}
function h1Count(html) {
	return [...html.matchAll(/<h1\b[^>]*>/gi)].length;
}
function indexability(technical) {
	if (!technical) return "unknown";
	if (/\bnoindex\b/i.test(technical.robots || "")) return "blocked";
	return "likely";
}
function buildSiteAuditPage(input) {
	const technical = input.technical;
	const links = sameOriginLinks(input.html, input.finalUrl || input.url).links;
	return {
		url: input.url,
		finalUrl: input.finalUrl || input.url,
		statusCode: input.statusCode,
		...technical?.htmlTitle ? { title: technical.htmlTitle } : {},
		...technical?.metaDescription ? { metaDescription: technical.metaDescription } : {},
		...technical?.canonicalUrl ? { canonicalUrl: technical.canonicalUrl } : {},
		...technical?.robots ? { robots: technical.robots } : {},
		indexable: indexability(technical),
		h1Count: h1Count(input.html),
		internalLinks: links.length,
		imageCount: technical?.imageCount || 0,
		imagesMissingAlt: technical?.imagesMissingAlt || 0,
		structuredDataTypes: technical?.structuredDataTypes || [],
		truncated: input.truncated,
		note: technical ? "仅根据匿名 HTTP 返回的 HTML 做有限页面审计，不代表真实收录或渲染后的页面状态。" : "返回内容不是可分析 HTML，技术字段保持 unknown。"
	};
}
function buildSiteAuditResult(input) {
	const actions = [];
	if (input.pages.some((page) => page.statusCode >= 400)) actions.push("优先修复 4xx/5xx 页面，再讨论内容扩展。");
	if (input.pages.some((page) => !page.title || !page.metaDescription)) actions.push("补充缺失的 title 或 meta description，并让它们准确反映页面意图。");
	if (input.pages.some((page) => page.indexable === "blocked")) actions.push("核对 noindex、canonical、robots 和 Sitemap，确认阻断是有意设计。");
	if (input.pages.some((page) => page.h1Count !== 1)) actions.push("检查 H1 是否缺失或重复；每页保留一个清晰的主主题。");
	if (input.pages.some((page) => page.imagesMissingAlt > 0)) actions.push("为有意义的图片补充准确 alt，装饰图片不要堆关键词。");
	if (input.pages.some((page) => page.truncated)) actions.push("部分页面达到读取上限；缩小页面范围后再验证。");
	if (actions.length === 0) actions.push("本次有限页面审计未发现高置信结构问题；仍需用 Search Console、性能工具和真实部署验证。");
	return {
		startUrl: input.startUrl,
		pages: input.pages,
		skippedLinks: unique$3(input.skippedLinks),
		limits: {
			maxPages: input.maxPages,
			depth: input.depth
		},
		caveats: ["这是同源、匿名、有限页数的 HTML 审计，不是 Lighthouse、JavaScript 渲染、robots.txt、Sitemap 或 Search Console 审计。", "页面 status、title、canonical 和 robots 是抓取时的输入信号；真实索引状态必须由站长工具验证。"],
		nextActions: actions
	};
}
function buildPromptReview(runs) {
	const grouped = /* @__PURE__ */ new Map();
	for (const run of runs) {
		const key = run.prompt.trim().toLocaleLowerCase();
		if (!key) continue;
		const list = grouped.get(key) || [];
		list.push({
			...run,
			prompt: run.prompt.trim(),
			model: run.model.trim() || "unknown",
			citedUrls: unique$3(run.citedUrls),
			answer: run.answer.trim()
		});
		grouped.set(key, list);
	}
	const prompts = [...grouped.values()].map((group) => {
		const mentionValues = group.map((run) => run.brandMentioned).filter((value) => typeof value === "boolean");
		const citedUrls = unique$3(group.flatMap((run) => run.citedUrls));
		return {
			prompt: group[0].prompt,
			models: unique$3(group.map((run) => run.model)),
			brandMentionRate: mentionValues.length > 0 ? Number((mentionValues.filter(Boolean).length / mentionValues.length * 100).toFixed(2)) : void 0,
			citedUrls,
			missingEvidence: citedUrls.length === 0 ? "没有提供引用 URL；先核对答案中的关键事实和一手来源。" : "已提供引用 URL；继续核对引用是否真正支持答案，而不是只看被提及次数。"
		};
	});
	const citationCoverage = runs.length === 0 ? 0 : Number((runs.filter((run) => run.citedUrls.length > 0).length / runs.length * 100).toFixed(2));
	return {
		totalRuns: runs.length,
		prompts,
		citationCoverage,
		caveats: ["这是用户手动采集的 Prompt/模型证据复盘，不代表所有模型、地区、时间或个性化结果。", "引用覆盖率只表示输入记录中是否带有 URL，不等于引用质量、排名或因果关系。"],
		nextActions: [
			...prompts.some((item) => item.citedUrls.length === 0) ? ["为无引用答案补充可公开复核的一手来源，并回到 geo_workflow 处理主题和证据缺口。"] : [],
			...prompts.some((item) => item.brandMentionRate === 0) ? ["检查品牌定义、实体关系、作者/组织信息和可引用页面，不要通过堆品牌词制造提及。"] : [],
			"按固定 Prompt、模型、语言、地区和日期重复采集，再比较变化；不要把一次答案当成稳定排名。"
		]
	};
}
function parseBacklinkProfileRows(value) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const row = item;
		const sourceUrl = String(row.sourceUrl || row.source_url || row.url || "").trim();
		if (!sourceUrl) return [];
		return [{
			sourceUrl,
			...String(row.targetUrl || row.target_url || "").trim() ? { targetUrl: String(row.targetUrl || row.target_url).trim() } : {},
			...String(row.referringDomain || row.referring_domain || "").trim() ? { referringDomain: String(row.referringDomain || row.referring_domain).trim() } : {},
			...String(row.anchor || "").trim() ? { anchor: String(row.anchor).trim() } : {},
			...typeof row.nofollow === "boolean" ? { nofollow: row.nofollow } : {},
			...typeof row.sponsored === "boolean" ? { sponsored: row.sponsored } : {},
			...typeof row.ugc === "boolean" ? { ugc: row.ugc } : {},
			...typeof row.broken === "boolean" ? { broken: row.broken } : {},
			...typeof row.lost === "boolean" ? { lost: row.lost } : {},
			...asNumber(row.spamScore || row.spam_score) === void 0 ? {} : { spamScore: asNumber(row.spamScore || row.spam_score) },
			...String(row.competitor || "").trim() ? { competitor: String(row.competitor).trim() } : {},
			...String(row.capturedAt || row.captured_at || "").trim() ? { capturedAt: String(row.capturedAt || row.captured_at).trim() } : {}
		}];
	});
}

//#endregion
//#region src/markdown.ts
function parseScalar(raw) {
	const value = raw.trim();
	if (!value) return "";
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (value.startsWith("[") && value.endsWith("]") || value.startsWith("{") && value.endsWith("}")) try {
		return JSON.parse(value);
	} catch {
		if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1).split(",").map((item) => parseScalar(item)).filter((item) => item !== "");
		return value;
	}
	if (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	return value;
}
function parseFrontmatter(content) {
	if (!content.startsWith("---")) return {
		frontmatter: {},
		body: content
	};
	const lines = content.split(/\r?\n/);
	if (lines[0].trim() !== "---") return {
		frontmatter: {},
		body: content
	};
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (end < 0) return {
		frontmatter: {},
		body: content
	};
	const frontmatter = {};
	const frontmatterLines = lines.slice(1, end);
	for (let index = 0; index < frontmatterLines.length; index += 1) {
		const line = frontmatterLines[index];
		const match = /^\s*([^:#][^:]*):\s*(.*)$/.exec(line);
		if (!match) continue;
		const key = match[1].trim();
		const raw = match[2];
		if (!raw.trim()) {
			const items = [];
			let next = index + 1;
			while (next < frontmatterLines.length) {
				const item = /^\s*-\s+(.+)$/.exec(frontmatterLines[next]);
				if (!item) break;
				items.push(parseScalar(item[1]));
				next += 1;
			}
			if (items.length > 0) {
				frontmatter[key] = items;
				index = next - 1;
				continue;
			}
		}
		frontmatter[key] = parseScalar(raw);
	}
	return {
		frontmatter,
		body: lines.slice(end + 1).join("\n")
	};
}
function stringsFromValue(value) {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringsFromValue);
	if (value && typeof value === "object") return Object.values(value).flatMap(stringsFromValue);
	return [];
}
function normalizedText(body) {
	return body.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g, "$1").replace(/<[^>]+>/g, " ").replace(/[>#*_`~-]/g, " ").replace(/\s+/g, " ").trim();
}
function firstParagraph(body) {
	const cleaned = body.replace(/```[\s\S]*?```/g, "").split(/\r?\n\s*\r?\n/).map((part) => part.trim()).find((part) => part && !/^#{1,6}\s/.test(part) && !/^[-*]\s/.test(part));
	return cleaned ? normalizedText(cleaned).slice(0, 800) : "";
}
function unique$2(values) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function languageOf(text$1) {
	const hasChinese = /[\u3400-\u9fff]/.test(text$1);
	const hasLatin = /[A-Za-z]/.test(text$1);
	if (hasChinese && hasLatin) return "mixed";
	if (hasChinese) return "zh";
	if (hasLatin) return "en";
	return "unknown";
}
function countWords(text$1) {
	const chinese = (text$1.match(/[\u3400-\u9fff]/g) || []).length;
	const latinWords = text$1.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
	const numbers = text$1.match(/\b\d+(?:\.\d+)?\b/g) || [];
	return chinese + latinWords.length + numbers.length;
}
function parseNote(path, content, options = {}) {
	const { frontmatter, body } = parseFrontmatter(content);
	const headings = [];
	const headingLevels = [];
	for (const match of body.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
		headingLevels.push(match[1].length);
		headings.push(match[2].trim());
	}
	const internalLinks = unique$2([...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1]));
	const markdownLinks = [...body.matchAll(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]);
	const bareUrls = [...body.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0]);
	const externalLinks = unique$2([...markdownLinks, ...bareUrls]);
	const sourceValues = Object.entries(frontmatter).filter(([key]) => /source|citation|reference|url/i.test(key)).flatMap(([, value]) => stringsFromValue(value));
	const sourceUrls = unique$2([...externalLinks, ...sourceValues.filter((value) => /^https?:\/\//.test(value))]);
	const questionHeadings = headings.filter((heading) => /[?？]$/.test(heading) || /^(如何|什么|为什么|哪些|是否|how|what|why|which|does|can)\b/i.test(heading));
	const entities = unique$2(Object.entries(frontmatter).flatMap(([key, value]) => /entity|brand|product|topic/i.test(key) ? stringsFromValue(value) : []).filter((value) => value.length <= 80));
	const primaryQueryValue = [
		frontmatter.dsh_geo_query,
		frontmatter.geo_primary_query,
		frontmatter.seo_keyword,
		frontmatter.keyword,
		frontmatter.topic
	].flatMap(stringsFromValue)[0];
	const title = headings.find((heading) => heading.length > 0) || path.split(/[\\/]/).pop()?.replace(/\.md$/i, "") || path;
	const plain = normalizedText(body);
	const listCount = (body.match(/^\s*[-*+]\s+/gm) || []).length;
	const tableCount = (body.match(/^\s*\|.+\|\s*$/gm) || []).length;
	const first = firstParagraph(body);
	return {
		path,
		title,
		content,
		frontmatter,
		headings,
		headingLevels,
		wordCount: plain ? countWords(plain) : 0,
		internalLinks,
		externalLinks,
		sourceUrls,
		questionHeadings,
		listCount,
		tableCount,
		firstParagraph: first,
		primaryQuery: primaryQueryValue,
		entities,
		hasDefinition: /\b(is|means|refers to|defined as)\b|是指|定义|指的是|是一种/.test(first.slice(0, 500)),
		hasFacts: /\d+(?:\.\d+)?\s*%?|20\d{2}年|据[^。！？]{2,30}(?:显示|指出|统计)/.test(plain),
		hasNextStep: /下一步|行动建议|建议先|可以开始|立即|next step|recommended action/i.test(body),
		truncated: options.truncated === true,
		language: languageOf(plain),
		...options.technical ? { technical: options.technical } : {}
	};
}

//#endregion
//#region src/vault.ts
const ignoredDirectories = new Set([
	".git",
	".obsidian",
	".dsh",
	"node_modules",
	".venv",
	"__pycache__"
]);
function displayPath(target, fallback) {
	if (target && typeof target === "object" && "displayPath" in target && typeof target.displayPath === "string") return target.displayPath;
	return fallback;
}
async function readNote(fs, filePath, limits, signal) {
	const target = await fs.resolve(filePath, { signal });
	const info = await fs.stat(target, signal);
	if (!info || info.type !== "file") throw new Error(`Not a readable file: ${filePath}`);
	if (info.size !== void 0 && info.size > limits.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${limits.maxFileBytes}): ${filePath}`);
	const content = await fs.readText(target, signal);
	return parseNote(displayPath(target, filePath), content.slice(0, limits.maxTextChars), { truncated: content.length > limits.maxTextChars });
}
async function scanVault(fs, rootPath, limits, signal) {
	const root = await fs.resolve(rootPath, { signal });
	const queue = [{
		target: root,
		path: displayPath(root, rootPath)
	}];
	const files = [];
	const errors = [];
	let skippedFiles = 0;
	while (queue.length > 0 && files.length < limits.maxFiles) {
		if (signal?.aborted) throw new Error("Vault scan aborted");
		const current = queue.shift();
		let entries;
		try {
			entries = await fs.listDir(current.target, signal);
		} catch (error) {
			errors.push(`${current.path}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		for (const entry of entries) {
			const childPath = join(current.path, entry.name);
			if (entry.type === "directory") {
				if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith(".")) queue.push({
					target: entry.target,
					path: childPath
				});
				continue;
			}
			if (entry.type !== "file" || !/\.md(?:own)?$/i.test(entry.name)) continue;
			if (files.length >= limits.maxFiles) {
				skippedFiles += 1;
				break;
			}
			if (entry.size !== void 0 && entry.size > limits.maxFileBytes) {
				skippedFiles += 1;
				errors.push(`${childPath}: skipped because it exceeds maxFileBytes`);
				continue;
			}
			try {
				const rawContent = await fs.readText(entry.target, signal);
				files.push(parseNote(childPath, rawContent.slice(0, limits.maxTextChars), { truncated: rawContent.length > limits.maxTextChars }));
			} catch (error) {
				skippedFiles += 1;
				errors.push(`${childPath}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	if (queue.length > 0) skippedFiles += queue.length;
	return {
		files,
		skippedFiles,
		errors
	};
}
function countValues(values) {
	const result = {};
	for (const value of values) if (value) result[value] = (result[value] || 0) + 1;
	return result;
}
function linkKey(value) {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\.(?:md|mdown)$/i, "").replace(/\/+/g, "/").toLowerCase();
}
function relativeKey(root, path) {
	const rootKey = linkKey(root).replace(/\/$/, "");
	const pathKey = linkKey(path);
	return pathKey.startsWith(`${rootKey}/`) ? pathKey.slice(rootKey.length + 1) : pathKey;
}
function stale(updated) {
	if (!updated) return false;
	const date = Date.parse(updated);
	if (Number.isNaN(date)) return false;
	return Date.now() - date > 4320 * 60 * 60 * 1e3;
}
function summarizeVault(root, scan) {
	const records = scan.files.map((file) => {
		const audit = auditNote(file);
		const status = typeof file.frontmatter.status === "string" ? file.frontmatter.status : void 0;
		const type = typeof file.frontmatter.type === "string" ? file.frontmatter.type : void 0;
		const updated = typeof file.frontmatter.updated === "string" ? file.frontmatter.updated : void 0;
		return {
			path: file.path,
			title: file.title,
			wordCount: file.wordCount,
			internalLinks: file.internalLinks,
			sourceUrls: file.sourceUrls,
			audit,
			...status === void 0 ? {} : { status },
			...type === void 0 ? {} : { type },
			...updated === void 0 ? {} : { updated }
		};
	});
	const pathByLink = /* @__PURE__ */ new Map();
	for (const record of records) {
		const relative = relativeKey(root, record.path);
		const segments = relative.split("/");
		const linkKeys = new Set([linkKey(record.path), relative]);
		for (let index = 0; index < segments.length; index += 1) linkKeys.add(segments.slice(index).join("/"));
		for (const key of linkKeys) {
			const paths = pathByLink.get(key) || [];
			paths.push(record.path);
			pathByLink.set(key, paths);
		}
	}
	const referenced = /* @__PURE__ */ new Set();
	let brokenLinks = 0;
	let ambiguousLinks = 0;
	for (const record of records) for (const link of record.internalLinks) {
		const key = linkKey(link);
		const matches = pathByLink.get(key) || [];
		if (matches.length === 1) referenced.add(matches[0]);
		else if (matches.length > 1) ambiguousLinks += 1;
		else brokenLinks += 1;
	}
	const titleCounts = countValues(records.map((record) => record.title));
	const duplicateTitles = Object.entries(titleCounts).filter(([, count]) => count > 1).map(([title]) => title);
	const scoreTotals = records.reduce((total, record) => ({
		seo: total.seo + record.audit.scores.seo,
		geo: total.geo + record.audit.scores.geo,
		aeo: total.aeo + record.audit.scores.aeo,
		overall: total.overall + record.audit.scores.overall
	}), {
		seo: 0,
		geo: 0,
		aeo: 0,
		overall: 0
	});
	const divisor = Math.max(1, records.length);
	const priorityFiles = [...records].sort((a, b) => a.audit.scores.overall - b.audit.scores.overall).slice(0, 20);
	return {
		root,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		ruleVersion: AUDIT_RULE_VERSION,
		scannedFiles: records.length,
		skippedFiles: scan.skippedFiles,
		errors: scan.errors,
		summary: {
			averageScores: {
				seo: Math.round(scoreTotals.seo / divisor),
				geo: Math.round(scoreTotals.geo / divisor),
				aeo: Math.round(scoreTotals.aeo / divisor),
				overall: Math.round(scoreTotals.overall / divisor)
			},
			missingMetadata: records.filter((record) => !record.type || !record.status || !record.updated).length,
			missingSources: records.filter((record) => record.sourceUrls.length === 0).length,
			brokenLinks,
			ambiguousLinks,
			orphanNotes: records.filter((record) => records.length > 1 && !referenced.has(record.path)).length,
			duplicateTitles,
			staleNotes: records.filter((record) => stale(record.updated)).length,
			byStatus: countValues(records.map((record) => record.status)),
			byType: countValues(records.map((record) => record.type))
		},
		priorityFiles
	};
}

//#endregion
//#region src/web.ts
function isPublicUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
function decodeHtmlEntities(value) {
	const named = {
		amp: "&",
		apos: "'",
		gt: ">",
		nbsp: " ",
		quot: "\"",
		lt: "<"
	};
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity) => {
		if (entity.toLowerCase().startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
		if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
		return named[entity.toLowerCase()] || `&${entity};`;
	});
}
function inlineHtmlToMarkdown(value, baseUrl) {
	return decodeHtmlEntities(value.replace(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi, "$1").replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, text$1) => {
		const label = inlineHtmlToMarkdown(text$1, baseUrl).trim();
		try {
			const resolved = baseUrl ? new URL(href, baseUrl).toString() : href;
			return label ? `[${label}](${resolved})` : resolved;
		} catch {
			return label || href;
		}
	}).replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**").replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*").replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function htmlToMarkdown(html, baseUrl) {
	const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
	let source = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
	const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(source)?.[2];
	if (main) source = main;
	source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, value) => `\n\n${"#".repeat(Number(level))} ${inlineHtmlToMarkdown(value, baseUrl)}\n\n`).replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, value) => `\n- ${inlineHtmlToMarkdown(value, baseUrl)}\n`).replace(/<(?:br|hr)\s*\/?>/gi, "\n").replace(/<\/p>|<\/div>|<\/section>|<\/article>|<\/main>|<\/blockquote>|<\/pre>|<\/tr>/gi, "\n\n").replace(/<p\b[^>]*>|<div\b[^>]*>|<section\b[^>]*>|<blockquote\b[^>]*>|<pre\b[^>]*>|<tr\b[^>]*>/gi, "\n");
	const body = source.split(/\r?\n/).map((line) => inlineHtmlToMarkdown(line, baseUrl).trim()).filter((line, index, all) => line || index > 0 && all[index - 1]).join("\n").replace(/\n{3,}/g, "\n\n").trim();
	const heading = title ? inlineHtmlToMarkdown(title, baseUrl) : "";
	return (body.match(/^#{1,6}\s/m) || !heading ? body : `# ${heading}\n\n${body}`).trim();
}
function attributeOf(tag, name$1) {
	const match = new RegExp(`\\b${name$1}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
	return decodeHtmlEntities(match?.[1] || match?.[2] || match?.[3] || "").trim();
}
function resolveUrl(value, baseUrl) {
	if (!value) return "";
	try {
		return baseUrl ? new URL(value, baseUrl).toString() : value;
	} catch {
		return value;
	}
}
function unique$1(values) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function extractTechnicalSeo(html, baseUrl) {
	const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
	const metaDescription = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]).find((tag) => attributeOf(tag, "name").toLocaleLowerCase() === "description");
	const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]).find((tag) => attributeOf(tag, "name").toLocaleLowerCase() === "robots");
	const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]).find((tag) => attributeOf(tag, "rel").toLocaleLowerCase().split(/\s+/).includes("canonical"));
	const hreflangCount = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]).filter((tag) => attributeOf(tag, "rel").toLocaleLowerCase().split(/\s+/).includes("alternate") && Boolean(attributeOf(tag, "hreflang"))).length;
	const structuredDataTypes = unique$1([...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((match) => [...match[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((typeMatch) => typeMatch[1])));
	const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
	return {
		htmlTitle: title ? inlineHtmlToMarkdown(title) : void 0,
		metaDescription: metaDescription ? attributeOf(metaDescription, "content") : void 0,
		canonicalUrl: canonicalTag ? resolveUrl(attributeOf(canonicalTag, "href"), baseUrl) : void 0,
		robots: robots ? attributeOf(robots, "content") : void 0,
		hreflangCount,
		structuredDataTypes,
		imageCount: images.length,
		imagesMissingAlt: images.filter((tag) => !attributeOf(tag, "alt")).length,
		hasViewport: [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) => attributeOf(match[0], "name").toLocaleLowerCase() === "viewport"),
		hasLang: /<html\b[^>]*\blang\s*=/i.test(html)
	};
}
function snapshotFrontmatter(source, sourceType, capturedAt) {
	return [
		"---",
		`source_url: ${source}`,
		`source_type: ${sourceType}`,
		`captured_at: ${capturedAt}`,
		"---",
		""
	].join("\n");
}
function limitedContent(content, limits) {
	return {
		content: content.slice(0, limits.maxTextChars),
		truncated: content.length > limits.maxTextChars
	};
}
function createSourceDocument(source, sourceType, rawContent, limits, options) {
	const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
	const resolvedSourceUrl = options.finalUrl || source;
	const technical = options.bodyKind === "html" ? extractTechnicalSeo(rawContent, resolvedSourceUrl) : void 0;
	const bounded = limitedContent(options.bodyKind === "html" ? htmlToMarkdown(rawContent, resolvedSourceUrl) : rawContent, limits);
	return {
		source,
		sourceType,
		note: parseNote(source, options.addSourceFrontmatter === false ? bounded.content : snapshotFrontmatter(options.finalUrl || source, sourceType, capturedAt) + bounded.content, {
			truncated: Boolean(options.truncated) || bounded.truncated,
			technical
		}),
		finalUrl: options.finalUrl || "",
		statusCode: options.statusCode || 0,
		bodyKind: options.bodyKind,
		capturedAt,
		truncated: Boolean(options.truncated) || bounded.truncated,
		accessNote: options.accessNote,
		...technical ? { technical } : {}
	};
}
async function fetchPublicDocument(web, url, limits, signal) {
	if (!isPublicUrl(url)) throw new Error("Only http(s) URLs can be fetched. For private pages, export Markdown or HTML and pass the local snapshot path.");
	const result = await web.fetch({ url }, signal);
	if (result.statusCode < 200 || result.statusCode >= 400) throw new Error(`The public URL returned HTTP ${result.statusCode}. If it is a logged-in or JavaScript-rendered page, export it as Markdown/HTML and analyze the local snapshot instead.`);
	return createSourceDocument(url, "public-url", result.body.content, limits, {
		bodyKind: result.body.kind,
		finalUrl: result.url,
		statusCode: result.statusCode,
		truncated: result.truncated,
		accessNote: "Fetched through Harness ctx.web using the anonymous public HTTP provider; no cookies or credentials were used."
	});
}
async function readLocalDocument(fs, filePath, limits, signal) {
	const target = await fs.resolve(filePath, { signal });
	const info = await fs.stat(target, signal);
	if (!info || info.type !== "file") throw new Error(`Not a readable Markdown/HTML snapshot: ${filePath}`);
	if (info.size !== void 0 && info.size > limits.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${limits.maxFileBytes}): ${filePath}`);
	const raw = await fs.readText(target, signal);
	const isHtml = /\.html?$/i.test(filePath);
	return createSourceDocument(filePath, isHtml ? "private-snapshot" : "local-markdown", raw, limits, {
		bodyKind: isHtml ? "html" : "markdown",
		accessNote: isHtml ? "Read a local HTML snapshot. This supports logged-in/private pages without sending cookies to the plugin." : "Read a local Markdown source. The file stays inside the configured Harness filesystem boundary.",
		addSourceFrontmatter: false
	});
}

//#endregion
//#region src/workflow.ts
function cleanTerm(value) {
	return value.replace(/^[-*#>\s]+/, "").replace(/[，。！？；：、,.!?;:]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}
function unique(values) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const value of values.map(cleanTerm)) {
		const key = value.toLocaleLowerCase();
		if (value && !seen.has(key)) {
			seen.add(key);
			result.push(value);
		}
	}
	return result;
}
function intentOf(term, role) {
	if (role === "question") return "informational";
	if (/购买|价格|报价|对比|评测|buy|price|compare|review/i.test(term)) return "commercial";
	if (/登录|官网|主页|official|login|homepage/i.test(term)) return "navigational";
	if (/下载|注册|预约|购买|download|sign up|subscribe/i.test(term)) return "transactional";
	return "informational";
}
function roleOf(term, note, primaryKeyword) {
	if (term === primaryKeyword) return "primary";
	if (note.questionHeadings.some((question) => cleanTerm(question).toLocaleLowerCase() === term.toLocaleLowerCase()) || /[?？]|^(如何|什么|为什么|哪些|how|what|why|which|can|does)\b/i.test(term)) return "question";
	if (note.entities.some((entity) => entity.toLocaleLowerCase() === term.toLocaleLowerCase())) return "entity";
	return "secondary";
}
function seedTerms(note, seeds) {
	return unique([
		...seeds,
		note.primaryQuery || "",
		note.title,
		...note.headings.slice(0, 8),
		...note.entities.slice(0, 8),
		...note.questionHeadings.slice(0, 6)
	]).slice(0, 24);
}
function relatedKnowledge(note, knowledgeNotes) {
	const anchors = unique([
		note.primaryQuery || "",
		note.title,
		...note.entities.slice(0, 8),
		...note.headings.slice(0, 8)
	]).filter((term) => term.length >= 2).slice(0, 16);
	const sourcePath = note.path.toLocaleLowerCase();
	return knowledgeNotes.filter((candidate) => candidate.path.toLocaleLowerCase() !== sourcePath).map((candidate) => {
		const searchable = [
			candidate.title,
			candidate.primaryQuery || "",
			...candidate.headings,
			...candidate.entities
		].join("\n").toLocaleLowerCase();
		const matchedTerms = anchors.filter((term) => searchable.includes(term.toLocaleLowerCase())).slice(0, 8);
		const candidateTerms = unique([
			candidate.primaryQuery || "",
			...candidate.headings.slice(0, 5),
			...candidate.entities.slice(0, 5)
		]).filter((term) => !matchedTerms.some((matched) => matched.toLocaleLowerCase() === term.toLocaleLowerCase())).slice(0, 8);
		return {
			path: candidate.path,
			title: candidate.title,
			score: matchedTerms.length * 10 + Math.min(candidate.wordCount, 500) / 100,
			matchedTerms,
			candidateTerms,
			excerpt: candidate.content.replace(/\s+/g, " ").trim().slice(0, 800)
		};
	}).filter((signal) => signal.matchedTerms.length > 0).sort((a, b) => b.score - a.score).slice(0, 8);
}
function searchQueries(primary, note) {
	return unique([
		primary,
		...(/[\u3400-\u9fff]/.test(primary) ? ["常见问题", "使用方法"] : ["common questions", "how to use"]).map((item) => `${primary} ${item}`),
		note.title
	]).slice(0, 3);
}
async function buildKeywordPlan(note, _audit, web, seeds = [], signal, knowledgeNotes = [], seoStandard) {
	const knowledgeSignals = relatedKnowledge(note, knowledgeNotes);
	const knowledgeTerms = knowledgeSignals.flatMap((signal$1) => signal$1.candidateTerms);
	const terms = seedTerms(note, [...seeds, ...knowledgeTerms]);
	const primaryKeyword = cleanTerm(seeds[0] || note.primaryQuery || note.title);
	const observed = /* @__PURE__ */ new Set();
	const searchSignals = [];
	const unknownReasons = [];
	let searchSucceeded = false;
	if (web && primaryKeyword) for (const query of searchQueries(primaryKeyword, note)) try {
		const result = await web.search({
			query,
			maxResults: 5
		}, signal);
		const observedTitles = result.sources.map((source) => cleanTerm(source.title || source.snippet || "")).filter(Boolean).slice(0, 5);
		searchSignals.push({
			query,
			sourceUrls: result.sources.map((source) => source.url).slice(0, 5),
			observedTitles
		});
		observedTitles.forEach((title) => observed.add(title));
		searchSucceeded = true;
	} catch (error) {
		unknownReasons.push(`Search signal unavailable for "${query}": ${error instanceof Error ? error.message : String(error)}`);
	}
	else unknownReasons.push("No web search provider is available; keyword recommendations use the source text and supplied seeds only.");
	const candidates = unique([...terms, ...observed]).slice(0, 36).map((term) => {
		const role = roleOf(term, note, primaryKeyword);
		const evidence = role === "primary" ? ["source primary query or user-supplied seed"] : note.headings.includes(term) ? ["source heading"] : note.entities.includes(term) ? ["source entity"] : knowledgeTerms.some((candidate) => candidate.toLocaleLowerCase() === term.toLocaleLowerCase()) ? ["related local knowledge-base note signal"] : searchSignals.some((signal$1) => signal$1.observedTitles.includes(term)) ? ["qualitative search result title/snippet signal"] : ["source text signal"];
		return {
			term,
			role,
			intent: intentOf(term, role),
			evidence
		};
	});
	const seoGuidance = seoStandard?.checks.filter((item) => item.status === "warn").slice(0, 6).map((item) => `${item.id}: ${item.recommendation}`) || [];
	const adjustments = [
		primaryKeyword ? `Use "${primaryKeyword}" as the single primary query in the title, H1 and opening answer.` : "Choose one explicit primary query before drafting.",
		"Map each secondary term to one section or supporting paragraph; do not repeat variants unnaturally.",
		"Turn question terms into H2/H3 questions and answer each one directly before adding context.",
		"Use entities to define scope and relationships, not as a disconnected keyword list.",
		...seoGuidance,
		"Search signals are qualitative only; do not claim search volume, ranking difficulty or traffic without a dedicated data source."
	];
	return {
		status: searchSucceeded ? unknownReasons.length > 0 ? "partial" : "ready" : "seeds-only",
		dataQuality: searchSucceeded ? "qualitative" : "seed-only",
		volumeDataAvailable: false,
		primaryKeyword,
		candidates,
		searchSignals,
		knowledgeSignals,
		seoGuidance,
		adjustments,
		unknownReasons
	};
}
function buildProductionPlan(brief, audit, keywordPlan, opportunityMap) {
	return {
		contentInputs: {
			source: [
				`Source: ${brief.source}`,
				`Topic: ${brief.topic}`,
				`Intent: ${brief.intent}`,
				`Audience: ${brief.audience}`,
				`Direct answer: ${brief.directAnswer}`,
				...brief.sourceGaps.length > 0 ? [`Source gaps: ${brief.sourceGaps.join("; ")}`] : []
			],
			knowledgeBase: keywordPlan.knowledgeSignals.length > 0 ? keywordPlan.knowledgeSignals.map((signal) => `${signal.title} (${signal.path}) — matched: ${signal.matchedTerms.join(", ")}; candidate terms: ${signal.candidateTerms.join(", ")}; local excerpt: ${signal.excerpt}`) : ["No related local knowledge-base notes were found or knowledge-base context was not enabled."],
			seoStandard: keywordPlan.seoGuidance.length > 0 ? keywordPlan.seoGuidance : ["No current Google-standard warning was raised by the available source; keep deployment-level checks marked unknown until HTML/Search Console validation."],
			keywordMap: [
				...keywordPlan.candidates.slice(0, 18).map((candidate) => `${candidate.role}/${candidate.intent}: ${candidate.term} — ${candidate.evidence.join(", ")}`),
				...opportunityMap ? opportunityMap.clusters.slice(0, 12).map((cluster) => `Opportunity cluster/${cluster.priority}: ${cluster.name} — target pages: ${cluster.targetPages.join(", ") || "unassigned"}; terms: ${cluster.terms.slice(0, 8).join(", ")}`) : [],
				...opportunityMap ? opportunityMap.cannibalization.slice(0, 8).map((item) => `Cannibalization: ${item.term} — ${item.targetPages.join(", ")}`) : []
			]
		},
		stages: [
			{
				id: "diagnose",
				objective: "Fix the highest-impact evidence-backed issues before expanding the page.",
				actions: audit.topActions.slice(0, 5),
				deliverable: "A prioritized diagnosis with facts, gaps and boundaries clearly separated."
			},
			{
				id: "keyword-map",
				objective: "Assign search intent and entities to sections so the draft has one job per block.",
				actions: keywordPlan.adjustments.slice(0, 4),
				deliverable: "A primary query, supporting terms, question headings and entity scope."
			},
			{
				id: "draft",
				objective: "Produce a useful answer that a search engine and an answer engine can quote accurately.",
				actions: [
					`Open with the direct answer: ${brief.directAnswer}`,
					`Use this outline: ${brief.outline.join(" → ")}`,
					"Include concrete examples, constraints, source links and a next action; avoid unsupported claims."
				],
				deliverable: "A complete Markdown draft with title, answer-first opening, structured sections, FAQ and provenance."
			},
			{
				id: "verify",
				objective: "Re-audit the draft and confirm that improvements did not remove evidence or useful links.",
				actions: [
					"Run geo_audit_note again and compare SEO/GEO/AEO scores with the baseline.",
					"Run geo_source_check and verify each important claim has an appropriate source.",
					"Preview the complete replacement and write back only after reviewing the diff."
				],
				deliverable: "A verified Markdown update plus a short record of remaining unknowns."
			}
		],
		draftContract: {
			requiredSections: [
				`Answer the primary query: ${keywordPlan.primaryKeyword || brief.topic}`,
				"Definition and scope",
				"Method, criteria or step-by-step guidance",
				"Common questions and boundary conditions",
				"Sources and next action"
			],
			evidenceRules: [
				"Separate facts, opinions and inferences.",
				"Attach source URLs and dates to claims that can change.",
				"Do not invent search volume, rankings, customer results or citations."
			],
			outputFormat: "Markdown with one clear H1, sequential H2/H3 headings, short answer-first paragraphs, lists/tables where useful, and source links."
		},
		writebackInstructions: [
			"For an existing Markdown note, call geo_preview_content with the complete replacement.",
			"For a new note, set createIfMissing=true and preview the destination path inside defaultRoot.",
			"After reviewing the diff, call geo_apply_content with path and previewToken; the token binds the exact content."
		]
	};
}
function buildSeoSop(input) {
	const effectiveGoal = input.goal || input.brief.intent;
	const effectiveAudience = input.audience || input.brief.audience;
	return {
		name: "标准 SEO/GEO/AEO 内容生产 SOP",
		version: "0.4.0",
		mode: "read-only",
		currentStep: input.sourceTruncated ? "connect-source" : input.keywordPlan.status === "partial" || (input.knowledgeBaseIssues?.length || 0) > 0 ? "keyword-map" : "draft",
		steps: [
			{
				id: "define-goal",
				order: 1,
				title: "明确目标和受众",
				status: "completed",
				objective: "把业务目标、受众和页面动作写成可检查的内容任务。",
				inputs: [`目标：${effectiveGoal}`, `受众：${effectiveAudience}`],
				outputs: ["目标卡：目标、受众、主题意图和下一步动作。"],
				completionCriteria: ["目标和受众已经记录；未提供时使用了可见的默认推断。"],
				nextAction: "确认目标和受众是否正确；若不正确，重新运行 geo_workflow 并补充 goal/audience。"
			},
			{
				id: "connect-source",
				order: 2,
				title: "接入并确认来源",
				status: input.sourceTruncated ? "ready" : "completed",
				objective: "确认来源类型、访问方式、最终 URL、HTTP 状态和内容是否完整。",
				inputs: [`来源：${input.source}`, `来源类型：${input.sourceType}`],
				outputs: ["来源快照、访问限制、截断状态和隐私边界。"],
				completionCriteria: ["来源可读取；公开 URL 为 2xx/3xx；本地文件位于 defaultRoot；没有未解释的截断。"],
				nextAction: input.sourceTruncated ? "来源超过读取上限；导出更聚焦的 Markdown/HTML 快照或拆分内容后重新运行。" : "进入基线诊断。"
			},
			{
				id: "baseline-audit",
				order: 3,
				title: "建立 SEO/GEO/AEO 基线",
				status: "completed",
				objective: "先看证据、标准检查和 unknown，再决定改什么。",
				inputs: ["来源正文和元数据", "Google 标准 SEO 检查清单"],
				outputs: [
					`SEO/GEO/AEO 分数：${input.audit.scores.seo}/${input.audit.scores.geo}/${input.audit.scores.aeo}`,
					`Google 标准：${input.audit.seoStandard.summary.pass} pass、${input.audit.seoStandard.summary.warn} warn、${input.audit.seoStandard.summary.unknown} unknown`,
					...input.audit.topActions.slice(0, 3)
				],
				completionCriteria: ["高影响发现有证据；部署级事实没有被 unknown 冒充为已验证。"],
				nextAction: "只选择影响最大且有证据支持的 1-3 个问题进入关键词与内容规划。"
			},
			{
				id: "keyword-map",
				order: 4,
				title: "建立关键词和意图地图",
				status: input.keywordPlan.status === "partial" || (input.knowledgeBaseIssues?.length || 0) > 0 ? "ready" : "completed",
				objective: "让关键词服务页面结构，而不是生成孤立的词表。",
				inputs: [
					"来源主题和 frontmatter",
					input.knowledgeBaseEnabled ? "defaultRoot 相关笔记和受限本地摘录" : "未启用本地知识库",
					"公开搜索定性信号（如适用）",
					"Google 标准警告"
				],
				outputs: [
					`主查询：${input.keywordPlan.primaryKeyword || "未确定"}`,
					`候选词：${input.keywordPlan.candidates.length} 个`,
					`数据质量：${input.keywordPlan.dataQuality}`,
					`相关知识库笔记：${input.keywordPlan.knowledgeSignals.length} 篇`
				],
				completionCriteria: ["一个主查询已确定；次级主题、问题词和实体已分配到具体章节；搜索量缺失被明确标记。"],
				nextAction: input.keywordPlan.status === "partial" || (input.knowledgeBaseIssues?.length || 0) > 0 ? "检查公开搜索或知识库读取问题；在不影响隐私的前提下补充外部关键词数据或继续使用 seed-only。" : "进入内容 Brief 和信息架构。"
			},
			{
				id: "content-brief",
				order: 5,
				title: "生成内容 Brief 和信息架构",
				status: "completed",
				objective: "把来源、知识库、SEO 规范和关键词地图合并成写作规格。",
				inputs: [
					"source",
					"knowledgeBase",
					"seoStandard",
					"keywordMap"
				],
				outputs: [
					`推荐标题：${input.brief.recommendedTitle}`,
					`章节数：${input.brief.outline.length}`,
					`问题数：${input.brief.questions.length}`,
					`来源缺口：${input.brief.sourceGaps.length}`
				],
				completionCriteria: ["有直接答案、受众、意图、大纲、问题、来源缺口和下一步动作。"],
				nextAction: "使用 productionPlan.contentInputs 和 draftContract 生成 Markdown 草稿。"
			},
			{
				id: "draft",
				order: 6,
				title: "按输入契约生产内容",
				status: "ready",
				objective: "生成有用、可读、可引用且保留事实边界的 Markdown。",
				inputs: [
					"productionPlan.contentInputs",
					"productionPlan.draftContract",
					"原始来源和相关知识库摘录"
				],
				outputs: ["完整 Markdown 草稿：标题、直接答案、分层正文、FAQ、来源和下一步。"],
				completionCriteria: ["草稿覆盖主查询和用户任务；事实有来源；没有虚构搜索量、排名、引用或客户结果。"],
				nextAction: "让 Harness 生成草稿，但不要直接覆盖原文件；先进入验证和预览。"
			},
			{
				id: "verify",
				order: 7,
				title: "验证内容和部署边界",
				status: "ready",
				objective: "确认优化没有损坏事实、来源、链接和知识结构。",
				inputs: [
					"草稿",
					"seoStandard",
					"基线审计"
				],
				outputs: ["重新审计结果、来源检查结果、剩余 unknown 和差异说明。"],
				completionCriteria: ["高影响问题有改善证据；关键来源存在；新增事实有日期/边界；unknown 仍被保留。"],
				nextAction: "运行 geo_audit_note 和 geo_source_check，再请求完整 Markdown diff。"
			},
			{
				id: "preview-writeback",
				order: 8,
				title: "预览并安全写回",
				status: "ready",
				objective: "让每次修改可审阅、可回退且不会覆盖并发更新。",
				inputs: ["目标 Markdown 路径", "完整草稿"],
				outputs: ["diff、旧/新哈希、previewToken 和版本保护结果。"],
				completionCriteria: ["用户检查 diff；目标在 defaultRoot 内；写回使用有效 previewToken。"],
				nextAction: "明确确认后调用 geo_apply_content；若文件变化，重新预览，不强行写入。"
			},
			{
				id: "re-audit",
				order: 9,
				title: "写回后复查和迭代",
				status: "ready",
				objective: "用同一套标准比较优化前后，而不是凭感觉结束任务。",
				inputs: ["写回后的当前文件", "原始基线审计"],
				outputs: ["前后分数、发现项变化、来源变化、剩余工作清单。"],
				completionCriteria: ["高优先级问题有明确结果；未完成项有下一次迭代动作。"],
				nextAction: "使用 Search Console、PageSpeed 或站点分析补充插件无法证明的部署级数据；如需产品发现分发，再运行 geo_backlink_plan，完成手动提交后记录结果。"
			}
		],
		completionCriteria: [
			"目标、受众和页面动作明确。",
			"来源类型、访问限制、截断和隐私边界明确。",
			"主查询、关键词地图、内容 Brief 和四类生产输入齐全。",
			"草稿通过 SEO/GEO/AEO、来源和结构复查。",
			"写回前检查 diff，写回后重新审计。",
			"如启用外链分支，候选经过质量核验，平台动作由用户手动完成，结果和公开证据已记录。",
			"Sitemap、Search Console、Core Web Vitals、真实收录和流量等外部数据另行验证。"
		],
		limitations: [
			"当前结果是只读 SOP 和生产契约；插件不会在没有 Harness 模型参与的情况下自行生成事实性文章。",
			"搜索量、排名难度、收录、点击和转化不由插件编造，必须使用独立数据源。",
			"外链工具只做匿名预检、提交准备和结果记录，不替代平台原生登录/表单，也不绕过验证码或安全验证。"
		]
	};
}

//#endregion
//#region src/tools.ts
const findingOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		pillar: {
			type: "string",
			enum: [
				"seo",
				"geo",
				"aeo"
			],
			required: true
		},
		severity: {
			type: "string",
			enum: [
				"critical",
				"high",
				"medium",
				"low",
				"info"
			],
			required: true
		},
		message: {
			type: "string",
			required: true
		},
		evidence: {
			type: "string",
			required: true
		},
		recommendation: {
			type: "string",
			required: true
		},
		scoreImpact: {
			type: "number",
			required: true
		}
	}
};
const seoStandardSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		framework: {
			type: "string",
			required: true
		},
		ruleVersion: {
			type: "string",
			required: true
		},
		checks: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					area: {
						type: "string",
						enum: [
							"content",
							"crawl-index",
							"search-presentation",
							"links",
							"media",
							"monitoring"
						],
						required: true
					},
					status: {
						type: "string",
						enum: [
							"pass",
							"warn",
							"unknown"
						],
						required: true
					},
					evidence: {
						type: "string",
						required: true
					},
					recommendation: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		summary: {
			type: "object",
			additionalProperties: false,
			properties: {
				pass: {
					type: "number",
					required: true
				},
				warn: {
					type: "number",
					required: true
				},
				unknown: {
					type: "number",
					required: true
				}
			},
			required: true
		},
		limitations: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		references: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const auditOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		target: {
			type: "string",
			required: true
		},
		focus: {
			type: "string",
			enum: [
				"seo",
				"geo",
				"aeo",
				"all"
			],
			required: true
		},
		generatedAt: {
			type: "string",
			required: true
		},
		ruleVersion: {
			type: "string",
			required: true
		},
		confidence: {
			type: "number",
			required: true
		},
		unknownReasons: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		truncated: {
			type: "boolean",
			required: true
		},
		scores: {
			type: "object",
			additionalProperties: false,
			properties: {
				seo: {
					type: "number",
					required: true
				},
				geo: {
					type: "number",
					required: true
				},
				aeo: {
					type: "number",
					required: true
				},
				overall: {
					type: "number",
					required: true
				}
			},
			required: true
		},
		stats: {
			type: "object",
			additionalProperties: false,
			properties: {
				wordCount: {
					type: "number",
					required: true
				},
				headings: {
					type: "number",
					required: true
				},
				internalLinks: {
					type: "number",
					required: true
				},
				externalLinks: {
					type: "number",
					required: true
				},
				sources: {
					type: "number",
					required: true
				},
				entities: {
					type: "number",
					required: true
				},
				questions: {
					type: "number",
					required: true
				}
			},
			required: true
		},
		seoStandard: seoStandardSchema,
		findings: {
			type: "array",
			items: findingOutputSchema,
			required: true
		},
		topActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const vaultAuditSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		target: {
			type: "string",
			required: true
		},
		generatedAt: {
			type: "string",
			required: true
		},
		ruleVersion: {
			type: "string",
			required: true
		},
		confidence: {
			type: "number",
			required: true
		},
		unknownReasons: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		truncated: {
			type: "boolean",
			required: true
		},
		scores: {
			type: "object",
			additionalProperties: false,
			properties: {
				seo: {
					type: "number",
					required: true
				},
				geo: {
					type: "number",
					required: true
				},
				aeo: {
					type: "number",
					required: true
				},
				overall: {
					type: "number",
					required: true
				}
			},
			required: true
		},
		stats: {
			type: "json",
			required: true
		},
		seoStandard: seoStandardSchema,
		findings: {
			type: "array",
			items: findingOutputSchema,
			required: true
		},
		topActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const vaultSummarySchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		averageScores: {
			type: "object",
			additionalProperties: false,
			properties: {
				seo: {
					type: "number",
					required: true
				},
				geo: {
					type: "number",
					required: true
				},
				aeo: {
					type: "number",
					required: true
				},
				overall: {
					type: "number",
					required: true
				}
			},
			required: true
		},
		missingMetadata: {
			type: "number",
			required: true
		},
		missingSources: {
			type: "number",
			required: true
		},
		brokenLinks: {
			type: "number",
			required: true
		},
		ambiguousLinks: {
			type: "number",
			required: true
		},
		orphanNotes: {
			type: "number",
			required: true
		},
		duplicateTitles: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		staleNotes: {
			type: "number",
			required: true
		},
		byStatus: {
			type: "json",
			required: true
		},
		byType: {
			type: "json",
			required: true
		}
	}
};
const vaultFileSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: {
			type: "string",
			required: true
		},
		title: {
			type: "string",
			required: true
		},
		wordCount: {
			type: "number",
			required: true
		},
		status: { type: "string" },
		type: { type: "string" },
		updated: { type: "string" },
		internalLinks: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		sourceUrls: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		audit: vaultAuditSchema
	}
};
const scoreOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		seo: {
			type: "number",
			required: true
		},
		geo: {
			type: "number",
			required: true
		},
		aeo: {
			type: "number",
			required: true
		},
		overall: {
			type: "number",
			required: true
		}
	}
};
const vaultOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		root: {
			type: "string",
			required: true
		},
		generatedAt: {
			type: "string",
			required: true
		},
		ruleVersion: {
			type: "string",
			required: true
		},
		scannedFiles: {
			type: "number",
			required: true
		},
		skippedFiles: {
			type: "number",
			required: true
		},
		errors: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		summary: vaultSummarySchema,
		priorityFiles: {
			type: "array",
			items: vaultFileSchema,
			required: true
		}
	}
};
const briefOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		source: {
			type: "string",
			required: true
		},
		topic: {
			type: "string",
			required: true
		},
		intent: {
			type: "string",
			required: true
		},
		audience: {
			type: "string",
			required: true
		},
		scores: {
			...scoreOutputSchema,
			required: true
		},
		recommendedTitle: {
			type: "string",
			required: true
		},
		directAnswer: {
			type: "string",
			required: true
		},
		outline: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		questions: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		entities: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		sourceGaps: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const sourceOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: {
			type: "string",
			required: true
		},
		sourceUrls: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		sourceFields: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					key: {
						type: "string",
						required: true
					},
					value: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		updated: {
			type: "string",
			required: true
		},
		hasSources: {
			type: "boolean",
			required: true
		},
		freshness: {
			type: "object",
			additionalProperties: false,
			properties: {
				status: {
					type: "string",
					enum: [
						"fresh",
						"stale",
						"unknown"
					],
					required: true
				},
				ageDays: {
					type: "number",
					required: true
				},
				message: {
					type: "string",
					required: true
				}
			},
			required: true
		},
		sourceGaps: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		recommendations: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const previewOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			enum: ["preview-only", "applied"],
			required: true
		},
		path: {
			type: "string",
			required: true
		},
		previewToken: {
			type: "string",
			required: true
		},
		created: {
			type: "boolean",
			required: true
		},
		oldHash: {
			type: "string",
			required: true
		},
		newHash: {
			type: "string",
			required: true
		},
		expiresAt: {
			type: "string",
			required: true
		},
		changed: {
			type: "boolean",
			required: true
		},
		applied: {
			type: "boolean",
			required: true
		},
		guarded: {
			type: "boolean",
			required: true
		}
	}
};
const applyOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			enum: ["applied"],
			required: true
		},
		path: {
			type: "string",
			required: true
		},
		previewToken: {
			type: "string",
			required: true
		},
		created: {
			type: "boolean",
			required: true
		},
		oldHash: {
			type: "string",
			required: true
		},
		newHash: {
			type: "string",
			required: true
		},
		changed: {
			type: "boolean",
			required: true
		},
		applied: {
			type: "boolean",
			required: true
		},
		guarded: {
			type: "boolean",
			required: true
		}
	}
};
const setupOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		root: {
			type: "string",
			required: true
		},
		ready: {
			type: "boolean",
			required: true
		},
		markdownFiles: {
			type: "number",
			required: true
		},
		checks: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						enum: [
							"pass",
							"warn",
							"fail"
						],
						required: true
					},
					message: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		recommendations: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const reportOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		root: {
			type: "string",
			required: true
		},
		generatedAt: {
			type: "string",
			required: true
		},
		ruleVersion: {
			type: "string",
			required: true
		},
		scannedFiles: {
			type: "number",
			required: true
		},
		skippedFiles: {
			type: "number",
			required: true
		},
		errors: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		summary: vaultSummarySchema,
		priorityFiles: {
			type: "array",
			items: vaultFileSchema,
			required: true
		},
		reportMarkdown: {
			type: "string",
			required: true
		}
	}
};
const keywordPlanSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			enum: [
				"ready",
				"partial",
				"seeds-only"
			],
			required: true
		},
		dataQuality: {
			type: "string",
			enum: ["qualitative", "seed-only"],
			required: true
		},
		volumeDataAvailable: {
			type: "boolean",
			required: true
		},
		primaryKeyword: {
			type: "string",
			required: true
		},
		candidates: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					term: {
						type: "string",
						required: true
					},
					role: {
						type: "string",
						enum: [
							"primary",
							"secondary",
							"question",
							"entity"
						],
						required: true
					},
					intent: {
						type: "string",
						enum: [
							"informational",
							"commercial",
							"navigational",
							"transactional",
							"unknown"
						],
						required: true
					},
					evidence: {
						type: "array",
						items: { type: "string" },
						required: true
					}
				}
			},
			required: true
		},
		searchSignals: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					query: {
						type: "string",
						required: true
					},
					sourceUrls: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					observedTitles: {
						type: "array",
						items: { type: "string" },
						required: true
					}
				}
			},
			required: true
		},
		knowledgeSignals: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					title: {
						type: "string",
						required: true
					},
					score: {
						type: "number",
						required: true
					},
					matchedTerms: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					candidateTerms: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					excerpt: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		seoGuidance: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		adjustments: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		unknownReasons: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const productionPlanSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		contentInputs: {
			type: "object",
			additionalProperties: false,
			properties: {
				source: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				knowledgeBase: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				seoStandard: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				keywordMap: {
					type: "array",
					items: { type: "string" },
					required: true
				}
			},
			required: true
		},
		stages: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						enum: [
							"diagnose",
							"keyword-map",
							"draft",
							"verify"
						],
						required: true
					},
					objective: {
						type: "string",
						required: true
					},
					actions: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					deliverable: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		draftContract: {
			type: "object",
			additionalProperties: false,
			properties: {
				requiredSections: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				evidenceRules: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				outputFormat: {
					type: "string",
					required: true
				}
			},
			required: true
		},
		writebackInstructions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const sopSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		name: {
			type: "string",
			required: true
		},
		version: {
			type: "string",
			required: true
		},
		mode: {
			type: "string",
			enum: ["read-only"],
			required: true
		},
		currentStep: {
			type: "string",
			enum: [
				"define-goal",
				"connect-source",
				"baseline-audit",
				"keyword-map",
				"content-brief",
				"draft",
				"verify",
				"preview-writeback",
				"re-audit"
			],
			required: true
		},
		steps: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						enum: [
							"define-goal",
							"connect-source",
							"baseline-audit",
							"keyword-map",
							"content-brief",
							"draft",
							"verify",
							"preview-writeback",
							"re-audit"
						],
						required: true
					},
					order: {
						type: "number",
						required: true
					},
					title: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						enum: [
							"completed",
							"ready",
							"blocked"
						],
						required: true
					},
					objective: {
						type: "string",
						required: true
					},
					inputs: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					outputs: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					completionCriteria: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					nextAction: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		completionCriteria: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		limitations: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const backlinkPlanSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: {
			type: "string",
			required: true
		},
		mode: {
			type: "string",
			enum: ["quality", "batch"],
			required: true
		},
		status: {
			type: "string",
			enum: ["ready", "partial"],
			required: true
		},
		product: {
			type: "object",
			additionalProperties: false,
			properties: {
				name: {
					type: "string",
					required: true
				},
				url: {
					type: "string",
					required: true
				},
				canonicalUrl: {
					type: "string",
					required: true
				}
			},
			required: true
		},
		source: {
			type: "object",
			additionalProperties: false,
			properties: {
				kind: {
					type: "string",
					enum: ["built-in-catalog", "user-supplied"],
					required: true
				},
				reference: {
					type: "string",
					required: true
				},
				candidateCount: {
					type: "number",
					required: true
				}
			},
			required: true
		},
		candidates: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						required: true
					},
					resource: {
						type: "object",
						additionalProperties: false,
						properties: {
							id: {
								type: "string",
								required: true
							},
							name: {
								type: "string",
								required: true
							},
							url: {
								type: "string",
								required: true
							},
							route: {
								type: "string",
								enum: [
									"product-directory",
									"startup-directory",
									"developer-community",
									"software-directory",
									"other"
								],
								required: true
							},
							audience: {
								type: "string",
								required: true
							},
							relevance: {
								type: "string",
								required: true
							},
							source: {
								type: "string",
								required: true
							},
							historicalNote: { type: "string" },
							requiresAccount: { type: "boolean" }
						},
						required: true
					},
					normalizedUrl: {
						type: "string",
						required: true
					},
					idempotencyKey: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						enum: [
							"not-attempted",
							"manual-required",
							"submitted",
							"awaiting-email-verification",
							"awaiting-approval",
							"published",
							"outcome-unknown",
							"failed",
							"ineligible",
							"unavailable"
						],
						required: true
					},
					qualityGate: {
						type: "string",
						enum: [
							"not-checked",
							"passed",
							"failed"
						],
						required: true
					},
					preflight: {
						type: "object",
						additionalProperties: false,
						properties: {
							checked: {
								type: "boolean",
								required: true
							},
							statusCode: { type: "number" },
							finalUrl: { type: "string" },
							title: { type: "string" },
							note: {
								type: "string",
								required: true
							}
						},
						required: true
					},
					exclusionReasons: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					nextAction: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		manualQueue: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		excluded: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					url: {
						type: "string",
						required: true
					},
					reason: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		submissionPack: {
			type: "object",
			additionalProperties: false,
			properties: {
				shortDescription: {
					type: "string",
					required: true
				},
				longDescription: {
					type: "string",
					required: true
				},
				suggestedAnchor: {
					type: "string",
					required: true
				},
				factsToVerify: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				prohibitedClaims: {
					type: "array",
					items: { type: "string" },
					required: true
				}
			},
			required: true
		},
		guardrails: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const backlinkRecordResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: {
			type: "string",
			required: true
		},
		path: {
			type: "string",
			required: true
		},
		status: {
			type: "string",
			enum: [
				"not-attempted",
				"manual-required",
				"submitted",
				"awaiting-email-verification",
				"awaiting-approval",
				"published",
				"outcome-unknown",
				"failed",
				"ineligible",
				"unavailable"
			],
			required: true
		},
		idempotencyKey: {
			type: "string",
			required: true
		},
		recordedAt: {
			type: "string",
			required: true
		},
		changed: {
			type: "boolean",
			required: true
		},
		evidence: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		nextAction: {
			type: "string",
			required: true
		}
	}
};
const backlinkAuditSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: {
			type: "string",
			required: true
		},
		total: {
			type: "number",
			required: true
		},
		counts: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					status: {
						type: "string",
						enum: [
							"not-attempted",
							"manual-required",
							"submitted",
							"awaiting-email-verification",
							"awaiting-approval",
							"published",
							"outcome-unknown",
							"failed",
							"ineligible",
							"unavailable"
						],
						required: true
					},
					count: {
						type: "number",
						required: true
					}
				}
			},
			required: true
		},
		published: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		needsFollowUp: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		errors: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const effectSnapshotSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		period: {
			type: "string",
			required: true
		},
		source: {
			type: "string",
			required: true
		},
		impressions: { type: "number" },
		clicks: { type: "number" },
		ctrPercent: { type: "number" },
		averagePosition: { type: "number" },
		conversions: { type: "number" },
		indexedPages: { type: "number" },
		referralVisits: { type: "number" },
		referralConversions: { type: "number" }
	}
};
const effectReviewSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: {
			type: "string",
			required: true
		},
		target: {
			type: "string",
			required: true
		},
		status: {
			type: "string",
			enum: [
				"improving",
				"declining",
				"mixed",
				"inconclusive"
			],
			required: true
		},
		baseline: {
			...effectSnapshotSchema,
			required: true
		},
		current: {
			...effectSnapshotSchema,
			required: true
		},
		changes: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					metric: {
						type: "string",
						required: true
					},
					baseline: { type: "number" },
					current: { type: "number" },
					delta: { type: "number" },
					relativeChangePercent: { type: "number" },
					direction: {
						type: "string",
						enum: [
							"up",
							"down",
							"unchanged",
							"unknown"
						],
						required: true
					},
					interpretation: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		opportunities: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					type: {
						type: "string",
						enum: [
							"striking-distance",
							"low-ctr",
							"indexing",
							"cannibalization"
						],
						required: true
					},
					query: { type: "string" },
					page: { type: "string" },
					evidence: {
						type: "string",
						required: true
					},
					nextAction: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		anomalies: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		dataQuality: {
			type: "string",
			enum: [
				"comparable",
				"partial",
				"insufficient"
			],
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		limitations: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const projectContextResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: {
			type: "string",
			required: true
		},
		status: {
			type: "string",
			enum: [
				"missing",
				"partial",
				"ready"
			],
			required: true
		},
		context: {
			type: "object",
			additionalProperties: false,
			properties: {
				version: {
					type: "string",
					required: true
				},
				updatedAt: {
					type: "string",
					required: true
				},
				businessGoal: {
					type: "string",
					required: true
				},
				audience: {
					type: "string",
					required: true
				},
				language: {
					type: "string",
					required: true
				},
				market: {
					type: "string",
					required: true
				},
				brandName: {
					type: "string",
					required: true
				},
				canonicalDomain: {
					type: "string",
					required: true
				},
				brandTerms: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				competitors: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				keyPages: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				conversionGoals: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				constraints: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				sourceNotes: {
					type: "array",
					items: { type: "string" },
					required: true
				}
			}
		},
		missingFields: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const keywordImportSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: {
			type: "string",
			required: true
		},
		imported: {
			type: "number",
			required: true
		},
		updated: {
			type: "number",
			required: true
		},
		skipped: {
			type: "number",
			required: true
		},
		errors: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		total: {
			type: "number",
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const keywordOpportunityMapSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: {
			type: "string",
			required: true
		},
		total: {
			type: "number",
			required: true
		},
		clusters: {
			type: "json",
			required: true
		},
		cannibalization: {
			type: "json",
			required: true
		},
		unassigned: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		}
	}
};
const coachSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		currentStep: {
			type: "string",
			enum: [
				"project-context",
				"source",
				"keyword-import",
				"keyword-map",
				"effect-review",
				"backlink-plan",
				"next-diagnosis"
			],
			required: true
		},
		status: {
			type: "string",
			enum: [
				"ready",
				"blocked",
				"complete"
			],
			required: true
		},
		reason: {
			type: "string",
			required: true
		},
		inputs: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					name: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						enum: [
							"present",
							"missing",
							"partial"
						],
						required: true
					},
					path: { type: "string" },
					note: {
						type: "string",
						required: true
					}
				}
			},
			required: true
		},
		nextActions: {
			type: "array",
			items: { type: "string" },
			required: true
		},
		suggestedPrompt: {
			type: "string",
			required: true
		}
	}
};
const researchJsonSchema = { type: "json" };
const workflowOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		source: {
			type: "string",
			required: true
		},
		sourceType: {
			type: "string",
			enum: [
				"public-url",
				"local-markdown",
				"private-snapshot"
			],
			required: true
		},
		status: {
			type: "string",
			enum: ["ready", "partial"],
			required: true
		},
		access: {
			type: "object",
			additionalProperties: false,
			properties: {
				mode: {
					type: "string",
					enum: ["public-url", "local-file"],
					required: true
				},
				credentialsUsed: {
					type: "boolean",
					required: true
				},
				limitation: {
					type: "string",
					required: true
				}
			},
			required: true
		},
		capture: {
			type: "object",
			additionalProperties: false,
			properties: {
				finalUrl: {
					type: "string",
					required: true
				},
				statusCode: {
					type: "number",
					required: true
				},
				bodyKind: {
					type: "string",
					enum: [
						"html",
						"text",
						"markdown",
						"snapshot"
					],
					required: true
				},
				capturedAt: {
					type: "string",
					required: true
				},
				truncated: {
					type: "boolean",
					required: true
				},
				note: {
					type: "string",
					required: true
				}
			},
			required: true
		},
		knowledgeBase: {
			type: "object",
			additionalProperties: false,
			properties: {
				enabled: {
					type: "boolean",
					required: true
				},
				scannedFiles: {
					type: "number",
					required: true
				},
				skippedFiles: {
					type: "number",
					required: true
				},
				relatedNotes: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							path: {
								type: "string",
								required: true
							},
							title: {
								type: "string",
								required: true
							},
							score: {
								type: "number",
								required: true
							},
							matchedTerms: {
								type: "array",
								items: { type: "string" },
								required: true
							},
							candidateTerms: {
								type: "array",
								items: { type: "string" },
								required: true
							},
							excerpt: {
								type: "string",
								required: true
							}
						}
					},
					required: true
				},
				errors: {
					type: "array",
					items: { type: "string" },
					required: true
				},
				privacy: {
					type: "string",
					required: true
				}
			},
			required: true
		},
		projectContext: {
			...projectContextResultSchema,
			required: true
		},
		audit: auditOutputSchema,
		sop: sopSchema,
		keywordPlan: keywordPlanSchema,
		keywordOpportunities: keywordOpportunityMapSchema,
		contentBrief: briefOutputSchema,
		productionPlan: productionPlanSchema,
		writeback: {
			type: "object",
			additionalProperties: false,
			properties: {
				canPreviewExistingFile: {
					type: "boolean",
					required: true
				},
				canCreateNewFile: {
					type: "boolean",
					required: true
				},
				instructions: {
					type: "array",
					items: { type: "string" },
					required: true
				}
			},
			required: true
		}
	}
};
function renderValue(value, maxChars) {
	const text$1 = JSON.stringify(value, null, 2);
	return [{
		type: "text",
		text: text$1.length > maxChars ? `${text$1.slice(0, maxChars)}\n... result presentation truncated by dsh-geo ...` : text$1
	}];
}
function jsonResult(value) {
	return JSON.parse(JSON.stringify(value));
}
function contentHash(content) {
	return createHash("sha256").update(content, "utf8").digest("hex");
}
function versionKey(version) {
	return JSON.stringify(version) ?? String(version);
}
function diffView(path, content, title, oldText = null) {
	return {
		card: "diff",
		title,
		diffs: [{
			path,
			oldText,
			newText: content
		}],
		locations: [{ path }]
	};
}
function diffOldText(meta) {
	if (!meta || typeof meta !== "object" || !("oldText" in meta)) return null;
	const value = meta.oldText;
	return typeof value === "string" ? value : null;
}
function projectReport(result) {
	const { summary: summary$1 } = result;
	const priority = result.priorityFiles.length > 0 ? result.priorityFiles.map((file, index) => String(index + 1) + ". " + file.path + " - " + file.audit.scores.overall + "/100").join("\n") : "- No Markdown files were found.";
	const nextSteps = [
		result.priorityFiles.length > 0 ? `Start with ${result.priorityFiles[0].path}: run geo_audit_note, then preview one focused content change.` : "",
		summary$1.missingSources > 0 ? `Run geo_source_check on the ${summary$1.missingSources} note(s) without source URLs and add provenance before rewriting copy.` : "",
		summary$1.brokenLinks > 0 || summary$1.ambiguousLinks > 0 ? `Repair ${summary$1.brokenLinks} broken and ${summary$1.ambiguousLinks} ambiguous internal link(s) before relying on the vault as a knowledge graph.` : "",
		summary$1.staleNotes > 0 ? `Review the ${summary$1.staleNotes} stale note(s) and verify their claims before publishing new answers.` : ""
	].filter(Boolean);
	return [
		"# 生成式引擎优化项目报告 / Generative Engine Optimization Report",
		"",
		`- Root: \`${result.root}\``,
		`- Generated at: ${result.generatedAt}`,
		`- Rule version: ${result.ruleVersion}`,
		`- Scanned files: ${result.scannedFiles}`,
		`- Skipped files: ${result.skippedFiles}`,
		"",
		"## Score summary",
		"",
		`- SEO: ${summary$1.averageScores.seo}/100`,
		`- GEO: ${summary$1.averageScores.geo}/100`,
		`- AEO: ${summary$1.averageScores.aeo}/100`,
		`- Overall: ${summary$1.averageScores.overall}/100`,
		"",
		"## Governance signals",
		"",
		`- Missing metadata: ${summary$1.missingMetadata}`,
		`- Missing sources: ${summary$1.missingSources}`,
		`- Broken links: ${summary$1.brokenLinks}`,
		`- Ambiguous links: ${summary$1.ambiguousLinks}`,
		`- Orphan notes: ${summary$1.orphanNotes}`,
		`- Stale notes: ${summary$1.staleNotes}`,
		`- Duplicate titles: ${summary$1.duplicateTitles.length}`,
		"",
		"## Priority files",
		"",
		priority,
		"",
		"## Next steps",
		"",
		nextSteps.length > 0 ? nextSteps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "1. Run geo_audit_note on the note that matters most to the current user or business goal.",
		"",
		result.errors.length > 0 ? "## Scan warnings\n\n" + result.errors.map((error) => `- ${error}`).join("\n") : ""
	].filter(Boolean).join("\n");
}
function freshnessOf(updated) {
	if (!updated) return {
		status: "unknown",
		ageDays: 0,
		message: "No updated date was found."
	};
	const timestamp = Date.parse(updated);
	if (Number.isNaN(timestamp)) return {
		status: "unknown",
		ageDays: 0,
		message: `The updated value is not a valid date: ${updated}`
	};
	const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / (1440 * 60 * 1e3)));
	return ageDays > 180 ? {
		status: "stale",
		ageDays,
		message: `The note was updated ${ageDays} days ago.`
	} : {
		status: "fresh",
		ageDays,
		message: `The note was updated ${ageDays} days ago.`
	};
}
function fsFrom(ctx) {
	return ctx.fs;
}
function applyWorkflowContext(document, brief, goal, audience) {
	const contextNote = goal ? [`Business goal: ${goal}`] : [];
	return {
		...brief,
		source: document.source,
		intent: goal || brief.intent,
		audience: audience || brief.audience,
		nextActions: [...contextNote, ...brief.nextActions]
	};
}
function workflowStatus(document, keywordPlan, knowledgeErrors = []) {
	return document.truncated || keywordPlan.status !== "ready" || knowledgeErrors.length > 0 ? "partial" : "ready";
}
function resolveRootPath(config, requested) {
	const value = requested?.trim();
	if (!value) return config.defaultRoot ? resolve(config.defaultRoot) : resolve(".");
	if (!config.defaultRoot || isAbsolute(value)) return value;
	return resolve(config.defaultRoot, value);
}
/** Resolve workspace-relative tool paths against the configured knowledge-base root. */
function resolveScopedPath(config, requested) {
	const value = requested.trim();
	if (!config.defaultRoot || isAbsolute(value)) return value;
	return resolve(config.defaultRoot, value);
}
/** Use the preview-bound content when the caller omits the duplicate payload. */
function resolvePreviewContent(previewContent, requestedContent) {
	if (previewContent === void 0) throw new Error("Preview content is unavailable; generate a new preview before applying changes.");
	if (requestedContent !== void 0 && requestedContent !== previewContent) throw new Error("Content does not match the preview token.");
	return previewContent;
}
function focusAudit(note, focus, context) {
	const audit = auditNote(note, context);
	if (!focus || focus === "all") return {
		...audit,
		focus: "all"
	};
	const findings = audit.findings.filter((finding) => finding.pillar === focus);
	return {
		...audit,
		focus,
		findings,
		topActions: findings.sort((a, b) => b.scoreImpact - a.scoreImpact).slice(0, 5).map((finding) => `${finding.pillar.toUpperCase()}：${finding.recommendation}`)
	};
}
async function ensureInsideRoot(fs, config, targetPath, signal) {
	const scopedTarget = resolveScopedPath(config, targetPath);
	if (!config.defaultRoot) return scopedTarget;
	const root = await fs.resolve(config.defaultRoot, { signal });
	const target = await fs.resolve(scopedTarget, { signal });
	if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${targetPath}`);
	return scopedTarget;
}
async function readBacklinkRecords(fs, path, config, signal) {
	const scopedPath = await ensureInsideRoot(fs, config, path, signal);
	const target = await fs.resolve(scopedPath, { signal });
	const info = await fs.stat(target, signal);
	if (!info) return {
		path: scopedPath,
		target,
		entries: []
	};
	if (info.type !== "file") throw new Error(`Backlink record path is not a file: ${path}`);
	if (info.size !== void 0 && info.size > config.maxTextChars) throw new Error(`Backlink record exceeds maxTextChars (${config.maxTextChars}): ${path}`);
	return {
		path: scopedPath,
		target,
		info,
		entries: parseBacklinkRecordFile(await fs.readText(target, signal))
	};
}
async function readOptionalTextFile(fs, path, config, signal) {
	const scopedPath = await ensureInsideRoot(fs, config, path, signal);
	const target = await fs.resolve(scopedPath, { signal });
	const info = await fs.stat(target, signal);
	if (!info) return void 0;
	if (info.type !== "file") throw new Error(`Path is not a file: ${path}`);
	if (info.size !== void 0 && info.size > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars}): ${path}`);
	return {
		path: scopedPath,
		target,
		info,
		content: await fs.readText(target, signal)
	};
}
function parseJsonArray(content, path) {
	try {
		const parsed = JSON.parse(content);
		if (Array.isArray(parsed)) return parsed;
		if (parsed && typeof parsed === "object" && Array.isArray(parsed.keywords)) return parsed.keywords;
		throw new Error(`Expected a JSON array in ${path}.`);
	} catch (error) {
		throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
async function readKeywordFile(fs, path, config, signal) {
	const loaded = await readOptionalTextFile(fs, path, config, signal);
	if (!loaded) return {
		path: await ensureInsideRoot(fs, config, path, signal),
		target: await fs.resolve(await ensureInsideRoot(fs, config, path, signal), { signal }),
		items: []
	};
	const items = parseJsonArray(loaded.content, path).filter((value) => Boolean(value && typeof value === "object" && typeof value.term === "string"));
	return {
		...loaded,
		items
	};
}
function registerGeoTools(ctx, config) {
	const fs = fsFrom(ctx);
	const previews = /* @__PURE__ */ new Map();
	ctx.tools.register(defineTool({
		name: "geo_contract_wrap",
		description: "Normalize a GEO result or imported artifact into the shared six-plugin result envelope. This is a read-only contract adapter and does not validate the underlying analysis.",
		parameters: {
			resultJson: {
				type: "string",
				required: true,
				description: "JSON result or artifact to wrap."
			},
			artifactType: {
				type: "string",
				description: "Optional artifact type used in the lineage entry."
			},
			source: {
				type: "string",
				description: "Optional source path, URL or upstream plugin identifier."
			}
		},
		output: {
			schema: geoResultSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args) {
			let data;
			try {
				data = JSON.parse(args.resultJson);
			} catch (error) {
				throw new Error(`resultJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
			}
			const warnings = typeof data === "object" && data !== null && "warnings" in data && Array.isArray(data.warnings) ? data.warnings.filter((item) => typeof item === "string") : [];
			return geoResultEnvelope({
				data: jsonResult(attachArtifactMetadata(data, { staleAfterDays: 30 })),
				warnings,
				lineage: args.source ? [{
					source: args.source,
					...args.artifactType ? { fields: [`artifactType:${args.artifactType}`] } : {}
				}] : [],
				nextActions: ["保留原始结果和来源；下游插件只消费结构化字段，不把 SEO/GEO 分数直接当作业务结果。"]
			});
		}
	}));
	const prunePreviews = () => {
		const now = Date.now();
		for (const [token, preview] of previews) if (preview.expiresAt <= now) previews.delete(token);
	};
	const presentationMeta = (_args, value) => {
		if (!value || typeof value !== "object" || !("previewToken" in value)) return {
			path: "",
			oldText: null,
			newText: "",
			truncated: false
		};
		const token = value.previewToken;
		const preview = typeof token === "string" ? previews.get(token) : void 0;
		const maxDiffChars = 2e4;
		return {
			path: preview?.path || "",
			oldText: preview ? preview.oldContent.slice(0, maxDiffChars) : null,
			newText: preview ? preview.content.slice(0, maxDiffChars) : "",
			truncated: preview ? preview.oldContent.length > maxDiffChars || preview.content.length > maxDiffChars : false
		};
	};
	ctx.on("tools/pre-execute", async (exec, next) => {
		if (exec.name === "geo_apply_content") return {
			kind: "ask",
			reason: "This will replace a Markdown file. Review the diff and approve the guarded write."
		};
		return next();
	});
	ctx.tools.register(defineTool({
		name: "geo_setup_check",
		description: "Check whether the configured Markdown root is accessible and ready for a local SEO/GEO/AEO scan. Reads only.",
		parameters: { root: {
			type: "string",
			description: "Optional directory to check. Defaults to the configured knowledge-base root."
		} },
		output: {
			schema: setupOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const root = resolveRootPath(config, args.root);
			const checks = [];
			try {
				await ensureInsideRoot(fs, config, root, exec.signal);
				checks.push({
					id: "root-boundary",
					status: "pass",
					message: "The requested root is inside the configured defaultRoot."
				});
			} catch (error) {
				checks.push({
					id: "root-boundary",
					status: "fail",
					message: error instanceof Error ? error.message : String(error)
				});
				return {
					root,
					ready: false,
					markdownFiles: 0,
					checks,
					recommendations: ["Set defaultRoot to the intended Markdown knowledge-base directory, then run geo_setup_check again."]
				};
			}
			let markdownFiles = 0;
			try {
				const target = await fs.resolve(root, { signal: exec.signal });
				const info = await fs.stat(target, exec.signal);
				if (!info || info.type !== "directory") checks.push({
					id: "root-directory",
					status: "fail",
					message: "The configured root is not an accessible directory."
				});
				else {
					checks.push({
						id: "root-directory",
						status: "pass",
						message: "The configured root is an accessible directory."
					});
					markdownFiles = (await fs.listDir(target, exec.signal)).filter((entry) => entry.type === "file" && /\.md(?:own)?$/i.test(entry.name)).length;
					checks.push({
						id: "markdown-presence",
						status: markdownFiles > 0 ? "pass" : "warn",
						message: markdownFiles > 0 ? `Found ${markdownFiles} Markdown file(s) at the root.` : "No Markdown files were found at the root; nested files may still exist."
					});
				}
			} catch (error) {
				checks.push({
					id: "root-readable",
					status: "fail",
					message: error instanceof Error ? error.message : String(error)
				});
			}
			checks.push({
				id: "local-first",
				status: "pass",
				message: "Analysis uses the local Harness filesystem service and does not require GEO-PRO."
			});
			const ready = checks.every((check$1) => check$1.status !== "fail");
			return {
				root,
				ready,
				markdownFiles,
				checks,
				recommendations: ready ? ["Run geo_audit_note for one note or geo_audit_vault for the full knowledge base."] : ["Fix the failed checks before starting a vault scan."]
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_project_context",
		description: "Read or safely write the local SEO project context used as the default business, audience, market and brand background. It never sends the context to public search. Reads by default; writing only updates a JSON file inside defaultRoot.",
		parameters: {
			action: {
				type: "string",
				enum: ["read", "write"],
				required: true
			},
			path: {
				type: "string",
				description: `Optional JSON path; defaults to ${DEFAULT_PROJECT_CONTEXT_PATH}.`
			},
			context: {
				type: "object",
				additionalProperties: false,
				properties: {
					businessGoal: { type: "string" },
					audience: { type: "string" },
					language: { type: "string" },
					market: { type: "string" },
					brandName: { type: "string" },
					canonicalDomain: { type: "string" },
					brandTerms: {
						type: "array",
						items: { type: "string" }
					},
					competitors: {
						type: "array",
						items: { type: "string" }
					},
					keyPages: {
						type: "array",
						items: { type: "string" }
					},
					conversionGoals: {
						type: "array",
						items: { type: "string" }
					},
					constraints: {
						type: "array",
						items: { type: "string" }
					},
					sourceNotes: {
						type: "array",
						items: { type: "string" }
					}
				}
			}
		},
		output: {
			schema: projectContextResultSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const path = args.path?.trim() || DEFAULT_PROJECT_CONTEXT_PATH;
			const loaded = await readOptionalTextFile(fs, path, config, exec.signal);
			if (args.action === "read") {
				if (!loaded) return projectContextResult(path);
				return projectContextResult(path, parseProjectContext(loaded.content));
			}
			const context = createProjectContext(args.context || {});
			const target = loaded?.target || await fs.resolve(await ensureInsideRoot(fs, config, path, exec.signal), { signal: exec.signal });
			const expected = loaded?.info ? {
				kind: "replaceIfVersion",
				version: loaded.info.version
			} : { kind: "createIfAbsent" };
			await fs.writeText(target, JSON.stringify(context, null, 2) + "\n", expected, exec.signal);
			return projectContextResult(path, context);
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_keyword_import",
		description: "Import user-provided keyword opportunities from CSV, JSON or a Markdown table into a local JSON opportunity file. It preserves qualitative/unknown boundaries and never invents volume or difficulty.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "JSON path inside defaultRoot, for example seo/keyword-opportunities.json."
			},
			data: {
				type: "string",
				required: true,
				description: "CSV, JSON array/object with keywords, or Markdown table. Supported fields include term, intent, volume, difficulty, country, targetPage, cluster and status."
			},
			source: {
				type: "string",
				description: "Source label such as Search Console export, Ads export or manual research."
			}
		},
		output: {
			schema: keywordImportSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			if (args.data.length > config.maxTextChars) throw new Error(`Keyword import exceeds maxTextChars (${config.maxTextChars}).`);
			const loaded = await readKeywordFile(fs, args.path, config, exec.signal);
			const imported = importKeywordData(loaded.path, loaded.items, args.data, args.source?.trim() || "manual-import");
			const content = JSON.stringify(imported.items, null, 2) + "\n";
			if (content.length > config.maxTextChars) throw new Error(`Keyword opportunity file exceeds maxTextChars (${config.maxTextChars}). Split the import into focused files.`);
			const expected = loaded.info ? {
				kind: "replaceIfVersion",
				version: loaded.info.version
			} : { kind: "createIfAbsent" };
			await fs.writeText(loaded.target, content, expected, exec.signal);
			return imported.result;
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_keyword_opportunities",
		description: "Build a keyword opportunity map from a local imported JSON file: clusters, target-page mapping, unassigned terms and cannibalization risks. Reads only.",
		parameters: { path: {
			type: "string",
			required: true,
			description: "JSON opportunity file inside defaultRoot."
		} },
		output: {
			schema: keywordOpportunityMapSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const loaded = await readKeywordFile(fs, args.path, config, exec.signal);
			return buildKeywordOpportunityMap(loaded.path, loaded.items);
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_coach",
		description: "Route a manual SEO/GEO/AEO project to its next useful action by checking project context, source, keyword map and effect evidence. It is a lightweight SOP guide, not an approval or role workflow.",
		parameters: {
			source: {
				type: "string",
				description: "Optional public URL or local Markdown/HTML snapshot already chosen for this cycle."
			},
			projectContextPath: {
				type: "string",
				description: `Optional context path; defaults to ${DEFAULT_PROJECT_CONTEXT_PATH}.`
			},
			keywordPath: {
				type: "string",
				description: "Optional local keyword opportunity JSON path."
			},
			effectDataProvided: {
				type: "boolean",
				description: "Set true when same-scope before/after performance data is ready for geo_effect_review."
			},
			backlinkPath: {
				type: "string",
				description: "Optional local backlink campaign JSON path."
			},
			includeBacklink: {
				type: "boolean",
				description: "Optional; if true, recommend the manual backlink branch after effect review."
			}
		},
		output: {
			schema: coachSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const projectContextPath = args.projectContextPath?.trim() || DEFAULT_PROJECT_CONTEXT_PATH;
			const contextFile = await readOptionalTextFile(fs, projectContextPath, config, exec.signal);
			const contextStatus = projectContextResult(projectContextPath, contextFile ? parseProjectContext(contextFile.content) : void 0);
			const inputs = [{
				name: "project-context",
				status: contextStatus.status === "ready" ? "present" : contextStatus.status === "partial" ? "partial" : "missing",
				path: projectContextPath,
				note: contextStatus.missingFields.length > 0 ? `缺少：${contextStatus.missingFields.join("、")}` : "业务目标、受众和市场背景已就绪。"
			}, {
				name: "source",
				status: args.source?.trim() ? "present" : "missing",
				note: args.source?.trim() ? "已有本轮分析来源。" : "尚未指定公开 URL 或本地快照。"
			}];
			if (contextStatus.status !== "ready") return {
				currentStep: "project-context",
				status: "blocked",
				reason: "先补齐项目上下文，后续关键词和内容优先级才有业务边界。",
				inputs,
				nextActions: contextStatus.nextActions,
				suggestedPrompt: `请运行 geo_project_context action=write，填写 businessGoal、audience、language、market、brandName 和 canonicalDomain；路径使用 ${projectContextPath}。`
			};
			if (!args.source?.trim()) return {
				currentStep: "source",
				status: "blocked",
				reason: "没有来源就无法建立页面基线。",
				inputs,
				nextActions: ["选择公开 URL；若页面需要登录或 JavaScript，先导出 Markdown/HTML 放到 defaultRoot。", "然后运行 geo_workflow，保持只读。"],
				suggestedPrompt: "请运行 geo_workflow，来源是 <公开URL或defaultRoot内的快照路径>，使用 project context 作为默认目标背景，不写文件。"
			};
			const keywordPath = args.keywordPath?.trim();
			if (!keywordPath) return {
				currentStep: "keyword-import",
				status: "ready",
				reason: "项目上下文和来源已具备，但还没有独立关键词机会库。",
				inputs: [...inputs, {
					name: "keyword-opportunities",
					status: "missing",
					note: "未提供本地关键词 JSON 文件。"
				}],
				nextActions: ["导入 Search Console、Ads、关键词工具或人工研究结果；缺失字段保持空白。"],
				suggestedPrompt: "请运行 geo_keyword_import，将我的 CSV/JSON/Markdown 关键词数据写入 seo/keyword-opportunities.json，然后运行 geo_keyword_opportunities。"
			};
			const keywordFile = await readKeywordFile(fs, keywordPath, config, exec.signal);
			const map = buildKeywordOpportunityMap(keywordFile.path, keywordFile.items);
			inputs.push({
				name: "keyword-opportunities",
				status: keywordFile.items.length > 0 ? "present" : "missing",
				path: keywordFile.path,
				note: `${keywordFile.items.length} 个关键词机会。`
			});
			if (keywordFile.items.length === 0) return {
				currentStep: "keyword-import",
				status: "ready",
				reason: "关键词文件存在但没有可用机会项。",
				inputs,
				nextActions: ["导入至少一组带 term/keyword 的数据；不要用模型估算搜索量。"],
				suggestedPrompt: `请运行 geo_keyword_import，path=${keywordPath}，导入已核实的关键词数据。`
			};
			if (map.cannibalization.length > 0 || map.unassigned.length > 0) return {
				currentStep: "keyword-map",
				status: "ready",
				reason: map.cannibalization.length > 0 ? "发现关键词蚕食，需要先分配主页面。" : "仍有关键词没有目标页面，需要完成页面映射。",
				inputs,
				nextActions: map.nextActions,
				suggestedPrompt: `请运行 geo_keyword_opportunities，path=${keywordPath}，根据结果为每个高优先级词指定唯一目标页面；先解决蚕食，再生产新内容。`
			};
			if (!args.effectDataProvided) return {
				currentStep: "effect-review",
				status: "ready",
				reason: "关键词已经映射，但本轮还没有同口径前后效果数据。",
				inputs,
				nextActions: ["从 Search Console/站点分析导出同页面、同地区/设备和相邻周期的指标。", "把查询级 rows 一并传给 geo_effect_review，以识别第二页、低 CTR、未收录和蚕食机会。"],
				suggestedPrompt: "请运行 geo_effect_review，提供 baseline、current 和 query/page 级 rows；不要把一次变化归因于单一动作。"
			};
			if (args.includeBacklink && !args.backlinkPath?.trim()) return {
				currentStep: "backlink-plan",
				status: "ready",
				reason: "内容和效果复盘完成，可以选择相关的手动产品发现/外链分发。",
				inputs: [...inputs, {
					name: "backlink-campaign",
					status: "missing",
					note: "未提供外链记录文件；这不是必需项。"
				}],
				nextActions: ["仅选择真正相关的资源，先运行 geo_backlink_plan 做预检。", "用户在平台原生页面手动完成后，用 geo_backlink_record 记录真实结果。"],
				suggestedPrompt: "请运行 geo_backlink_plan，先做质量筛选和匿名预检，不提交表单；完成平台动作后再记录结果。"
			};
			return {
				currentStep: "next-diagnosis",
				status: "complete",
				reason: "当前周期输入齐全，可以回到页面诊断并选择下一项最高影响动作。",
				inputs,
				nextActions: ["运行 geo_workflow 或 geo_audit_note，围绕效果复盘中最高优先级机会做一次小范围改动。", "改动先 geo_preview_content，再写回并重新审计；下一周期保持相同数据口径。"],
				suggestedPrompt: `请对 ${args.source.trim()} 运行 geo_workflow，结合 project context 和已映射关键词，只处理本周期最高优先级问题，并返回新的验证清单。`
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_workflow",
		description: "Run the complete SEO/GEO/AEO workflow from one public URL or one local Markdown/HTML snapshot: diagnose, build a qualitative keyword plan, create a content-production brief, and return safe write-back instructions. Reads only.",
		parameters: {
			source: {
				type: "string",
				required: true,
				description: "Public http(s) URL, local Markdown path, or local HTML export/snapshot from a public or private account page."
			},
			goal: {
				type: "string",
				description: "Optional business or user goal, such as leads, product education, documentation discovery or support deflection."
			},
			audience: {
				type: "string",
				description: "Optional target audience to use in the production brief."
			},
			projectContextPath: {
				type: "string",
				description: `Optional local context JSON path; defaults to ${DEFAULT_PROJECT_CONTEXT_PATH}.`
			},
			keywordPath: {
				type: "string",
				description: "Optional local imported keyword opportunity JSON path. When supplied, its clusters and page mapping are included in productionPlan.contentInputs."
			},
			seedKeywords: {
				type: "array",
				items: { type: "string" },
				description: "Optional terms supplied by the user; the first term becomes the primary query."
			},
			useKnowledgeBase: {
				type: "boolean",
				description: "Optional; defaults to true and uses local Markdown titles, headings, entities, queries and bounded excerpts as private context for related terms and content inputs."
			},
			knowledgeMaxFiles: {
				type: "integer",
				description: "Optional local knowledge-base scan cap; never exceeds configured maxFiles."
			}
		},
		output: {
			schema: workflowOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const source = args.source.trim();
			if (!source) throw new Error("source is required: pass a public URL or a local Markdown/HTML snapshot path.");
			const projectContextPath = args.projectContextPath?.trim() || DEFAULT_PROJECT_CONTEXT_PATH;
			const projectContextFile = await readOptionalTextFile(fs, projectContextPath, config, exec.signal);
			const projectContext = projectContextFile ? parseProjectContext(projectContextFile.content) : void 0;
			const contextResult = projectContextResult(projectContextPath, projectContext);
			const keywordOpportunityFile = args.keywordPath?.trim() ? await readKeywordFile(fs, args.keywordPath.trim(), config, exec.signal) : void 0;
			const keywordOpportunities = keywordOpportunityFile ? buildKeywordOpportunityMap(keywordOpportunityFile.path, keywordOpportunityFile.items) : void 0;
			const effectiveGoal = args.goal?.trim() || projectContext?.businessGoal || void 0;
			const effectiveAudience = args.audience?.trim() || projectContext?.audience || void 0;
			let document;
			if (isPublicUrl(source)) document = await fetchPublicDocument(ctx.web, source, config, exec.signal);
			else {
				const path = await ensureInsideRoot(fs, config, source, exec.signal);
				if (!/\.(?:md|mdown|html?)$/i.test(path)) throw new Error("Local workflow sources must be .md, .mdown, .html or .htm. Export a private/public account page to Markdown or HTML first.");
				document = await readLocalDocument(fs, path, config, exec.signal);
			}
			const audit = focusAudit(document.note, "all", {
				sourceType: document.sourceType,
				finalUrl: document.finalUrl
			});
			const knowledgeEnabled = args.useKnowledgeBase !== false;
			let knowledgeNotes = [];
			let knowledgeSkippedFiles = 0;
			let knowledgeErrors = [];
			if (knowledgeEnabled) try {
				const knowledgeRoot = resolveRootPath(config);
				await ensureInsideRoot(fs, config, knowledgeRoot, exec.signal);
				const scan = await scanVault(fs, knowledgeRoot, {
					...config,
					maxFiles: Math.min(config.maxFiles, Math.max(1, args.knowledgeMaxFiles || config.maxFiles))
				}, exec.signal);
				knowledgeNotes = scan.files;
				knowledgeSkippedFiles = scan.skippedFiles;
				knowledgeErrors = scan.errors;
			} catch (error) {
				knowledgeErrors = [error instanceof Error ? error.message : String(error)];
			}
			const keywordPlan = await buildKeywordPlan(document.note, audit, isPublicUrl(source) ? ctx.web : void 0, args.seedKeywords || [], exec.signal, knowledgeNotes, audit.seoStandard);
			const contentBrief = applyWorkflowContext(document, createContentBrief(document.note, audit), effectiveGoal, effectiveAudience);
			const productionPlan = buildProductionPlan(contentBrief, audit, keywordPlan, keywordOpportunities);
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
				brief: contentBrief
			});
			const localFile = document.sourceType !== "public-url";
			return {
				source,
				sourceType: document.sourceType,
				status: workflowStatus(document, keywordPlan, knowledgeErrors),
				access: {
					mode: isPublicUrl(source) ? "public-url" : "local-file",
					credentialsUsed: false,
					limitation: isPublicUrl(source) ? "Anonymous public retrieval only. JavaScript-rendered or logged-in pages should be exported as Markdown/HTML and passed as a local snapshot." : document.accessNote
				},
				capture: {
					finalUrl: document.finalUrl,
					statusCode: document.statusCode,
					bodyKind: document.bodyKind,
					capturedAt: document.capturedAt,
					truncated: document.truncated,
					note: document.accessNote
				},
				knowledgeBase: {
					enabled: knowledgeEnabled,
					scannedFiles: knowledgeNotes.length,
					skippedFiles: knowledgeSkippedFiles,
					relatedNotes: keywordPlan.knowledgeSignals,
					errors: knowledgeErrors,
					privacy: "Knowledge-base context stays inside the Harness filesystem. Its titles, headings, entities, queries and bounded excerpts are not sent to public search; only explicit user seedKeywords may be used for URL search signals."
				},
				projectContext: contextResult,
				audit,
				sop,
				keywordPlan,
				...keywordOpportunities ? { keywordOpportunities } : {},
				contentBrief,
				productionPlan,
				writeback: {
					canPreviewExistingFile: localFile,
					canCreateNewFile: true,
					instructions: localFile ? [
						"Generate the complete Markdown draft from productionPlan, then preview it against the local source path.",
						"For a new destination, call geo_preview_content with createIfMissing=true; all destinations remain inside defaultRoot.",
						"Apply only after reviewing the diff; geo_apply_content uses a short-lived token and a version guard."
					] : [
						"The URL itself is read-only. Generate the draft, save/export it to a local Markdown destination, then preview that destination with geo_preview_content.",
						"For a private page, keep the exported HTML/Markdown inside defaultRoot; no cookies or credentials are passed to dsh-geo.",
						"Apply only after reviewing the diff; geo_apply_content uses a short-lived token and a version guard."
					]
				}
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_backlink_plan",
		description: "Build a quality-gated, manual backlink and product-discovery plan from the bundled candidate catalog or user-supplied URLs. It can anonymously preflight public pages, but it never logs in, submits forms, bypasses CAPTCHA, or changes external sites.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Verified public product or company name."
			},
			productUrl: {
				type: "string",
				required: true,
				description: "Verified canonical public product URL."
			},
			description: {
				type: "string",
				required: true,
				description: "Verified product description used to prepare submission copy; do not include invented claims."
			},
			mode: {
				type: "string",
				enum: ["quality", "batch"],
				description: "quality checks at most 10 candidates per plan; batch can prepare a larger user-supplied queue."
			},
			route: {
				type: "string",
				enum: [
					"product-directory",
					"startup-directory",
					"developer-community",
					"software-directory",
					"other"
				],
				description: "Optional route filter."
			},
			resourceUrls: {
				type: "array",
				items: { type: "string" },
				description: "Optional candidate URLs. If omitted, use the bundled catalog adapted from backlink_skills."
			},
			maxCandidates: {
				type: "integer",
				description: "Optional candidate cap. Quality mode is capped at 10."
			},
			verifyResources: {
				type: "boolean",
				description: "Optional; defaults to true and performs anonymous read-only HTTP preflight."
			}
		},
		output: {
			schema: backlinkPlanSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const baseInput = {
				productName: args.productName.trim(),
				productUrl: args.productUrl.trim(),
				description: args.description.trim(),
				mode: args.mode,
				route: args.route,
				resourceUrls: args.resourceUrls,
				maxCandidates: args.maxCandidates
			};
			if (!baseInput.productName || !baseInput.productUrl || !baseInput.description) throw new Error("productName, productUrl and verified description are required.");
			let plan = buildBacklinkPlan(baseInput);
			if (args.verifyResources !== false) {
				const preflights = [];
				for (const candidate of plan.candidates) try {
					const result = await ctx.web.fetch({ url: candidate.normalizedUrl }, exec.signal);
					preflights.push(extractPreflight(result, `匿名只读预检完成：HTTP ${result.statusCode}。这不是平台提交结果。`, candidate.normalizedUrl));
				} catch (error) {
					preflights.push({
						url: candidate.normalizedUrl,
						note: `匿名只读预检失败：${error instanceof Error ? error.message : String(error)}。请在浏览器中人工核验，不要直接提交。`
					});
				}
				plan = buildBacklinkPlan({
					...baseInput,
					preflights
				});
			}
			return plan;
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_backlink_record",
		description: "Record a user-completed backlink or product-directory action in a local JSON campaign file. This does not submit forms or access credentials; it prevents ambiguous outcomes from being retried and keeps a manual audit trail.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "JSON record path inside defaultRoot, for example backlinks/campaign.json."
			},
			productUrl: {
				type: "string",
				required: true,
				description: "Canonical product URL used to derive the idempotency key."
			},
			resourceUrl: {
				type: "string",
				required: true,
				description: "The candidate resource or submission route URL."
			},
			status: {
				type: "string",
				enum: [
					"not-attempted",
					"manual-required",
					"submitted",
					"awaiting-email-verification",
					"awaiting-approval",
					"published",
					"outcome-unknown",
					"failed",
					"ineligible",
					"unavailable"
				],
				required: true
			},
			evidence: {
				type: "array",
				items: { type: "string" },
				description: "Short, non-sensitive evidence such as a public listing URL, visible receipt text, or an opaque screenshot reference."
			},
			publicUrl: {
				type: "string",
				description: "Public listing URL after publication, if available."
			},
			anchorText: {
				type: "string",
				description: "Actual public anchor text, if visible."
			},
			linkRel: {
				type: "string",
				description: "Actual rel attribute, if visible; do not request a preferred link attribute."
			},
			note: {
				type: "string",
				description: "Short factual note. Do not include passwords, cookies, OTPs, raw email addresses or session URLs."
			}
		},
		output: {
			schema: backlinkRecordResultSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const loaded = await readBacklinkRecords(fs, args.path, config, exec.signal);
			const entry = normalizeBacklinkRecord({
				productUrl: args.productUrl,
				resourceUrl: args.resourceUrl,
				status: args.status,
				evidence: args.evidence,
				publicUrl: args.publicUrl,
				anchorText: args.anchorText,
				linkRel: args.linkRel,
				note: args.note
			});
			const recorded = recordBacklinkEntry(loaded.entries, entry);
			recorded.result.path = loaded.path;
			if (recorded.result.changed) {
				const content = JSON.stringify(recorded.entries, null, 2) + "\n";
				if (content.length > config.maxTextChars) throw new Error(`Backlink record exceeds maxTextChars (${config.maxTextChars}). Use a new campaign file or archive old records.`);
				const expected = loaded.info ? {
					kind: "replaceIfVersion",
					version: loaded.info.version
				} : { kind: "createIfAbsent" };
				await fs.writeText(loaded.target, content, expected, exec.signal);
			}
			return recorded.result;
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_backlink_audit",
		description: "Audit a local backlink campaign record and return manual follow-up items, terminal outcomes and data-quality errors. Reads only.",
		parameters: { path: {
			type: "string",
			required: true,
			description: "JSON record path inside defaultRoot."
		} },
		output: {
			schema: backlinkAuditSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const loaded = await readBacklinkRecords(fs, args.path, config, exec.signal);
			const summary$1 = summarizeBacklinkRecords(loaded.entries);
			return {
				path: loaded.path,
				total: summary$1.total,
				counts: [
					"not-attempted",
					"manual-required",
					"submitted",
					"awaiting-email-verification",
					"awaiting-approval",
					"published",
					"outcome-unknown",
					"failed",
					"ineligible",
					"unavailable"
				].map((status) => ({
					status,
					count: summary$1.byStatus[status]
				})),
				published: summary$1.published.map((entry) => entry.publicUrl || entry.resourceUrl),
				needsFollowUp: summary$1.needsFollowUp.map((entry) => entry.idempotencyKey),
				errors: summary$1.errors,
				nextActions: [
					...summary$1.needsFollowUp.length > 0 ? ["先核对提交回执、邮箱和公开页面，再更新 pending 或 outcome-unknown 记录。"] : [],
					...summary$1.published.length > 0 ? ["把公开条目、推荐访问和转化纳入下一轮手动效果评估。"] : [],
					...summary$1.errors.length > 0 ? ["修复重复 idempotencyKey 或非法状态后再继续提交。"] : [],
					...summary$1.total === 0 ? ["先运行 geo_backlink_plan，再在用户完成真实平台动作后记录结果。"] : []
				]
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_effect_review",
		description: "Compare two manually supplied SEO, site-analytics or referral snapshots and return a cautious effect review plus the next diagnosis action. Reads only; it does not connect to external analytics accounts or invent missing metrics.",
		parameters: {
			target: {
				type: "string",
				required: true,
				description: "Page, campaign or product being evaluated."
			},
			baseline: {
				type: "object",
				additionalProperties: false,
				properties: {
					period: {
						type: "string",
						required: true,
						description: "Baseline period, using the same timezone and device/region scope as current."
					},
					source: {
						type: "string",
						required: true,
						description: "Data source, such as Search Console export or site analytics."
					},
					impressions: { type: "number" },
					clicks: { type: "number" },
					ctrPercent: {
						type: "number",
						description: "CTR as percentage points, for example 2.4 means 2.4%."
					},
					averagePosition: { type: "number" },
					conversions: { type: "number" },
					indexedPages: { type: "number" },
					referralVisits: { type: "number" },
					referralConversions: { type: "number" }
				},
				required: true
			},
			current: {
				type: "object",
				additionalProperties: false,
				properties: {
					period: {
						type: "string",
						required: true
					},
					source: {
						type: "string",
						required: true
					},
					impressions: { type: "number" },
					clicks: { type: "number" },
					ctrPercent: { type: "number" },
					averagePosition: { type: "number" },
					conversions: { type: "number" },
					indexedPages: { type: "number" },
					referralVisits: { type: "number" },
					referralConversions: { type: "number" }
				},
				required: true
			},
			rows: {
				type: "array",
				description: "Optional query/page-level rows from the same reporting scope. Used only to route second-page, low-CTR, indexing and cannibalization opportunities.",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						query: { type: "string" },
						page: { type: "string" },
						impressions: { type: "number" },
						clicks: { type: "number" },
						ctrPercent: { type: "number" },
						averagePosition: { type: "number" },
						indexed: { type: "boolean" },
						indexNote: { type: "string" }
					}
				}
			}
		},
		output: {
			schema: effectReviewSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args) {
			if (!args.target.trim() || !args.baseline.period.trim() || !args.current.period.trim()) throw new Error("target, baseline.period and current.period are required.");
			return buildEffectReview({
				target: args.target.trim(),
				baseline: args.baseline,
				current: args.current,
				rows: args.rows
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_competitor_gap",
		description: "Compare user-supplied target and competitor keyword/topic/page inventories to identify research gaps. Reads only; it does not scrape competitor sites or infer traffic and rankings.",
		parameters: {
			target: {
				type: "object",
				additionalProperties: false,
				properties: {
					keywords: {
						type: "array",
						items: { type: "string" }
					},
					topics: {
						type: "array",
						items: { type: "string" }
					},
					pages: {
						type: "array",
						items: { type: "string" }
					}
				},
				required: true
			},
			competitors: {
				type: "array",
				required: true,
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						name: {
							type: "string",
							required: true
						},
						url: { type: "string" },
						keywords: {
							type: "array",
							items: { type: "string" }
						},
						topics: {
							type: "array",
							items: { type: "string" }
						},
						pages: {
							type: "array",
							items: { type: "string" }
						},
						notes: { type: "string" }
					}
				}
			}
		},
		output: {
			schema: researchJsonSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args) {
			return jsonResult(buildCompetitorGap({
				target: args.target,
				competitors: args.competitors
			}));
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_backlink_profile",
		description: "Review user-supplied backlink CSV/JSON rows for broken, lost, nofollow/sponsored/ugc, risky and competitor-gap signals. Reads only and does not judge links by quantity alone.",
		parameters: {
			rows: {
				type: "array",
				required: true,
				description: "Rows with sourceUrl and optional targetUrl, referringDomain, nofollow, sponsored, ugc, broken, lost, spamScore.",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						sourceUrl: {
							type: "string",
							required: true
						},
						targetUrl: { type: "string" },
						referringDomain: { type: "string" },
						anchor: { type: "string" },
						nofollow: { type: "boolean" },
						sponsored: { type: "boolean" },
						ugc: { type: "boolean" },
						broken: { type: "boolean" },
						lost: { type: "boolean" },
						spamScore: { type: "number" },
						competitor: { type: "string" },
						capturedAt: { type: "string" }
					}
				}
			},
			competitorRows: {
				type: "array",
				description: "Optional competitor backlink rows in the same shape, used only for referring-domain gap hints.",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						sourceUrl: {
							type: "string",
							required: true
						},
						referringDomain: { type: "string" }
					}
				}
			}
		},
		output: {
			schema: researchJsonSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args) {
			const rows = parseBacklinkProfileRows(args.rows);
			const competitorRows = parseBacklinkProfileRows(args.competitorRows || []);
			if (rows.length === 0) throw new Error("At least one backlink row with sourceUrl is required.");
			return jsonResult(buildBacklinkProfile(rows, competitorRows));
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_site_audit",
		description: "Run a bounded, same-origin, anonymous HTML audit from a public URL. It checks page-level title, description, canonical, robots, H1, links, image alt and structured-data signals; it does not crawl private areas or claim Lighthouse/Search Console results.",
		parameters: {
			startUrl: {
				type: "string",
				required: true,
				description: "Public http(s) start URL."
			},
			maxPages: {
				type: "integer",
				description: "Optional cap, never above 50; defaults to 10."
			},
			maxDepth: {
				type: "integer",
				description: "Optional same-origin link depth, 0-2; defaults to 1."
			}
		},
		output: {
			schema: researchJsonSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const startUrl = args.startUrl.trim();
			if (!isPublicUrl(startUrl)) throw new Error("geo_site_audit requires a public http(s) URL.");
			const maxPages = Math.min(50, Math.max(1, args.maxPages ?? 10));
			const maxDepth = Math.min(2, Math.max(0, args.maxDepth ?? 1));
			const origin = new URL(startUrl).origin;
			const queue = [{
				url: startUrl,
				depth: 0
			}];
			const queued = new Set([startUrl]);
			const visited = /* @__PURE__ */ new Set();
			const pages = [];
			const skippedLinks = [];
			while (queue.length > 0 && pages.length < maxPages) {
				const next = queue.shift();
				if (!next || visited.has(next.url)) continue;
				visited.add(next.url);
				try {
					const result = await ctx.web.fetch({ url: next.url }, exec.signal);
					const html = result.body.content;
					const isHtml = result.body.kind === "html";
					const technical = isHtml ? extractTechnicalSeo(html, result.url) : void 0;
					pages.push(buildSiteAuditPage({
						url: next.url,
						finalUrl: result.url,
						statusCode: result.statusCode,
						html: isHtml ? html : "",
						technical,
						truncated: result.truncated
					}));
					if (isHtml && next.depth < maxDepth && result.statusCode >= 200 && result.statusCode < 400) {
						const discovered = sameOriginLinks(html, result.url);
						skippedLinks.push(...discovered.skipped);
						for (const link of discovered.links) try {
							if (new URL(link).origin !== origin || queued.has(link)) continue;
							queued.add(link);
							queue.push({
								url: link,
								depth: next.depth + 1
							});
						} catch {
							skippedLinks.push(link);
						}
					}
				} catch (error) {
					skippedLinks.push(`${next.url}：${error instanceof Error ? error.message : String(error)}`);
				}
			}
			return jsonResult(buildSiteAuditResult({
				startUrl,
				pages,
				skippedLinks,
				maxPages,
				depth: maxDepth
			}));
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_prompt_review",
		description: "Review manually captured answer-engine prompts across models for brand mention and citation evidence. Reads only; it does not scrape model interfaces or claim universal AI visibility.",
		parameters: { runs: {
			type: "array",
			required: true,
			description: "Manual records with prompt, model, capturedAt, answer, citedUrls and optional brandMentioned.",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					prompt: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					},
					capturedAt: {
						type: "string",
						required: true
					},
					answer: {
						type: "string",
						required: true
					},
					citedUrls: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					brandMentioned: { type: "boolean" }
				}
			}
		} },
		output: {
			schema: researchJsonSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args) {
			if (args.runs.length === 0) throw new Error("At least one manually captured prompt run is required.");
			return jsonResult(buildPromptReview(args.runs));
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_project_report",
		description: "Create a structured, shareable project report for the Markdown knowledge base. Reads only.",
		parameters: {
			root: {
				type: "string",
				description: "Optional directory. Defaults to the configured knowledge-base root."
			},
			maxFiles: {
				type: "integer",
				description: "Optional scan cap; never exceeds configured maxFiles."
			}
		},
		output: {
			schema: reportOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const root = resolveRootPath(config, args.root);
			await ensureInsideRoot(fs, config, root, exec.signal);
			const result = summarizeVault(root, await scanVault(fs, root, {
				...config,
				maxFiles: Math.min(config.maxFiles, Math.max(1, args.maxFiles || config.maxFiles))
			}, exec.signal));
			return {
				...result,
				reportMarkdown: projectReport(result)
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_audit_note",
		description: "Audit one Markdown note for explainable SEO, GEO and AEO readiness. Reads only; does not change files.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Absolute or workspace-relative Markdown path."
			},
			focus: {
				type: "string",
				enum: [
					"seo",
					"geo",
					"aeo",
					"all"
				],
				description: "Optional focus: seo, geo, aeo, or all."
			}
		},
		output: {
			schema: auditOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			return focusAudit(await readNote(fs, await ensureInsideRoot(fs, config, args.path, exec.signal), config, exec.signal), args.focus);
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_audit_vault",
		description: "Scan a Markdown knowledge base and report metadata, link, source, orphan and SEO/GEO/AEO health. Reads only.",
		parameters: {
			root: {
				type: "string",
				description: "Optional directory. Defaults to the configured knowledge-base root."
			},
			maxFiles: {
				type: "number",
				description: "Optional scan cap; never exceeds configured maxFiles."
			}
		},
		output: {
			schema: vaultOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const root = resolveRootPath(config, args.root);
			await ensureInsideRoot(fs, config, root, exec.signal);
			return summarizeVault(root, await scanVault(fs, root, {
				...config,
				maxFiles: Math.min(config.maxFiles, Math.max(1, args.maxFiles || config.maxFiles))
			}, exec.signal));
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_content_brief",
		description: "Create a structured content brief from a Markdown note, including query, intent, audience, outline, questions and source gaps.",
		parameters: { path: {
			type: "string",
			required: true,
			description: "Markdown note path."
		} },
		output: {
			schema: briefOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const note = await readNote(fs, await ensureInsideRoot(fs, config, args.path, exec.signal), config, exec.signal);
			return createContentBrief(note, auditNote(note));
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_source_check",
		description: "Check source URLs, provenance fields, freshness metadata and source gaps in one Markdown note.",
		parameters: { path: {
			type: "string",
			required: true,
			description: "Markdown note path."
		} },
		output: {
			schema: sourceOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars)
		},
		async execute(args, exec) {
			const note = await readNote(fs, await ensureInsideRoot(fs, config, args.path, exec.signal), config, exec.signal);
			const sourceFields = Object.entries(note.frontmatter).filter(([key]) => /source|citation|reference|url/i.test(key)).map(([key, value]) => ({
				key,
				value: typeof value === "string" ? value : JSON.stringify(value) ?? String(value)
			}));
			const updated = typeof note.frontmatter.updated === "string" ? note.frontmatter.updated : "";
			const freshness = freshnessOf(updated);
			const sourceGaps = [
				...note.sourceUrls.length === 0 ? ["Add at least one primary source URL."] : [],
				...!updated ? ["Add an updated date in frontmatter."] : [],
				...freshness.status === "unknown" && updated ? ["Use an ISO-compatible updated date so freshness can be checked."] : []
			];
			return {
				path: note.path,
				sourceUrls: note.sourceUrls,
				sourceFields,
				updated,
				hasSources: note.sourceUrls.length > 0,
				freshness,
				sourceGaps,
				recommendations: sourceGaps.length > 0 ? sourceGaps : freshness.status === "stale" ? ["Refresh stale sources and record the review date before publishing."] : ["Confirm every key claim maps to a source, and distinguish facts, opinions and inferences."]
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_preview_content",
		description: "Preview a complete Markdown replacement and return a short-lived token for a later guarded apply. Never changes files.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Markdown file to update."
			},
			content: {
				type: "string",
				required: true,
				description: "Complete replacement Markdown content."
			},
			createIfMissing: {
				type: "boolean",
				description: "Set true to preview creating a new Markdown file. Defaults to false."
			}
		},
		output: {
			schema: previewOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars),
			presentationMeta
		},
		presentCall(args) {
			return diffView(args.path, args.content, `Preview changes: ${args.path}`);
		},
		presentResult(args, result) {
			if (result.isError) return {
				card: "generic",
				title: `Preview failed: ${args.path}`,
				content: result.content
			};
			return diffView(args.path, args.content, `Preview ready: ${args.path}`, diffOldText(result.meta));
		},
		async execute(args, exec) {
			const path = await ensureInsideRoot(fs, config, args.path, exec.signal);
			const target = await fs.resolve(path, { signal: exec.signal });
			const info = await fs.stat(target, exec.signal);
			if (info && info.type !== "file") throw new Error(`Target is not a file: ${args.path}`);
			if (!info && !args.createIfMissing) throw new Error(`File not found: ${args.path}. Set createIfMissing=true to preview a new Markdown file.`);
			if (!/\.(?:md|mdown)$/i.test(path)) throw new Error("Only .md and .mdown destinations can be previewed.");
			if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`);
			const current = info ? await fs.readText(target, exec.signal) : "";
			const token = randomBytes(18).toString("hex");
			const oldHash = contentHash(current);
			const newHash = contentHash(args.content);
			const expiresAt = Date.now() + 600 * 1e3;
			prunePreviews();
			previews.set(token, {
				path,
				content: args.content,
				oldContent: current,
				version: info?.version,
				created: !info,
				oldHash,
				newHash,
				expiresAt,
				used: false
			});
			return {
				status: "preview-only",
				path,
				previewToken: token,
				created: !info,
				oldHash,
				newHash,
				expiresAt: new Date(expiresAt).toISOString(),
				changed: args.content !== current,
				applied: false,
				guarded: true
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_growth_measurement_plan",
		description: "Create a measurable GEO-to-growth handoff for one content or search asset. It defines the target metric and window but never claims causality.",
		parameters: {
			contentId: {
				type: "string",
				required: true,
				description: "Stable content, page or asset ID."
			},
			channel: {
				type: "string",
				required: true,
				description: "Channel such as organic-search, ai-answer, referral or directory."
			},
			targetMetric: {
				type: "string",
				required: true,
				description: "Metric to observe, such as qualifiedSignup, activation or paidConversion."
			},
			query: {
				type: "string",
				description: "Primary query or topic."
			},
			audience: {
				type: "string",
				description: "Target audience or segment."
			},
			publishAt: {
				type: "string",
				required: true,
				description: "ISO timestamp or date when the asset became observable."
			},
			baselineWindow: {
				type: "string",
				required: true,
				description: "Baseline window, for example 2026-07-01/2026-07-31."
			},
			source: {
				type: "string",
				description: "Source note, URL or content brief."
			}
		},
		output: {
			schema: geoResultSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars),
			presentationMeta
		},
		async execute(args) {
			const plan = attachArtifactMetadata({
				artifactType: "geo-growth-measurement-plan",
				handoffFrom: "dsh-geo",
				handoffTo: "dsh-growth",
				generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				contentId: args.contentId.trim(),
				channel: args.channel.trim(),
				targetMetric: args.targetMetric.trim(),
				...args.query?.trim() ? { query: args.query.trim() } : {},
				...args.audience?.trim() ? { audience: args.audience.trim() } : {},
				publishAt: args.publishAt.trim(),
				baselineWindow: args.baselineWindow.trim(),
				...args.source?.trim() ? { source: args.source.trim() } : {},
				warnings: ["此计划只建立可观测关系；没有实验设计或对照组时，不得宣称因果。"],
				nextActions: ["在增长数据中用相同 contentId/channel 记录观察窗口，再交给 growth_attribution_review。"]
			}, { staleAfterDays: 90 });
			return geoResultEnvelope({
				data: jsonResult(plan),
				lineage: args.source?.trim() ? [{ source: args.source.trim() }] : [],
				nextActions: plan.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_handoff_receive",
		description: "Receive a supported upstream artifact with integrity, routing and evidence checks. Produce an owned, dated receipt for one initiative; acceptance is not approval or task completion. Read-only.",
		parameters: handoffParameters,
		output: {
			schema: geoResultSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars),
			presentationMeta
		},
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const receipt = receiveHandoff(JSON.parse(args.artifactJson), args);
			return geoResultEnvelope({
				data: jsonResult(attachArtifactMetadata(receipt, { staleAfterDays: 30 })),
				warnings: receipt.warnings,
				nextActions: receipt.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_artifact_review",
		description: "Validate a GEO/SEO/AEO artifact before using it as a growth input. Checks schema, stable ID and freshness without changing files.",
		parameters: {
			artifactJson: {
				type: "string",
				required: true,
				description: "JSON returned by a plugin tool."
			},
			expectedType: {
				type: "string",
				description: "Optional expected artifactType."
			}
		},
		output: {
			schema: geoResultSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars),
			presentationMeta
		},
		async execute(args) {
			let value;
			try {
				value = JSON.parse(args.artifactJson);
			} catch (error) {
				throw new Error(`artifactJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
			}
			const review = reviewArtifact(typeof value === "object" && value !== null && "data" in value ? value.data : value, args.expectedType?.trim() || void 0);
			return geoResultEnvelope({
				data: jsonResult({
					artifactType: "geo-artifact-review",
					generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
					...review
				}),
				nextActions: review.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "geo_apply_content",
		description: "Apply a previously previewed Markdown replacement after explicit approval. Requires a valid preview token, can reuse its bound content when content is omitted, and refuses stale files.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Markdown file to update."
			},
			content: {
				type: "string",
				description: "Optional exact content returned for the preview. Omit it to reuse the content bound to previewToken."
			},
			previewToken: {
				type: "string",
				required: true,
				description: "Short-lived token returned by geo_preview_content."
			}
		},
		output: {
			schema: applyOutputSchema,
			render: (_args, value) => renderValue(value, config.maxResultChars),
			presentationMeta
		},
		presentCall(args) {
			const preview = previews.get(args.previewToken);
			const content = typeof args.content === "string" ? args.content : preview?.content || "";
			return diffView(args.path, content, `Apply changes: ${args.path}`, preview?.oldContent.slice(0, 2e4) || null);
		},
		presentResult(args, result) {
			if (result.isError) return {
				card: "generic",
				title: `Apply blocked: ${args.path}`,
				content: result.content
			};
			const preview = previews.get(args.previewToken);
			const content = typeof args.content === "string" ? args.content : preview?.content || "";
			return diffView(args.path, content, `Applied changes: ${args.path}`, diffOldText(result.meta));
		},
		async execute(args, exec) {
			const path = await ensureInsideRoot(fs, config, args.path, exec.signal);
			prunePreviews();
			const preview = previews.get(args.previewToken);
			if (!preview || preview.path !== path || preview.used) throw new Error("Preview token is missing, expired, already used, or belongs to another path.");
			const content = resolvePreviewContent(preview.content, args.content);
			const target = await fs.resolve(path, { signal: exec.signal });
			const info = await fs.stat(target, exec.signal);
			if (preview.created) {
				if (info) throw new Error("The destination appeared after preview; generate a new preview before creating it.");
				await fs.writeText(target, content, { kind: "createIfAbsent" }, exec.signal);
			} else {
				if (!info || info.type !== "file") throw new Error(`File not found: ${args.path}`);
				if (contentHash(await fs.readText(target, exec.signal)) !== preview.oldHash || versionKey(info.version) !== versionKey(preview.version)) throw new Error("File changed after preview; generate a new preview before applying changes.");
				await fs.writeText(target, content, {
					kind: "replaceIfVersion",
					version: preview.version
				}, exec.signal);
			}
			preview.used = true;
			let audit;
			try {
				audit = await appendArtifactAudit(fs, config.defaultRoot, {
					action: "apply",
					path,
					beforeHash: preview.oldHash,
					afterHash: contentHash(content),
					approved: true
				}, exec.signal);
			} catch (error) {
				audit = {
					status: "audit-failed",
					warning: error instanceof Error ? error.message : String(error)
				};
			}
			return {
				status: "applied",
				path,
				previewToken: args.previewToken,
				created: preview.created,
				oldHash: preview.oldHash,
				newHash: preview.newHash,
				changed: true,
				applied: true,
				guarded: true,
				audit
			};
		}
	}));
}

//#endregion
//#region src/index.ts
const name = "dsh-geo";
const inject = [
	"tools",
	"fs",
	"web"
];
const Config = Schema.object({
	defaultRoot: Schema.string().default("."),
	maxFiles: Schema.number().step(1).min(1).max(5e3).default(500),
	maxFileBytes: Schema.number().step(1).min(1024).max(10485760).default(1048576),
	maxTextChars: Schema.number().step(1).min(1e3).max(1e6).default(18e4),
	maxResultChars: Schema.number().step(1).min(1e3).max(2e5).default(5e4)
});
function apply(ctx, config) {
	registerGeoTools(ctx, config);
	console.log(`[${name}] registered SEO/GEO/AEO tools for ${config.defaultRoot}`);
}

//#endregion
export { Config, apply, inject, name };