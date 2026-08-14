# 生成式引擎优化

> **语言 / Language:** **中文** · [English](./README.md)

`dsh-geo` 是“生成式引擎优化” DeepSeek Harness Bundle，为 Markdown 知识库提供可解释的 SEO、GEO 和 AEO 工具。

## 功能

- 审计单个 Markdown 笔记的 SEO、GEO、AEO 准备度。
- 扫描知识库中的元数据缺失、来源缺失、孤立笔记和重复标题。
- 在扫描前检查根目录是否可访问，并生成可交付的项目报告。
- 生成内容 Brief：主题、关键词、意图、受众、大纲、用户问题和来源缺口。
- 检查引用来源、来源字段和更新时间。
- 先显示 diff、再审批，使用版本保护安全写回 Markdown。
- 核心分析完全在本地完成，不依赖外部 GEO/SEO 服务。

插件采用本地优先策略，不会上传知识库内容。

## 工具

| 工具 | 用途 |
|---|---|
| `geo_setup_check` | 检查根目录和扫描准备状态 |
| `geo_audit_note` | 审计单个 Markdown 笔记 |
| `geo_audit_vault` | 扫描整个知识库 |
| `geo_project_report` | 生成结构化项目报告 |
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

### 1. 配置并启动 Harness

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

### 2. 使用自然语言调用

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

如果只想分析一个维度，可以指定 `focus=seo`、`focus=geo` 或 `focus=aeo`。

### 3. 写入前先预览

内容修改默认只预览。请先检查完整替换内容，明确确认后再应用修改；写回操作带有版本保护，文件在预览后被修改时会拒绝覆盖。

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
