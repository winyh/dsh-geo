# 生成式引擎优化

> **语言 / Language:** **中文** · [English](./README.md)

`dsh-geo` 是“生成式引擎优化” DeepSeek Harness Bundle，为 Markdown 知识库提供可解释的 SEO、GEO 和 AEO 工具。

## 功能

- 审计单个 Markdown 笔记的 SEO、GEO、AEO 准备度。
- 扫描知识库中的元数据缺失、来源缺失、孤立笔记和重复标题。
- 在扫描前检查根目录是否可访问，并生成可交付的项目报告。
- 生成内容 Brief：主题、关键词、意图、受众、大纲、用户问题和来源缺口。
- 支持从公开网站 URL、公开账号主页 URL、Markdown 导出文件或 HTML 快照启动完整流程。
- 根据来源信号、用户提供的种子词和 Harness 搜索结果生成定性关键词计划，不虚构搜索量。
- 将诊断结果落成四阶段内容生产计划：诊断、关键词映射、写作、验证。
- 检查引用来源、来源字段和更新时间。
- 将当前来源映射到 Google 搜索要素清单：以用户为中心的内容、主题词、标题/描述、可抓取链接、HTTPS、canonical/robots 信号、结构化数据、图片 alt 和移动端 viewport。
- 将本地知识库中的相关标题、小标题、实体和主查询作为私有的关键词与内容输入维度。
- 先显示 diff，再使用版本保护安全写回 Markdown；也支持在根目录内安全创建新笔记。
- 核心分析在本地完成，公开 URL 通过 Harness 官方 `ctx.web` 能力读取，不依赖 GEO-PRO。

插件采用本地优先策略，不会使用 Cookie 或账号凭据。私有账号主页和需要 JavaScript 渲染的页面，请先导出为 Markdown/HTML 快照，再放入 `defaultRoot` 内分析。

## 标准 SEO 辅助范围

