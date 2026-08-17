# 生成式引擎优化

> **Language / 语言:** **English** · [中文](./README.zh.md)

`dsh-geo` is a DeepSeek Harness bundle that gives the agent explainable SEO, GEO and AEO tools for Markdown knowledge bases.

> Technical package ID: `dsh-geo` · DeepSeek Harness plugin for SEO, GEO and AEO

## What it does

- Audit one Markdown note for SEO, GEO and AEO readiness.
- Scan a vault for metadata gaps, missing sources, broken knowledge structure, orphan notes and duplicate titles.
- Check the configured root before scanning and create a shareable project report.
- Build a content brief with query, intent, audience, outline, questions and source gaps.
- Run the complete workflow from a public website URL, public account URL, Markdown export or HTML snapshot.
- Build a qualitative keyword plan from source signals, optional seed terms and Harness web search results; it never invents search volume.
- Turn the diagnosis into a four-stage production plan: diagnose, map keywords, draft, and verify.
- Check source provenance and freshness fields.
- Preview or apply a complete Markdown replacement, including safe creation of a new note inside `defaultRoot`.

The plugin is local-first. Core analysis runs through the Harness filesystem service. Public URLs use the official anonymous `ctx.web` fetch seam; cookies and credentials are never used. Private or JavaScript-rendered pages should be exported as Markdown/HTML and analyzed as a local snapshot.

## User and business pain points

Teams publishing content for both search engines and AI answer engines commonly face these problems:

- Traditional SEO checks focus on keywords and metadata, but do not explain whether an answer engine can understand, trust and cite the content.
- Enterprise knowledge bases accumulate missing sources, stale notes, duplicate titles and orphan pages, making content quality difficult to govern at scale.
- Writers, subject-matter experts and SEO teams use different review standards, so content decisions are slow and hard to reproduce.
- Content optimization is often disconnected from the original Markdown source, creating manual copy-paste work and a risk of overwriting newer edits.
- Teams may not be able to send private product, customer or internal knowledge-base content to an external GEO/SEO service.

This plugin turns those needs into explainable, local-first checks with evidence, scores, priorities and guarded content updates.

## Typical application scenarios

- **Pre-publication review:** Check a new article, product page or technical note for SEO, GEO and AEO readiness before release.
- **Knowledge-base governance:** Scan a team or enterprise Markdown vault to find missing metadata, weak provenance, stale content, orphan notes and duplicate titles.
- **Content planning:** Convert a topic or existing note into a brief with audience, intent, outline, questions and source gaps.
- **Product and technical documentation:** Improve documentation discoverability while preserving source context and review history.
- **Agency and multi-brand operations:** Apply a consistent, auditable review framework across clients, sites or content teams without sharing the source vault with a third-party service.

## Included tools

| Tool | Purpose |
|---|---|
| `geo_setup_check` | Verify root access and scan readiness |
| `geo_audit_note` | Audit one Markdown note |
| `geo_audit_vault` | Scan a knowledge base |
| `geo_project_report` | Create a structured project report |
| `geo_workflow` | Run URL/snapshot diagnosis, keyword planning and content production planning |
| `geo_content_brief` | Generate a structured content brief |
| `geo_source_check` | Check citations and provenance |
| `geo_preview_content` | Preview a complete Markdown replacement |
| `geo_apply_content` | Apply an approved, version-guarded replacement |

## Install from npm

```bash
dsh plugin --profile default add dsh-geo
```

## Install from GitHub

```bash
dsh plugin --profile default add github:winyh/dsh-geo
```

The package builds itself after a GitHub source install. For reproducible deployments, pin the command to a reviewed commit, for example `github:winyh/dsh-geo#<commit>`.

## GitHub discoverability

Publish this directory as a public repository and add the repository topic `dsh-plugin`. The package metadata already includes `dsh-plugin`; the GitHub topic is what makes the repository appear in the Harness plugin topic listing.

## Usage

You do not need to memorize tool names. Describe the goal, source and desired output in natural language; the examples below are copy-and-paste starting points.

### Start here: a five-minute first run

You need only:

1. DeepSeek Harness installed and available as the `dsh` command.
2. One input: a public URL, an exported Markdown/HTML page, or a Markdown knowledge-base root.
3. A goal and audience if you want recommendations tailored to a business outcome.

Follow this first-run sequence:

1. Install the plugin.
2. Set `defaultRoot` in the `dsh-geo` Bundle configuration. It is the only directory the plugin can read or write.
3. Start or restart Harness with `dsh web`.
4. Ask for a readiness check.
5. Run `geo_workflow` on one page and keep the first run read-only.

Minimal Bundle configuration:

```yaml
defaultRoot: "<your-knowledge-base-root>"
```

If you do not have a knowledge base yet, use a public URL first. For a private page, export it as Markdown or HTML and put that file under `defaultRoot`; no platform login is needed by this plugin.

### Choose the right entry point

