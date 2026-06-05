import { Router } from "express";
import type { Request, Response } from "express";

// Express 5 类型修复：params 可能是 string | string[]
function param(req: Request, name: string): string {
  return req.params[name] as string;
}
import {
  getScripts,
  getScriptById,
  updateScriptContent,
  deleteScript,
  getScriptsCount,
} from "../db";

const router = Router();

// GET /api/scripts — 获取脚本列表（分页）
router.get("/", (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const scripts = getScripts(limit, offset);
    const total = getScriptsCount();
    res.json({ scripts, total, limit, offset });
  } catch (error) {
    console.error("获取脚本列表失败:", error);
    res.status(500).json({ error: "获取脚本列表失败" });
  }
});

// GET /api/scripts/:id — 获取单个脚本
router.get("/:id", (req: Request, res: Response) => {
  try {
    const script = getScriptById(param(req, "id"));
    if (!script) {
      res.status(404).json({ error: "脚本不存在" });
      return;
    }
    res.json({ script });
  } catch (error) {
    console.error("获取脚本失败:", error);
    res.status(500).json({ error: "获取脚本失败" });
  }
});

// PUT /api/scripts/:id — 更新脚本内容
router.put("/:id", (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: "缺少 content 字段" });
      return;
    }
    const existing = getScriptById(param(req, "id"));
    if (!existing) {
      res.status(404).json({ error: "脚本不存在" });
      return;
    }
    updateScriptContent(param(req, "id"), content);
    res.json({ success: true });
  } catch (error) {
    console.error("更新脚本失败:", error);
    res.status(500).json({ error: "更新脚本失败" });
  }
});

// DELETE /api/scripts/:id — 删除脚本
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const existing = getScriptById(param(req, "id"));
    if (!existing) {
      res.status(404).json({ error: "脚本不存在" });
      return;
    }
    deleteScript(param(req, "id"));
    res.json({ success: true });
  } catch (error) {
    console.error("删除脚本失败:", error);
    res.status(500).json({ error: "删除脚本失败" });
  }
});

export default router;
