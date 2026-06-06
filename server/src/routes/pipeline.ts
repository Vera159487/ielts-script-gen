/**
 * Pipeline 路由
 *
 * POST /api/pipeline/execute   — 启动 Pipeline (SSE 流式)
 * POST /api/pipeline/retry     — 重试失败步骤（后续实现）
 * POST /api/pipeline/skip      — 跳过某步骤（后续实现）
 * POST /api/pipeline/add-url   — 手动添加小红书链接
 * POST /api/pipeline/stream-rewrite — 流式生成改写脚本 (SSE)
 * GET  /api/pipeline/:id/status — 获取 Pipeline 状态
 */

import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { executePipeline, addViralPostsToSession, addViralPostsFromSearchResults } from "../services/pipeline";
import { searchXHSLinks } from "../services/xhs-search";
import { chatStream } from "../services/ai";
import { buildRewriterSystemPrompt, buildRewriterUserPrompt } from "../services/prompts/rewriter";
import { setSSEHeaders, writeSSEEvent } from "./sse-helper";
import {
  getSessionById,
  getStyleById,
  createSession,
  updateSessionStatus,
  createScript,
} from "../db";

const router = Router();

// POST /api/pipeline/execute — 启动 Pipeline (SSE)
router.post("/execute", async (req: Request, res: Response) => {
  try {
    const { topic, styleId } = req.body;

    if (!topic) {
      res.status(400).json({ error: "缺少必填参数：topic" });
      return;
    }

    setSSEHeaders(res);

    const sessionId = uuid();

    try {
      // 在 try 块内创建 session，避免 executePipeline 异常时留下孤儿记录
      createSession(sessionId, topic, styleId);
      const pipeline = executePipeline(topic, styleId, sessionId);

      for await (const event of pipeline) {
        writeSSEEvent(res, event);

        // Step2 完成后暂停，等待用户添加链接
        if (event.type === "step_complete" && event.step === "search") {
          writeSSEEvent(res, {
            type: "step_progress",
            step: "search",
            stepOrder: 2,
            message: "请在下方粘贴小红书爆款链接，然后点击继续",
            data: { action: "wait_for_urls", sessionId },
          });
          updateSessionStatus(sessionId, "waiting_input", "search");
          break; // 暂停流水线，等待用户添加链接后通过 /continue 继续
        }
      }
    } catch (err: any) {
      writeSSEEvent(res, { type: "step_error", message: err.message });
    }

    res.end();
  } catch (error) {
    console.error("Pipeline 执行错误:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Pipeline 启动失败" });
    }
  }
});

// POST /api/pipeline/add-url — 添加小红书链接（支持从搜索结果带元数据）
router.post("/add-url", async (req: Request, res: Response) => {
  try {
    const { sessionId, urls, results } = req.body;

    if (!sessionId || (!urls && !results)) {
      res.status(400).json({ error: "缺少必填参数：sessionId、urls 或 results" });
      return;
    }

    // 支持两种格式：纯 URL 字符串数组，或带元数据的搜索结果数组
    if (results && Array.isArray(results)) {
      const posts = await addViralPostsFromSearchResults(sessionId, results);
      res.json({ success: true, posts, count: posts.length });
    } else {
      const urlList = Array.isArray(urls) ? urls : [urls];
      const posts = await addViralPostsToSession(sessionId, urlList);
      res.json({ success: true, posts, count: posts.length });
    }
  } catch (error: any) {
    console.error("添加链接失败:", error);
    res.status(500).json({ error: error.message || "添加链接失败" });
  }
});

// POST /api/pipeline/continue — 继续执行后续步骤（Step3 + Step4）
router.post("/continue", async (req: Request, res: Response) => {
  try {
    const { sessionId, topic, styleId } = req.body;

    if (!sessionId || !topic) {
      res.status(400).json({ error: "缺少必填参数：sessionId、topic" });
      return;
    }

    const session = getSessionById(sessionId);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    setSSEHeaders(res);

    // 从已有会话继续执行（跳过已完成的步骤）
    const pipeline = executePipeline(topic, styleId, sessionId);

    for await (const event of pipeline) {
      // 跳过已完成的步骤事件（已在 executePipeline 内处理）
      if (event.data?.skipped) {
        writeSSEEvent(res, event);
        continue;
      }
      writeSSEEvent(res, event);
    }

    res.end();
  } catch (error) {
    console.error("继续执行失败:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "继续执行失败" });
    }
  }
});

// POST /api/pipeline/stream-rewrite — 流式二创改写
router.post("/stream-rewrite", async (req: Request, res: Response) => {
  try {
    const { topic, styleId, originalScript, sourceUrl } = req.body;

    if (!topic || !originalScript) {
      res.status(400).json({ error: "缺少必填参数：topic、originalScript" });
      return;
    }

    let styleName: string | undefined;
    if (styleId) {
      const style = getStyleById(styleId) as any;
      styleName = style?.name;
    }

    const systemPrompt = buildRewriterSystemPrompt(styleName);
    const userPrompt = buildRewriterUserPrompt(
      topic, originalScript, sourceUrl
    );

    setSSEHeaders(res);

    const scriptId = uuid();
    let fullContent = "";

    try {
      const stream = chatStream({ systemPrompt, userPrompt, temperature: 0.8, maxTokens: 4096 });

      for await (const chunk of stream) {
        fullContent += chunk;
        writeSSEEvent(res, { type: "chunk", content: chunk });
      }

      // 保存到数据库
      createScript(
        scriptId, topic, styleId || "", styleName || "二创改写",
        fullContent, undefined, sourceUrl, originalScript
      );

      writeSSEEvent(res, {
        type: "done",
        scriptId,
        topic,
        styleName: styleName || "二创改写",
        content: fullContent,
        sourceUrl,
        originalScript,
      });
    } catch (err: any) {
      writeSSEEvent(res, { type: "error", message: err.message || "改写失败" });
    }

    res.end();
  } catch (error) {
    console.error("流式改写错误:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "改写启动失败" });
    }
  }
});

// POST /api/pipeline/auto-search — 自动搜索小红书链接
router.post("/auto-search", async (req: Request, res: Response) => {
  try {
    const { keywords, limit, strategy } = req.body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      res.status(400).json({ error: "缺少必填参数：keywords（非空数组）" });
      return;
    }

    const result = await searchXHSLinks(keywords, { limit: limit ?? 20, strategy });

    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("自动搜索失败:", error);
    res.status(500).json({ error: error.message || "自动搜索失败" });
  }
});

export default router;
