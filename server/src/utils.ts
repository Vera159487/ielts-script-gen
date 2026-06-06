/**
 * 服务端通用工具函数
 */

// ========== 日期解析 ==========

/**
 * 解析中文日期/相对时间文本，返回 Date 对象
 * 支持：ISO 日期、"YYYY年M月D日"、"M月D日"、"X天前"、"X小时前"、"X分钟前"、"刚刚"
 * 返回 null 表示无法解析或日期超出合理范围（未来 / 10 年前更早）
 */
export function parseChineseDate(raw: string): Date | null {
  if (!raw) return null;

  // 1. 直接解析（ISO 字符串、时间戳等）
  const parsed = new Date(raw);
  const ts = parsed.getTime();
  if (!isNaN(ts) && ts <= Date.now() && ts > Date.now() - 10 * 365 * 24 * 60 * 60 * 1000) {
    return parsed;
  }

  // 2. 相对时间："发布于307天前" / "发布于 2天前" / "3小时前" / "刚刚"
  let m = raw.match(/发布于?\s*(\d+)\s*天前/);
  if (m) {
    const days = parseInt(m[1], 10);
    if (days >= 0 && days <= 3650) return new Date(Date.now() - days * 86400000);
  }

  m = raw.match(/发布于?\s*(\d+)\s*小时前/);
  if (m) return new Date(Date.now() - parseInt(m[1], 10) * 3600000);

  m = raw.match(/发布于?\s*(\d+)\s*分钟前/);
  if (m) return new Date(Date.now() - parseInt(m[1], 10) * 60000);

  if (raw.includes("刚刚")) return new Date();

  // 3. 中文完整日期："2025年5月28日"
  m = raw.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T00:00:00+08:00`);

  // 4. 中文简写日期："5月28日"（补充当前年份）
  m = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    const mo = parseInt(m[1], 10);
    const d = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const y = new Date().getFullYear();
      return new Date(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+08:00`);
    }
  }

  return null;
}

// ========== JSON 安全解析 ==========

/**
 * 安全解析 JSON 文本（AI 返回内容可能包裹在 markdown 代码块中或含额外文本）
 * 自动处理：```json 代码块包裹、文本前缀/后缀、未闭合 JSON 截断
 */
export function safeParseJson(text: string): any {
  let cleaned = text.trim();

  // 移除 markdown 代码块包裹
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // 如果文本不直接以 JSON 开头，尝试找到 JSON 的起始位置
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const jsonStart = Math.min(
      cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{"),
      cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("[")
    );
    if (jsonStart !== Infinity) {
      cleaned = cleaned.slice(jsonStart);
    }
  }

  // 如果文本以 { 或 [ 开头，尝试截取到对应的闭合位置
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let endIndex = cleaned.length;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{" || ch === "[") { depth++; }
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }
    cleaned = cleaned.slice(0, endIndex);
  }

  return JSON.parse(cleaned);
}

// ========== URL 工具 ==========

/**
 * 标准化小红书链接
 * - 默认：移除追踪参数（share_id, share_from, share_channel, xsec_token, xsec_source）和 hash
 * - stripQuery=true：完全移除查询参数和 hash（用于去重比较）
 */
export function normalizeXHSLink(
  url: string,
  options?: { stripQuery?: boolean }
): string {
  try {
    const u = new URL(url);

    if (options?.stripQuery) {
      u.search = "";
      u.hash = "";
      return u.toString();
    }

    // 移除追踪参数
    const trackingParams = [
      "share_id",
      "share_from",
      "share_channel",
      "xsec_token",
      "xsec_source",
    ];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
