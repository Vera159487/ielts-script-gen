# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

破7学院（Po7 Academy）小红书视频脚本自动生成工具。输入雅思话题，一键生成符合小红书调性的视频脚本（3分钟以内），包含文案、旁白、画面建议、字幕重点。

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + TailwindCSS 3 + Vite |
| Backend | Express + TypeScript + tsx (hot reload) |
| Database | better-sqlite3 (zero-config file DB) |
| AI | DeepSeek API (OpenAI SDK compatible mode) |
| Startup | concurrently (one command: `npm run dev`) |

## Project Structure

```
ielts-script-gen/
├── package.json          # Root — concurrently scripts
├── client/               # Vite + React + TailwindCSS (port 5173)
│   ├── src/
│   │   ├── App.tsx       # Main layout
│   │   ├── components/   # ScriptForm, ScriptPreview, HistoryPanel, ExportMenu, StyleSelector
│   │   ├── hooks/        # useScripts custom hook
│   │   ├── api.ts        # fetch wrapper → /api/*
│   │   └── types.ts      # Shared TypeScript interfaces
│   └── vite.config.ts    # Proxy /api → localhost:3001
├── server/               # Express + TypeScript (port 3001)
│   └── src/
│       ├── index.ts      # Express entry
│       ├── db.ts         # SQLite init + seed
│       ├── config.ts     # Env vars
│       ├── routes/       # generate.ts, scripts.ts, styles.ts
│       └── services/     # ai.ts (DeepSeek), prompt.ts (template builder)
```

## Development Commands

```bash
npm install          # Install root deps
cd server && npm install  # Install server deps
cd client && npm install  # Install client deps
npm run dev          # Start both (server:3001 + client:5173)
```

## Key Constraints

- **Windows PowerShell 5.1** — no `&&` chaining, no ternary operators
- **DeepSeek API** — configured via `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` env vars
- **No Electron** — this is a browser-based web app
- **SQLite** — single file `data.db`, no DB server needed

## IP Info (Auto-injected into prompts)

- 考前 8.5 分（阅读、听力 9 分）
- UCSD → 上海财经大学双名校背景
- 2000+ 学员，70% 21 天达标
- "逆向解题法" 首创者
- 核心理念：不要背单词，分析底层逻辑；雅思是应试，有迹可循

## SOP Script Structure

1. 前 15 秒钩子（保留爆款开头）
2. 背书引入（"我自己…所以还是比较有发言权的"）
3. 方法论展开（以"我常说"引出独家方法论）
4. 互动引导（引导点赞收藏评论）
