# 生成式引擎优化

`dsh-geo` is a DeepSeek Harness bundle that gives the agent explainable SEO, GEO and AEO tools for Markdown knowledge bases.

> Technical package ID: `dsh-geo` · DeepSeek Harness plugin for SEO, GEO and AEO

## What it does

- Audit one Markdown note for SEO, GEO and AEO readiness.
- Scan a vault for metadata gaps, missing sources, broken knowledge structure, orphan notes and duplicate titles.
- Build a content brief with query, intent, audience, outline, questions and source gaps.
- Check source provenance and freshness fields.
- Preview or apply a complete Markdown replacement with a stale-version guard.

The plugin is local-first. It analyzes files through the Harness filesystem service and does not upload knowledge-base content.

## Included tools

| Tool | Purpose |
|---|---|
| `geo_audit_note` | Audit one Markdown note |
| `geo_audit_vault` | Scan a knowledge base |
| `geo_content_brief` | Generate a structured content brief |
| `geo_source_check` | Check citations and provenance |
| `geo_apply_content` | Preview or guarded-write Markdown |

## Install from npm

```bash
dsh plugin --profile default add dsh-geo
```

## Install from GitHub

```bash
dsh plugin --profile default add github:YOUR_GITHUB_USERNAME/dsh-geo
```

For a source checkout, the Harness developer preview requires the package build to be available during installation. Pin a release or commit when installing from GitHub.

## GitHub discoverability

Publish this directory as a public repository and add the repository topic `dsh-plugin`. The package metadata already includes `dsh-plugin`; the GitHub topic is what makes the repository appear in the Harness plugin topic listing.

## Usage

### 1. Configure and start Harness

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

### 2. Ask with natural language

```text
Audit this Markdown note for SEO, GEO and AEO. Show scores, evidence and the top five actions.
```

```text
Scan my knowledge base and list notes with missing sources, orphan links and the lowest overall scores.
```

```text
Create a content brief from this note, including audience, intent, outline, questions and source gaps.
```

Use `focus=seo`, `focus=geo` or `focus=aeo` when you only want one assessment pillar.

### 3. Preview before writing

Content changes are preview-only by default. Ask for a preview first, review the complete replacement, then explicitly confirm before applying it. The write operation uses a version guard and refuses to overwrite a file changed after the preview.

## Configure

The bundle ships with these defaults:

```yaml
defaultRoot: "<your-knowledge-base-root>"
maxFiles: 500
maxFileBytes: 1048576
maxTextChars: 180000
maxResultChars: 50000
```

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

The plugin follows the DeepSeek Harness Cordis model: it exports `apply(ctx)`, injects `tools` and `fs`, and registers model-facing tools through the normal tool pipeline. Its core capabilities are self-contained and do not require an external GEO/SEO service.

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
