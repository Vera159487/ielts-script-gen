/**
 * 会话管理路由
 *
 * GET    /api/sessions              — 会话列表
 * GET    /api/sessions/:id          — 会话详情（含步骤和帖子）
 * DELETE /api/sessions/:id          — 删除会话
 */

import { Router, Request, Response } from "express";

function param(req: Request, name: string): string {
  return req.params[name] as string;
}

import {
  getSessions,
  getSessionsCount,
  getSessionById,
  deleteSession,
  getStepsBySession,
  getViralPostsBySession,
} from "../db";

const router = Router();

// GET /api/sessions — 获取会话列表（分页）
router.get("/", (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sessions = getSessions(limit, offset);
    const total = getSessionsCount();
    res.json({ sessions, total, limit, offset });
  } catch (error) {
    console.error("获取会话列表失败:", error);
    res.status(500).json({ error: "获取会话列表失败" });
  }
});

// GET /api/sessions/:id — 获取会话详情
router.get("/:id", (req: Request, res: Response) => {
  try {
    const session = getSessionById(param(req, "id"));
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    const steps = getStepsBySession(session.id);
    const posts = getViralPostsBySession(session.id);

    res.json({ session, steps, posts });
  } catch (error) {
    console.error("获取会话详情失败:", error);
    res.status(500).json({ error: "获取会话详情失败" });
  }
});

// DELETE /api/sessions/:id — 删除会话
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const session = getSessionById(param(req, "id"));
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    deleteSession(param(req, "id"));
    res.json({ success: true });
  } catch (error) {
    console.error("删除会话失败:", error);
    res.status(500).json({ error: "删除会话失败" });
  }
});

export default router;
