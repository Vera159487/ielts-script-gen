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
export const XHS_COOKIE = process.env.XHS_COOKIE || "";
export const XHS_MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
