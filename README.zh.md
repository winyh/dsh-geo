# 生成式引擎优化

`dsh-geo` 是“生成式引擎优化” DeepSeek Harness Bundle，为 Markdown 知识库提供可解释的 SEO、GEO 和 AEO 工具。

## 功能

- 审计单个 Markdown 笔记的 SEO、GEO、AEO 准备度。
- 扫描知识库中的元数据缺失、来源缺失、孤立笔记和重复标题。
- 生成内容 Brief：主题、关键词、意图、受众、大纲、用户问题和来源缺口。
- 检查引用来源、来源字段和更新时间。
- 先预览、后确认，使用版本保护安全写回 Markdown。
- 核心分析完全在本地完成，不依赖外部 GEO/SEO 服务。

插件采用本地优先策略，不会上传知识库内容。

## 安装

```bash
dsh plugin --profile default add dsh-geo
```

也可以从 GitHub 安装：

```bash
dsh plugin --profile default add github:你的用户名/dsh-geo
```

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

```text
请审计这篇 Markdown 的 SEO、GEO、AEO，给出分数、证据和前五项行动建议。
```

```text
扫描我的知识库，列出来源缺失、孤立链接和综合分数最低的笔记。
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
