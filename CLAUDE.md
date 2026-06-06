# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

破7学院（Po7 Academy）全链路小红书视频脚本自动化工作台。按照真实运营 SOP，将写稿流程四步全自动化：关键词生成 → 爆款筛选 → 验证确认 → 二创改写，最终输出三件套（原链接 + 原脚本 + 终稿）。

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + TailwindCSS 3 + Vite |
| Backend | Express + TypeScript + tsx (hot reload) |
| Database | sql.js (SQLite WASM, 持久化到 data.db) |
| AI | DeepSeek API (OpenAI SDK compatible mode) |
| Scraping | cheerio (HTML 解析小红书分享页) |
| Startup | concurrently (one command: `npm run dev`) |

## Architecture: Pipeline + Session + Artifact

```
[用户输入话题]
    │
    ▼
┌─────────────────────────────────────────────┐
│         Pipeline Orchestrator                │
│  Step1: 关键词生成  →  keywords 缓存        │
│  Step2: 爆款筛选    →  手动粘贴链接+后端解析  │
│  Step3: 验证确认    →  AI 四维过滤+评分      │
│  Step4: 二创改写    →  三件套输出            │
└─────────────────────────────────────────────┘
    │
    ▼
[三件套输出：原链接 + 原脚本 + 终稿]
```

每步独立执行、独立存储、独立可重试，通过 SSE 实时推送进度到前端四步向导。

## Project Structure

```
ielts-script-gen/
├── package.json              # Root — concurrently scripts
├── client/                   # Vite + React + TailwindCSS (port 5173)
│   └── src/
│       ├── App.tsx           # 入口 → PipelineWizard
│       ├── main.tsx          # React 入口
│       ├── index.css         # Tailwind + 自定义组件样式
│       ├── api.ts            # fetch wrapper → /api/*
│       ├── types.ts          # 全类型定义（含 Pipeline 新类型）
│       ├── hooks/
│       │   ├── usePipeline.ts    # Pipeline 状态管理 + SSE 消费
│       │   └── useScripts.ts     # 旧版 Hook（保留兼容）
│       └── components/
│           ├── PipelineWizard.tsx # 主工作台（话题+风格+四步）
│           ├── StepIndicator.tsx  # 步骤指示器 ❶❷❸❹
│           ├── Step1Keywords.tsx  # 关键词生成+展示
│           ├── Step2Search.tsx    # 链接粘贴+解析
│           ├── Step3Verify.tsx    # 验证结果展示
│           ├── Step4Rewrite.tsx   # 改写预览+三件套
│           ├── ProgressPanel.tsx  # 实时进度日志
│           ├── ScriptForm.tsx     # 旧版（保留）
│           ├── ScriptPreview.tsx  # 旧版（保留）
│           ├── HistoryPanel.tsx   # 旧版（保留）
│           ├── ExportMenu.tsx     # 旧版（保留）
│           └── StyleSelector.tsx  # 风格选择器
│       └── vite.config.ts
├── server/                   # Express + TypeScript (port 3001)
│   └── src/
│       ├── index.ts          # Express 入口
│       ├── db.ts             # SQLite：7 张表
│       ├── config.ts         # 环境变量
│       ├── routes/
│       │   ├── pipeline.ts   # Pipeline SSE 端点
│       │   ├── sessions.ts   # 会话 CRUD
│       │   ├── generate.ts   # 旧版生成（保留）
│       │   ├── scripts.ts    # 脚本 CRUD
│       │   └── styles.ts     # 风格列表
│       └── services/
│           ├── pipeline.ts   # Pipeline 编排器（核心）
│           ├── ai.ts         # DeepSeek API（通用 chat/chatStream）
│           ├── xhs-scraper.ts # 小红书链接解析
│           ├── prompt.ts     # 旧版 Prompt（保留）
│           └── prompts/
│               ├── keywords.ts  # Step1 关键词 Prompt
│               ├── verifier.ts  # Step3 验证 Prompt
│               └── rewriter.ts  # Step4 改写 Prompt（最核心）
```

## Database Schema

| 表 | 用途 |
|---|------|
| `styles` | 5 种脚本风格模板 |
| `scripts` | 脚本记录（+session_id/source_url/original_script） |
| `sessions` | 一次完整 Pipeline 执行 |
| `pipeline_steps` | 每步输入/输出/状态/重试 |
| `keyword_banks` | 关键词缓存（同话题不重复调 AI） |
| `viral_posts` | 小红书爆款数据（含验证结果） |
| `settings` | 键值配置 |

## Development Commands

```bash
npm install              # Install root deps
cd server && npm install # Install server deps
cd client && npm install # Install client deps
npm run dev              # Start both (server:3001 + client:5173)
```

## SOP Rewrite Rules (Step 4)

1. 前 15 秒保留（除非与 IP 背景不符）
2. 删除/修改与 IP 不符内容（背单词、刷题、长战线等）
3. 必须增加三个元素：背书 ×1 + 方法论 ×1 + 钩子 ×1
4. 保留原爆款的有效结构（叙事节奏、情绪设计、互动方式）

## IP Info (Auto-injected)

- 雅思 8.5 分（阅读、听力 9 分）
- UCSD → 上海财经大学双名校背景
- 2000+ 学员，70% 21 天达标
- "逆向解题法" 首创者
- 核心理念：不要背单词，分析底层逻辑；雅思是应试，有迹可循

## Multi-Agent Workflow（必须遵守）

本项目配置了 6 个专用子 agent（`.claude/agents/*.md`），各自拥有独立的上下文窗口。**主 agent 的上下文是稀缺资源，必须通过子 agent 隔离实现工作。**

