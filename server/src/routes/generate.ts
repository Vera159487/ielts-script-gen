import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { generateScriptStream } from "../services/ai";
import { getStyleById, createScript } from "../db";
import { setSSEHeaders, writeSSEEvent } from "./sse-helper";

const router = Router();

// POST /api/generate — 生成脚本（SSE 流式）
router.post("/", async (req: Request, res: Response) => {
  try {
    const { topic, styleId, referenceScript } = req.body;

    if (!topic || !styleId) {
      res.status(400).json({ error: "缺少必填参数：topic、styleId" });
      return;
    }

    const style = getStyleById(styleId) as any;
    if (!style) {
      res.status(404).json({ error: "风格不存在" });
      return;
    }

    // 设置 SSE 响应头
    setSSEHeaders(res);

    const scriptId = uuid();
    let fullContent = "";

    try {
      const stream = generateScriptStream({
        topic,
        stylePrompt: style.prompt_template,
        referenceScript,
      });

      for await (const chunk of stream) {
        fullContent += chunk;
        // SSE 格式：data: <json>\n\n
        writeSSEEvent(res, { type: "chunk", content: chunk });
      }

      // 保存到数据库
      createScript(scriptId, topic, styleId, style.name, fullContent);

      // 发送完成事件
      writeSSEEvent(res, {
        type: "done",
        scriptId,
        topic,
        styleName: style.name,
        content: fullContent,
      });
    } catch (aiError: any) {
      console.error("AI 生成失败:", aiError);
      writeSSEEvent(res, { type: "error", message: aiError.message || "AI 生成失败" });
    }

    res.end();
  } catch (error) {
    console.error("生成接口错误:", error);
    // 如果还没开始 SSE，返回 JSON 错误
    if (!res.headersSent) {
      res.status(500).json({ error: "生成失败，请重试" });
    }
  }
});

export default router;