内置标准参考 [Google 搜索要素](https://developers.google.com/search/docs/essentials?hl=zh-cn)、[SEO 入门指南](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=zh-cn) 和 [网站 SEO 维护指南](https://developers.google.com/search/docs/fundamentals/get-started?hl=zh-cn)。它是一套可执行检查清单，不是排名保证。

一次 `geo_workflow` 会组合四个维度：

1. **来源证据：** 页面或 Markdown 笔记的主题、意图、事实、标题、链接和来源链路。
2. **沉淀知识库：** `defaultRoot` 中相关笔记的标题、小标题、实体、主查询和受限长度的本地摘录；这些内容留在本地。
3. **关键词信号：** 用户种子词、来源信号，以及公开 URL 可匿名搜索时得到的搜索结果标题/摘要定性信号。
4. **SEO 规范：** 内容、抓取/索引、搜索结果呈现、链接、媒体和监控检查。

返回结果中的 `productionPlan.contentInputs` 会在写作前明确列出这四类输入。Harness 模型据此生产 Markdown 草稿，再通过 `geo_preview_content` 和 `geo_apply_content` 完成可审阅的写回闭环。

如果来源无法证明部署级事实，插件会明确返回 `unknown`，不会把本地 Markdown 当成已上线网页。插件不能替代 Search Console、PageSpeed、完整公开站点爬虫或付费关键词工具；Sitemap 覆盖、收录状态、查询/点击、核心网页指标和服务器级 robots 行为，需要发布后用对应外部工具验证。

## 工具

| 工具 | 用途 |
|---|---|
| `geo_setup_check` | 检查根目录和扫描准备状态 |
| `geo_audit_note` | 审计单个 Markdown 笔记 |
| `geo_audit_vault` | 扫描整个知识库 |
| `geo_project_report` | 生成结构化项目报告 |
| `geo_workflow` | 从 URL/快照完成 Google 标准检查、私有知识库关键词规划和内容生产规划 |
| `geo_content_brief` | 生成内容 Brief |
| `geo_source_check` | 检查引用和来源可信度 |
| `geo_preview_content` | 预览完整 Markdown 替换 |
| `geo_apply_content` | 应用已审批且版本安全的修改 |

## 用户与企业痛点

面向搜索引擎和 AI 答案引擎发布内容时，用户、内容团队和企业通常会遇到以下问题：

- 传统 SEO 检查偏重关键词和元数据，无法解释内容是否容易被答案引擎理解、信任和引用。
- 企业知识库长期积累后，容易出现来源缺失、内容过期、标题重复和孤立笔记，难以统一治理。
- 写作者、领域专家和 SEO 团队的审核标准不一致，导致发布慢、返工多，判断也难以复用。
- 内容优化与原始 Markdown 文件脱节，人工复制粘贴成本高，还可能覆盖他人刚更新的内容。
- 产品、客户或内部知识库通常具有隐私要求，不适合直接发送到外部 GEO/SEO 服务。

本插件把这些需求转化为可解释、可追溯的本地检查：给出证据、评分、优先级和安全的内容更新建议。

## 典型应用场景

- **发布前审计：** 新文章、产品页面或技术笔记上线前，检查 SEO、GEO 和 AEO 准备度。
- **知识库治理：** 扫描团队或企业 Markdown 知识库，定位元数据缺失、来源薄弱、内容过期、孤立笔记和重复标题。
- **内容规划：** 根据主题或已有笔记生成内容 Brief，明确受众、意图、大纲、用户问题和来源缺口。
- **产品与技术文档：** 提高文档的搜索和答案引擎可发现性，同时保留原始上下文与审核记录。
- **代理商与多品牌运营：** 为不同客户、站点或内容团队提供统一、可审计的审核框架，不必把源知识库交给第三方服务。

## 安装

```bash
dsh plugin --profile default add dsh-geo
```

也可以从 GitHub 安装：

```bash
dsh plugin --profile default add github:winyh/dsh-geo
```

从 GitHub 源码安装后，插件会自动构建。生产环境建议锁定已审核的 commit，例如 `github:winyh/dsh-geo#<commit>`，避免后续推送改变实际安装内容。

## GitHub 搜索

将本目录发布为公开仓库，并在仓库 Topics 中添加 `dsh-plugin`。npm 元数据已经包含该关键词；GitHub 仓库 Topic 才能让项目出现在 Harness 插件主题列表中。

## 使用方法

不需要记住工具名称。直接用自然语言说明“分析什么、目标是什么、希望得到什么结果”即可；下面的请求都可以直接复制使用。

### 从零开始：5 分钟完成第一次使用

你只需要准备：

1. 已安装 DeepSeek Harness，并且可以运行 `dsh` 命令。
2. 一种输入：公开 URL、导出的 Markdown/HTML 页面，或现有 Markdown 知识库。
3. 可选的业务目标和目标受众；填写后建议会更贴近实际业务。

第一次使用按这个顺序操作：

1. 安装插件。
2. 在 `dsh-geo` Bundle 配置中设置 `defaultRoot`，这是插件允许读写的唯一目录。
3. 执行 `dsh web` 启动或重启 Harness。
4. 先发送“检查根目录”的请求。
5. 对一篇内容运行 `geo_workflow`，第一次保持只读，不要直接写文件。

最小配置如下：

```yaml
defaultRoot: "<your-knowledge-base-root>"
```

如果还没有知识库，可以先分析公开 URL。若要分析私有页面，请先把页面导出为 Markdown 或 HTML，放到 `defaultRoot` 内；插件不需要平台登录，也不会读取浏览器 Cookie。

### 先判断：你应该从哪里开始

| 你手里有什么 | 推荐入口 | 你可以怎么说 |
|---|---|---|
| 公开网站或公开账号主页 URL | `geo_workflow` | 做完整 SEO/GEO/AEO 诊断和内容生产规划 |
| 需要登录或依赖 JavaScript 的页面 | 导出 Markdown/HTML，再用 `geo_workflow` | 分析本地快照，不上传快照中的词 |
| 一篇已有 Markdown 笔记 | `geo_audit_note` 或 `geo_workflow` | 找出有证据的问题和最高优先级行动 |
| 整个 Markdown 知识库 | `geo_audit_vault` 或 `geo_project_report` | 找治理缺口并排出优先处理文件 |
| 还没有成稿，只有主题或旧内容 | `geo_content_brief` | 生成意图、结构、问题和来源缺口 |
| 已经有一版修改方案 | 先用 `geo_preview_content` | 先审阅 diff，再明确要求写回 |

### 完整 SEO/GEO/AEO 执行流程

专业项目建议按下面顺序执行，不要一上来就改文章：

0. 明确业务目标、目标受众、语言/地区和页面希望用户完成的下一步动作。
1. 接入来源：公开 URL、导出快照或本地 Markdown。
2. 做基线诊断：检查 SEO、GEO、AEO、来源、更新时间、内部链接和知识结构。
3. 建立关键词与意图地图：确定一个主查询，再把次级主题、问题词和实体分配到具体章节。
4. 生成内容 Brief 和信息架构：直接答案、大纲、FAQ、来源缺口和下一步行动。
5. 生产或重写内容：保留事实、来源和有价值的内部链接。
6. 验证结构、引用、链接、可回答性和仍未确认的未知项。
7. 预览 Markdown diff，明确确认后安全写回，再重新审计当前文件。

插件不会编造搜索量、排名难度或流量。`qualitative` 表示公开搜索提供了定性主题信号；`seed-only` 表示基于本地来源和种子词完成规划，同时为了隐私没有把本地内容词发送到公开搜索。

### 如何读懂结果

`geo_workflow` 会把来源、诊断、关键词、Brief、生产计划和写回状态放在一个结果里。建议按下面顺序阅读：

| 字段 | 含义 | 下一步 |
|---|---|---|
| `sourceType` | `public-url`、`local-markdown` 或 `private-snapshot` | 确认插件识别的来源类型正确 |
| `status` | 流程是否完成 | 不是 `success` 时，先处理访问或输入问题 |
| `audit` | SEO/GEO/AEO 分数、证据和发现项 | 先处理有证据支持且影响最大的发现 |
| `keywordPlan` | 主查询、次级主题、问题词和实体 | 把词分配到有用章节，不要机械堆词 |
| `contentBrief` | 受众、意图、大纲、FAQ 和来源缺口 | 把它当作写作规格，而不是直接发布的成稿 |
| `productionPlan` | 诊断、关键词映射、写作、验证四阶段 | 按顺序执行，并记录未知项 |
| `writeback` | 只读、预览或写回状态 | 任何改动都先看 diff |

### 可直接复制的请求

首次安装检查：

```text
检查当前 dsh-geo 根目录是否可读取、是否可以开始 Markdown 扫描。不要修改文件。
```

公开 URL 的完整只读流程：

```text
请对 https://example.com 执行 geo_workflow。
目标：提升产品教育类的有效访问。
受众：第一次评估产品的人。
种子关键词：产品教育、产品试用。
返回 SEO/GEO/AEO 诊断、定性关键词地图、内容 Brief 和四阶段生产计划。不要写入文件。
```

私有或需要 JavaScript 的页面导出后分析：

```text
请对 snapshots/account-home.html 执行 geo_workflow。
这是私有账号主页的本地快照。目标：让主页更容易被发现、理解和引用。
受众：潜在客户。返回诊断、关键词地图、内容 Brief 和验证清单。不要写入文件。
```

审计已有笔记：

```text
请审计 notes/launch.md 的 SEO、GEO 和 AEO。给出分数、证据、未知项和影响最大的五项行动。不要编辑文件。
```

扫描整个知识库：

```text
扫描当前知识库，优先列出来源缺失、内容过期、孤立笔记、断链或歧义链接、重复标题，以及综合分数最低的十个文件。不要修改文件。
```

生成内容规划：

```text
请为 notes/product.md 生成内容 Brief。
目标：帮助第一次评估产品的人判断是否值得试用。
受众：非技术决策者。
请包含一个主查询、次级主题、问题词、实体、直接答案、大纲、FAQ、来源缺口和下一步行动。
```

预览并安全优化：

```text
请审计 notes/launch.md，只修复三个影响最大且有证据支持的问题，保留事实、来源和有价值的内部链接，然后展示完整 Markdown diff。未经我明确确认不要写入。
```

如果要创建新稿，在预览请求中使用 `createIfMissing=true`，并选择 `defaultRoot` 内新的 `.md` 路径。检查 diff 后，再明确要求应用该预览；写入完成后重新审计，并与原始发现项对比。

### 配置并启动 Harness

先在 Bundle 配置中设置知识库根目录，再启动 DeepSeek Harness：

```bash
dsh web
```

本地开发时，先构建插件，再从插件目录的上级目录安装：

```bash
pnpm install
pnpm run build
dsh plugin --profile default add ./dsh-geo
```

### 详细请求方式

真实 SEO 项目建议优先使用 `geo_workflow`。它会在一次结果中完成诊断、关键词调整、内容 Brief 和生产验证计划，减少用户猜测工具调用顺序的成本。

分析公开网站或公开账号主页：

```text
请对 https://example.com 执行 geo_workflow。目标：提升产品教育类的有效访问。受众：第一次评估产品的人。返回 SEO/GEO/AEO 诊断、定性关键词计划和完整 Markdown 内容生产计划，不要写入文件。
```

分析公开或私有账号主页的导出快照：

```text
请对 snapshots/account-home.html 执行 geo_workflow，把它当作私有主页快照。目标：让主页更容易被搜索和答案引擎发现、理解和引用。返回诊断、关键词映射、内容 Brief 和验证清单，不要写入文件。
```

入口边界如下：

- 公开 `http(s)` URL 通过 Harness `ctx.web` 匿名读取。
- 需要 JavaScript 渲染的公开页面，先保存/导出为 Markdown 或 HTML 再分析。
- 私有账号主页通过本地 Markdown/HTML 快照支持；浏览器 Cookie 和平台凭据不会进入插件。
- `geo_workflow` 默认会在 `defaultRoot` 中查找相关笔记，把本地标题、小标题、实体、主查询和受限长度摘录作为上下文；这些上下文不会发送到公开搜索。如需只分析当前来源，可指定 `useKnowledgeBase=false`。
- 本地 Markdown/HTML 默认不会把提取出的词发送到公开搜索；关键词计划会标为 `seed-only`，除非用户自行提供外部关键词数据。
- 搜索结果只提供定性主题信号。搜索量、排名难度和流量需要独立数据源，插件不会自行编造。

安装到新环境后，建议先检查根目录：

```text
检查当前知识库根目录是否可以进行本地扫描。
```

```text
请审计这篇 Markdown 的 SEO、GEO、AEO，给出分数、证据和前五项行动建议。
```

```text
扫描我的知识库，列出来源缺失、孤立链接和综合分数最低的笔记。
```

```text
生成项目报告，包含 SEO、GEO、AEO 平均分、治理缺口和优先处理文件。
```

```text
根据这篇笔记生成内容 Brief，包括受众、意图、大纲、常见问题和来源缺口。
```

```text
请对 https://example.com 执行完整流程，使用“产品教育”作为种子关键词，生成内容草稿计划，不要写入任何文件。
```

```text
请对 https://example.com 执行 geo_workflow。使用当前配置知识库中的相关笔记作为私有上下文，把来源证据、Google 标准警告和关键词地图合并到内容生产输入中。不要写入文件。
```

如果只想分析一个维度，可以指定 `focus=seo`、`focus=geo` 或 `focus=aeo`。

### 写回安全规则

内容修改默认只预览。第一次使用建议按下面的最短闭环操作：

1. 先审计一篇最重要的笔记，只处理一两个影响最大的发现。
2. 让助手只改这一篇，保留事实、来源和有价值的知识库内部链接。
3. 请求预览，重点检查 diff，不要只看分数是否上升。
4. 明确确认预览；写回前 Harness 还会再次请求审批。
5. 应用预览。调用写回时只需提供 `path` 和 `previewToken`；完整 Markdown `content` 已绑定在令牌中，可以不重复传递。

写回操作带有版本保护，文件在预览后被修改时会拒绝覆盖。遇到这种情况，应重新审计当前文件并生成新预览，不要强行应用旧修改。若要把新草稿保存成新笔记，可在 `geo_preview_content` 中使用 `createIfMissing=true`，但目标仍必须位于 `defaultRoot` 内。

第一次可以直接这样说：

```text
先检查当前根目录，审计 notes/launch.md，只修复影响最大的三个问题，展示 diff，未经我批准不要写入。
```

### 常见问题排查

| 现象 | 常见原因 | 处理方式 |
|---|---|---|
| 找不到插件或工具 | Harness 仍加载旧 Bundle | 用相同来源重新安装插件，并重启 `dsh web` |
| `geo_setup_check` 无法读取根目录 | `defaultRoot` 缺失、错误或不在允许范围内 | 修改 Bundle 配置后重启 Harness |
| 公开页面内容为空或不完整 | 页面依赖 JavaScript、登录或匿名请求被拦截 | 将可见页面导出为 Markdown/HTML，再分析本地快照 |
| 私有 URL 无法直接抓取 | 插件刻意不使用浏览器 Cookie 或账号凭据 | 将页面保存/导出到 `defaultRoot`，传入本地路径 |
| `keywordPlan.dataQuality` 是 `seed-only` | 来源是本地文件，提取出的词没有发送到公开搜索 | 补充自己的种子词或独立关键词数据；私有内容出现此状态是正常的 |
| 预览后写回被拒绝 | 预览后文件发生变化，或令牌/路径不再匹配 | 重新读取当前文件、重新预览并检查新的 diff |
| 结果显示 HTTP non-2xx 或 source unavailable | 匿名访问无法获得该 URL | 检查 URL，或改用导出快照 |
| 文件过大或扫描数量受限 | 达到 `maxTextChars`、`maxFileBytes` 或 `maxFiles` | 拆分来源，或有意识地提高对应限制 |

修改插件源码后，要重新构建并从相同本地目录安装，Harness 才会加载新 Bundle。如果当前 Harness 版本的命令提示不一致，可运行 `dsh plugin --help` 查询；插件不会修改其他 profile 或其他仓库。

## 常用命令示例

```text
请审计一篇 GEO.md。
```

```text
扫描我的知识库，列出 GEO、SEO、AEO 综合得分最低的文件。
```

```text
先预览修改方案，未经我明确确认不要写入文件。
```

## 配置

默认知识库目录：由安装者自行配置。

工具路径支持绝对路径或工作区相对路径。相对路径会基于 `defaultRoot` 解析，所有读写都会经过根目录边界校验。

## 开发

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

## 联系方式和图片

### 微信联系

![微信联系二维码](./img/wechat.png)

### 微信支付

![微信支付二维码](./img/wepay.jpg)

联系方式：[2712192471@qq.com](mailto:2712192471@qq.com)

## 许可证

MIT，详见 [LICENSE](./LICENSE)。
