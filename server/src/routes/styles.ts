import { Router } from "express";
import { getStyles } from "../db";

const router = Router();

// GET /api/styles — 获取所有风格
router.get("/", (_req, res) => {
  try {
    const styles = getStyles();
    res.json({ styles });
  } catch (error) {
    console.error("获取风格列表失败:", error);
    res.status(500).json({ error: "获取风格列表失败" });
  }
});

export default router;
