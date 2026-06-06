/**
 * SSE 响应辅助工具
 * 供所有 SSE 流式路由复用
 */

import type { Response } from "express";

/** 设置 SSE 标准响应头 */
export function setSSEHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

/** 写入一条 SSE 事件（自动添加 data: 前缀和 \n\n 结尾） */
export function writeSSEEvent(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
