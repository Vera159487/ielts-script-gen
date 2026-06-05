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

## Key Constraints

- **Windows PowerShell 5.1** — no `&&` chaining, no ternary operators
- **DeepSeek API** — configured via `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` env vars
- **SQLite** — single file `data.db`, no DB server needed
- **SSE** — Pipeline 进度通过 Server-Sent Events 推送（非 WebSocket）
- **小红书数据** — 手动粘贴链接 + 后端 cheerio 解析（非爬虫）