| What you have | Start with | What to ask for |
|---|---|---|
| Public website or public account URL | `geo_workflow` | Full SEO/GEO/AEO diagnosis and production plan |
| JavaScript-rendered or private page | Export Markdown/HTML, then `geo_workflow` | Analyze the local snapshot without uploading its terms |
| One existing Markdown note | `geo_audit_note` or `geo_workflow` | Find evidence-backed issues and the top actions |
| A whole Markdown knowledge base | `geo_audit_vault` or `geo_project_report` | Find governance gaps and prioritize files |
| A planned article or rewrite | `geo_content_brief` | Turn a topic into intent, outline, questions and source gaps |
| A proposed content change | `geo_preview_content` first | Review the diff, then explicitly apply it |

### The complete operating method

Use this order for a professional SEO/GEO/AEO job:

0. Define the business goal, target audience, language/region and desired next action.
1. Connect the source: public URL, exported snapshot or local Markdown.
2. Establish a baseline: inspect SEO, GEO, AEO, provenance, freshness and internal links.
3. Build a keyword and intent map: assign one primary query, supporting topics, question terms and entities to page sections.
4. Create the content brief and information architecture: direct answer, outline, FAQs, sources and next action.
5. Produce or revise content while preserving factual claims and source context.
6. Verify structure, citations, links, answerability and unknown data.
7. Preview the Markdown diff, explicitly confirm, apply the guarded write, and re-audit the current file.

The plugin does not invent search volume, ranking difficulty or traffic. Treat `qualitative` as topic signals from public search and `seed-only` as a privacy-preserving plan based on the supplied source and seed terms.

### Understand the result

`geo_workflow` returns a single structured result. Read it in this order:

| Field | Meaning | What to do next |
|---|---|---|
| `sourceType` | `public-url`, `local-markdown` or `private-snapshot` | Confirm the source was interpreted correctly |
| `status` | Whether the workflow completed | If not `success`, fix the access or input issue first |
| `audit` | SEO/GEO/AEO scores, evidence and findings | Start with high-impact findings supported by evidence |
| `keywordPlan` | Primary, secondary, question and entity terms | Map each term to one useful section; do not stuff keywords |
| `contentBrief` | Audience, intent, outline, FAQs and source gaps | Use it as the writing specification |
| `productionPlan` | Diagnose, map keywords, draft and verify stages | Complete stages in order and record unknowns |
| `writeback` | Read-only/preview/apply status | Preview and inspect the diff before any file change |

### Copy-paste prompts

First installation check:

```text
Check whether the configured dsh-geo root is readable and ready for a Markdown scan. Do not modify files.
```

Public URL, full read-only workflow:

```text
Run geo_workflow for https://example.com.
Goal: increase qualified product-education traffic.
Audience: first-time evaluators.
Seed keywords: product education, product trial.
Return the SEO/GEO/AEO diagnosis, qualitative keyword map, content brief and four-stage production plan. Do not write files.
```

Private or JavaScript-rendered page exported locally:

```text
Run geo_workflow for snapshots/account-home.html.
Treat this as a private-page snapshot. Goal: make the profile easier to discover, understand and cite.
Audience: potential customers. Return the diagnosis, keyword map, brief and verification checklist. Do not write files.
```

Existing note:

```text
Audit notes/launch.md for SEO, GEO and AEO. Show the score, evidence, unknowns and the five highest-impact actions. Do not edit the file.
```

Whole knowledge base:

```text
Scan the configured knowledge base. Prioritize missing sources, stale notes, orphan notes, broken or ambiguous links, duplicate titles and the ten lowest overall scores. Do not modify files.
```

Create a content plan:

```text
Create a content brief for notes/product.md.
Goal: help first-time evaluators decide whether to try the product.
Audience: non-technical buyers.
Include one primary query, supporting topics, question terms, entities, a direct answer, outline, FAQs, source gaps and a next action.
```

Preview and apply safely:

```text
Audit notes/launch.md, fix only the three highest-impact evidence-backed issues, preserve factual claims and useful internal links, then show a complete Markdown diff. Do not write until I explicitly confirm.
```

For a new draft, add `createIfMissing=true` to the preview request and choose a new `.md` path inside `defaultRoot`. After reviewing the diff, explicitly ask to apply that preview. After writing, run the audit again and compare the result with the original findings.

### Installation details and local development

Set the knowledge-base root in the Bundle configuration, then start DeepSeek Harness:

```bash
dsh web
```

For local development, build first and install the local directory from its parent folder:

```bash
pnpm install
pnpm run build
dsh plugin --profile default add ./dsh-geo
```

### Detailed request patterns

The recommended entry point for a real SEO project is `geo_workflow`. It keeps diagnosis, keyword adjustment and content production in one result instead of making you guess which tool to call next.

Analyze a public website or public account page:

```text
Run geo_workflow for https://example.com. Goal: increase qualified product education traffic. Audience: first-time evaluators. Return the SEO/GEO/AEO diagnosis, qualitative keyword plan and a complete Markdown production plan. Do not write files.
```

Analyze a public or private account page after export:

```text
Run geo_workflow for snapshots/account-home.html. Treat it as a private-page snapshot. Goal: make the profile easier to discover and quote. Return the diagnosis, keyword mapping, content brief and verification checklist. Do not write files.
```