### 可用 Agent 及职责

| Agent | 主拥有文件 | 何时使用 |
|-------|-----------|---------|
| `step1-keywords` | `prompts/keywords.ts`、pipeline 中 `runKeywordsStep` | 关键词 prompt、缓存策略、JSON 解析降级 |
| `step2-search` | `xhs-scraper.ts`、`xhs-search.ts`、pipeline 中 `addViral*` 系列 | XHS 链接解析、Bing/OpenCLI 搜索、xsecToken 传递链、视频/图文分类 |
| `step3-verify` | `prompts/verifier.ts`（已废弃，改用数学计算）、pipeline 中 `runVerifyStep`/`computeFilterDetails` | 四维过滤标准、匹配度算法、百分比展示 |
| `step4-rewrite` | `prompts/rewriter.ts`、pipeline 中 `runRewriteStep` | SOP 四大改写规则、三件套输出、IP 信息注入、流式改写 |
| `ui-designer` | `index.css`、各 Step 组件的视觉样式 | TailwindCSS 布局、响应式、设计规范一致性 |
| `reviewer` | `types.ts`、`db.ts`、`pipeline.ts` 编排器部分、`api.ts` | 类型安全、错误处理、架构一致性、跨 Step 兼容性 |

### 核心规则

1. **实现工作必须委托给子 agent**：确认方案后，把代码实现交给对应领域的子 agent，不要让主 agent 逐个文件编辑。
2. **子 agent 同时做方案 + 实现**：尽量在同一次调用中让子 agent 先分析再动手改代码，只返回 "改了什么、编译是否通过" 的简短结果。
3. **跨领域任务分解**：涉及多个 Step 的需求，拆分为独立的子任务，分别派给对应的子 agent 并行执行。
4. **主 agent 只做三件事**：(a) 理解需求并分解任务，(b) 协调多个子 agent 的并行执行，(c) 最终编译验证 + 汇总结果。
5. **共享文件需协商**：修改 `types.ts`、`db.ts`、`pipeline.ts`（编排器部分）等共享文件时，要么由 reviewer agent 执行，要么各相关 agent 协商后由一方统一修改。

### 正确示例

```
用户："Step2 加视频/图文分类，Step3 简化为纯展示"

主 agent：
  1. 把 Step2 需求发给 step2-search agent → agent 分析+实现+编译验证 → 返回"改了 3 个文件，编译通过"
  2. 把 Step3 需求发给 step3-verify agent → agent 分析+实现+编译验证 → 返回"改了 2 个文件，编译通过"
  3. 把 UI 需求发给 ui-designer agent → agent 分析+实现+编译验证 → 返回"改了 5 个组件"
  4. 主 agent 最终编译确认 → 汇总给用户
```

### 错误示例

```
用户："Step2 加视频/图文分类"

主 agent：
  ✗ 自己读了 10 个文件，逐个编辑了 15 个文件  ← 全部消耗主 agent 上下文
  ✗ 调子 agent 只做方案分析，自己动手实现    ← 子 agent 浪费了
```

### 代码审查闸门（必须遵守）

**每次代码修改完成后，必须调用 reviewer agent 进行审查**，不得跳过。工作流：

```
代码修改完成 → reviewer agent 审查 → 修复发现的问题 → 编译确认 → 完成
```

具体规则：
- 无论修改量大小，都必须经过 reviewer 审查（审查是隔离在子 agent 中的，不消耗主 agent 上下文）
- reviewer 检查维度：冗余代码、效率问题、类型安全、架构一致性、错误处理、边界情况
- 审查发现的问题必须修复后才能视为完成
- 如果修改涉及单个 Step 领域，则由该 Step agent 修复 reviewer 发现的问题；跨领域问题由 reviewer 自行修复

### 代码提交到 GitHub（必须遵守）

**每次代码修改完成并通过 reviewer 审查和编译验证后，必须提交并推送到 GitHub。** 工作流：

```
代码修改完成 → reviewer 审查通过 → 编译通过 → git add + commit + push → 完成
```

具体规则：
- 使用 `git add -A` 暂存所有变更（包括新文件）
- Commit message 使用中文简述改动内容（如 `fix: 修复 XHS 时长和粉丝提取`）
- 推送前无需确认，直接执行
- 确保 `.env` 等敏感文件在 `.gitignore` 中，不会被误提交

## Key Constraints

- **Windows PowerShell 5.1** — no `&&` chaining, no ternary operators
- **DeepSeek API** — configured via `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` env vars
- **SQLite** — single file `data.db`, no DB server needed
- **SSE** — Pipeline 进度通过 Server-Sent Events 推送（非 WebSocket）
- **小红书数据** — 手动粘贴链接 + 后端 cheerio 解析（非爬虫）

## Context 用量汇报（必须遵守）

**每次任务完成后（包括子 agent 返回结果后），必须告知用户当前主 agent 的 context 用量。** 格式：

```
> 📊 Context 用量：X% | 主 agent | 本轮消耗约 Yk tokens
```

说明：
- `X%`：主 agent 上下文已使用的百分比
- 子 agent 的 context 消耗独立计算，不计入百分比，但需在汇总中列出每个子 agent 的消耗
- 当百分比超过 70% 时主动提醒用户考虑 `/compact`

### 子 agent context 消耗汇总格式

```
| Agent | 消耗 tokens |
|-------|------------|
| step2-search | ~43k |
| ui-designer | ~24k |
| reviewer | ~67k |
```

