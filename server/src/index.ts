import express from "express";
import cors from "cors";
import { PORT } from "./config";
import { initDB } from "./db";
import stylesRouter from "./routes/styles";
import generateRouter from "./routes/generate";
import scriptsRouter from "./routes/scripts";

async function main() {
  // 初始化数据库
  await initDB();

  const app = express();

  // 中间件
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // 路由
  app.use("/api/styles", stylesRouter);
  app.use("/api/generate", generateRouter);
  app.use("/api/scripts", scriptsRouter);

  // 健康检查
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 启动
  app.listen(PORT, () => {
    console.log(`🚀 破7学院脚本生成器后端已启动: http://localhost:${PORT}`);
    console.log(`   API 端点: http://localhost:${PORT}/api`);
  });
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