The source boundary is deliberate:

- Public `http(s)` URLs are fetched anonymously through Harness `ctx.web`.
- Public pages that require JavaScript rendering should be saved/exported as Markdown or HTML first.
- Private account pages are supported through a local Markdown/HTML snapshot; browser cookies and platform credentials do not enter the plugin.
- Local Markdown/HTML inputs do not send extracted terms to public search; their keyword plan stays `seed-only` unless you explicitly provide external keyword data yourself.
- Search results provide qualitative topic signals only. Search volume, ranking difficulty and traffic require a separate data source and are not fabricated by this plugin.

Start with a readiness check when installing into a new environment:

```text
Check whether the configured knowledge-base root is ready for a local scan.
```

```text
Audit this Markdown note for SEO, GEO and AEO. Show scores, evidence and the top five actions.
```

```text
Scan my knowledge base and list notes with missing sources, orphan links and the lowest overall scores.
```

```text
Create a project report with average SEO, GEO and AEO scores, governance gaps and priority files.
```

```text
Create a content brief from this note, including audience, intent, outline, questions and source gaps.
```

```text
Run the complete workflow for https://example.com, use "product education" as the seed keyword, and generate a draft plan without writing anything.
```

Use `focus=seo`, `focus=geo` or `focus=aeo` when you only want one assessment pillar.

### Writeback safety

Content changes are preview-only by default. A reliable first-use loop is:

1. Ask for an audit of one note and select one or two high-impact findings.
2. Ask the agent to rewrite only that note while preserving factual claims, sources and useful local links.
3. Ask for a preview and review the diff, not just the score.
4. Explicitly confirm the preview. Harness asks for approval again before the write.
5. Apply the preview. The agent can use `path` + `previewToken`; repeating the full Markdown `content` is optional because the token already binds the exact preview.

The write operation uses a version guard and refuses to overwrite a file changed after the preview. If that happens, audit the current file and create a new preview instead of forcing the old change through. To save a draft as a new note, use `createIfMissing=true` on `geo_preview_content`; the destination must still be inside `defaultRoot`.

For a practical first request, use:

```text
Check the configured root, audit notes/launch.md, fix only the three highest-impact issues, show a diff, and wait for my approval before writing anything.
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The plugin or tools are not recognized | Harness loaded an older bundle | Reinstall the plugin from the same source and restart `dsh web` |
| `geo_setup_check` cannot read the root | `defaultRoot` is missing, wrong or outside the allowed workspace | Correct the Bundle config, then restart Harness |
| A public page is empty or incomplete | The page needs JavaScript, login or a blocked request | Export the visible page as Markdown/HTML and analyze the local snapshot |
| A private URL cannot be fetched directly | The plugin intentionally does not use browser cookies or credentials | Save/export the page under `defaultRoot` and pass the local path |
| `keywordPlan.dataQuality` is `seed-only` | The source is local, so extracted terms were not sent to public search | Provide your own seed terms or separate external keyword data; this status is expected for private content |
| A write is refused after preview | The file changed after the preview or the token/path no longer matches | Read the current file, create a new preview and review the new diff |
| The result says HTTP non-2xx or source unavailable | The URL is unavailable to anonymous access | Check the URL or use an exported snapshot |
| A file is too large or the scan is capped | `maxTextChars`, `maxFileBytes` or `maxFiles` was reached | Split the source or raise the relevant limit deliberately |

After changing the source code, rebuild and reinstall the same local source so Harness loads the new bundle. If a command is not recognized in your Harness release, run `dsh plugin --help`; the plugin does not change other Harness profiles or repositories.

## Configure

The bundle ships with these defaults:

```yaml
defaultRoot: "<your-knowledge-base-root>"
maxFiles: 500
maxFileBytes: 1048576
maxTextChars: 180000
maxResultChars: 50000
```

Tool paths may be absolute or workspace-relative. Relative paths resolve under `defaultRoot`, and every read or write is checked against that boundary.

## Example prompts

```text
请审计一篇 GEO.md，分别给出 SEO、GEO、AEO 的问题和优先级。
```

```text
扫描我的知识库，找出来源缺失、孤立笔记和综合评分最低的 10 个文件。
```

```text
先预览对 GEO.md 的优化结果；只有我明确确认后，才应用修改。
```

## Development

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

The plugin follows the DeepSeek Harness Cordis model: it exports `apply(ctx)`, injects `tools`, `fs` and `web`, and registers model-facing tools through the normal tool pipeline. Core scoring and file analysis are self-contained; public URL retrieval uses the official Harness web capability and does not require GEO-PRO.

DeepSeek Harness is currently a developer preview, so the plugin pins the current release-candidate peer range and should be tested against the Harness version used for deployment.

## Images and contact

The following images are included from the project-level `img` folder and are intentionally displayed in this README:

### 微信联系

![微信联系二维码](./img/wechat.png)

### 微信支付

![微信支付二维码](./img/wepay.jpg)

Contact: [2712192471@qq.com](mailto:2712192471@qq.com)

## License

MIT. See [LICENSE](./LICENSE).
