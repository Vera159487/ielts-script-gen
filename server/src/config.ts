import { config } from "dotenv";
import { resolve } from "path";

// 尝试加载 .env 文件，不存在则忽略
try {
  config({ path: resolve(__dirname, "../.env") });
} catch {
  // .env file optional
}

export const DEEPSEEK_API_KEY =
  process.env.DEEPSEEK_API_KEY || "sk-your-api-key";
export const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
export const DEEPSEEK_MODEL =
  process.env.DEEPSEEK_MODEL || "deepseek-chat";
export const PORT = parseInt(process.env.PORT || "3001", 10);
