/**
 * 小红书链接解析服务
 *
 * 方案 A：用户粘贴分享链接 → 后端 fetch + cheerio 解析
 * 从小红书分享页的 __INITIAL_STATE__ / SSR JSON 中提取结构化数据
 *
 * 增强功能（2026-06）：
 * - 多标记提取（__INITIAL_STATE__ / __INITIAL_SERVER_STATE__ / __INITIAL_SSR_STATE__）
 * - Cookie 支持（环境变量 XHS_COOKIE）
 * - 移动端 UA 回退
 * - 修复括号计数器引号处理（仅双引号为 JSON 字符串边界）
 * - 增强降级解析（扫描所有 <script> 标签 JSON、OG 标签、JSON-LD）
 */

import * as cheerio from "cheerio";
import { XHS_COOKIE, XHS_MOBILE_UA } from "../config";

// ========== 桌面端 UA ==========
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface XHSPostData {
  url: string;
  title: string;
  content: string;
  authorName: string;
  authorFollowers: number;
  likes: number;
  collects: number;
  comments: number;
  durationSeconds: number | null;
  publishedAt: string | null;
  postType?: "video" | "note";
  /** 原始 JSON 数据（调试用） */
  rawData?: any;
}

// ========== 通用工具函数 ==========

/**
 * 清理作者名中的 "关注" 后缀
 * 统一在数据提取出口做清理，调用方无需重复处理
 */
export function cleanAuthorName(name: string): string {
  return (name || "").replace(/\s*关注\s*$/, "").trim();
}

/**
 * 判断帖子数据是否包含有效信息（非空壳）
 */
function _hasRealData(r: XHSPostData): boolean {
  return r.likes > 0 || r.collects > 0 || r.authorFollowers > 0 || !!r.publishedAt;
}

/**
 * JSON 宽松解析（HTML 内嵌 JS 对象专用）
 *
 * 与 utils.ts 中的 safeParseJson 不同：
 *   - safeParseJson 处理 AI 返回内容（markdown 代码块包裹、额外文本前缀/后缀、未闭合截断）
 *   - 本函数处理 HTML 中内嵌的 JS 对象字面量（undefined 值替换为 null、清理尾部多余逗号）
 * 两者服务于不同场景，不可互相替换。
 */
function _parseJSONRelaxed(str: string): any {
  try {
    return JSON.parse(str.replace(/undefined/g, "null"));
  } catch {
    const cleaned = str
      .replace(/undefined/g, "null")
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");
    return JSON.parse(cleaned);
  }
}

/**
 * 从 note 节点推断帖子类型
 */
function _resolvePostType(note: any): "video" | "note" {
  return note?.type === "video" ? "video" : "note";
}

/**
 * 打印 note 节点调试信息（字段结构 + 关键值）
 */
function _dumpNoteDebug(note: any): void {
  _debugLog("=== XHS note 节点字段结构 ===");
  _dumpKeys(note, "note", 2);
  _debugLog("=== 原始 note 关键字段值 ===");
  _debugLog(
    JSON.stringify(
      {
        title: note.title,
        displayTitle: note.displayTitle,
        desc:
          typeof note.desc === "string"
            ? note.desc.slice(0, 100)
            : note.desc,
        type: note.type,
        time: note.time,
        createTime: note.createTime,
        publishTime: note.publishTime,
        publishDate: note.publishDate,
        publishedAt: note.publishedAt,
        updatedAt: note.updatedAt,
        timestamp: note.timestamp,
        user_keys: note.user ? Object.keys(note.user) : "no user",
        interactInfo_keys: note.interactInfo
          ? Object.keys(note.interactInfo)
          : "no interactInfo",
        note_card_keys: note.note_card
          ? Object.keys(note.note_card)
          : "no note_card",
        stat_keys: note.stat ? Object.keys(note.stat) : "no stat",
        interaction_keys: note.interaction
          ? Object.keys(note.interaction)
          : "no interaction",
        video_keys: note.video ? Object.keys(note.video) : "no video",
        likes: note.likes,
        likedCount: note.likedCount,
        liked_count: note.liked_count,
        collects: note.collects,
        comments: note.comments,
        duration: note.duration,
      },
      null,
      2
    )
  );
  _debugLog("=== DEBUG END ===");
}

/**
 * 构建 HTTP 请求 headers
 * 自动附带 XHS_COOKIE（如果配置了）
 */
function _buildHeaders(
  ua: string,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  if (XHS_COOKIE) headers["Cookie"] = XHS_COOKIE;
  return headers;
}

// ========== 字段候选键常量（统一 parseFromInitialState 与 buildPartialFromRaw） ==========

const FOLLOWER_KEYS = [
  "followerCount",
  "fans",
  "follows",
  "follower_count",
  "followCount",
  "follow_count",
  "followerNumber",
];

const LIKE_KEYS = [
  "likedCount",
  "liked_count",
  "likes",
  "likeCount",
  "like_count",
  "lovedCount",
  "loved_count",
];

const COLLECT_KEYS = [
  "collectedCount",
  "collected_count",
  "collects",
  "favoredCount",
  "favored_count",
  "favoriteCount",
  "favorite_count",
  "bookmarkCount",
];

const COMMENT_KEYS = [
  "commentCount",
  "comment_count",
  "comments",
  "totalCommentCount",
  "total_comment_count",
];

// ========== 主解析入口 ==========

/**
 * 解析小红书分享链接
 * 支持 xhslink.com 短链接和 xiaohongshu.com 完整链接
 *
 * 策略：
 *  1. 桌面 UA + Cookie 请求 → extractInitialState → parseFromInitialState
 *  2. 若失败 → 移动端 UA 重试 → extractInitialState → parseFromInitialState
 *  2.5. 若失败 → XHS 内部 API (/api/sns/web/v1/feed) 直接获取数据
 *  3. 若仍失败 → 增强降级 HTML 解析（script 标签 / JSON-LD / OG 标签）
 */
export async function parseXHSLink(url: string): Promise<XHSPostData> {
  const normalizedUrl = normalizeUrl(url);

  // ===== 策略 1: 桌面端 UA + Cookie =====
  let html = "";
  let finalUrl = normalizedUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const headers = _buildHeaders(DESKTOP_UA);
    if (XHS_COOKIE) {
      console.log(
        `[XHS-DEBUG] 使用 XHS_COOKIE (长度=${XHS_COOKIE.length})`
      );
    }

    const response = await fetch(normalizedUrl, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`请求小红书页面失败: HTTP ${response.status}`);
    }

    html = await response.text();
    finalUrl = response.url; // 重定向后的真实 URL
    console.log(
      `[XHS-DEBUG] 页面获取(桌面UA): status=${response.status}, htmlSize=${html.length}, hasMarker=${html.includes("__INITIAL_STATE__")}`
    );
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("请求小红书页面超时 (30s)");
    }
    // 非超时异常（如网络中断/DNS 解析失败）不抛到外层，继续尝试后续策略（移动UA/API/HTML降级）
    console.log(`[XHS-DEBUG] 桌面UA请求失败: ${err.message}，继续尝试后续策略`);
    // html 保持为空，后续策略会自行 fetch
  } finally {
    clearTimeout(timeoutId);
  }

  // ===== 尝试从页面提取 INITIAL_STATE =====
  try {
    let data = extractInitialState(html);
    console.log(
      `[XHS-DEBUG] extractInitialState(桌面): ${data ? "成功" : "null → 尝试移动端UA重试"}`
    );

    if (data) {
      try {
        const result = parseFromInitialState(data, finalUrl);
        if (_hasRealData(result)) {
          _logExtractionResult(result, "策略1(桌面UA)");
          return result;
        }
        console.log(
          "[XHS-DEBUG] parseFromInitialState 返回了空数据（note 节点为空），继续尝试后续策略..."
        );
      } catch (err: any) {
        console.log(
          `[XHS-DEBUG] parseFromInitialState(桌面) 失败: ${err.message}，继续尝试后续策略`
        );
      }
    }

    // ===== 策略 2: 移动端 UA 重试 =====
    const mobileController = new AbortController();
    const mobileTimeoutId = setTimeout(() => mobileController.abort(), 30_000);

    try {
      const mobileHeaders = _buildHeaders(XHS_MOBILE_UA);

      const mobileResp = await fetch(normalizedUrl, {
        headers: mobileHeaders,
        redirect: "follow",
        signal: mobileController.signal,
      });

      if (mobileResp.ok) {
        const mobileHtml = await mobileResp.text();
        finalUrl = mobileResp.url || finalUrl;
        console.log(
          `[XHS-DEBUG] 页面获取(移动UA): status=${mobileResp.status}, htmlSize=${mobileHtml.length}, hasMarker=${mobileHtml.includes("__INITIAL_STATE__")}`
        );

        data = extractInitialState(mobileHtml);
        console.log(
          `[XHS-DEBUG] extractInitialState(移动): ${data ? "成功" : "null → 尝试后续策略"}`
        );

        if (data) {
          try {
            const result = parseFromInitialState(data, finalUrl);
            if (_hasRealData(result)) {
              _logExtractionResult(result, "策略2(移动UA)");
              return result;
            }
            console.log(
              "[XHS-DEBUG] parseFromInitialState(移动) 返回了空数据，继续尝试后续策略..."
            );
          } catch (err: any) {
            console.log(
              `[XHS-DEBUG] parseFromInitialState(移动) 失败: ${err.message}，继续尝试后续策略`
            );
          }
        }

        html = mobileHtml;
      } else {
        console.log(
          `[XHS-DEBUG] 移动端UA返回 HTTP ${mobileResp.status}，使用桌面端HTML降级解析`
        );
      }
    } catch (err: any) {
      console.log(
        `[XHS-DEBUG] 移动端UA请求失败: ${err.message}，使用桌面端HTML降级解析`
      );
    } finally {
      clearTimeout(mobileTimeoutId);
    }

    // ===== 策略 2.5: XHS 内部 API =====
    console.log(`[XHS-DEBUG] extractNoteId 输入: finalUrl="${finalUrl}", normalizedUrl="${normalizedUrl}"`);
    let noteId = extractNoteId(finalUrl);
    // 如果 finalUrl 提取失败，尝试从原始规范化 URL 提取（redirect 可能改了格式）
    if (!noteId && normalizedUrl !== finalUrl) {
      noteId = extractNoteId(normalizedUrl);
      console.log(`[XHS-DEBUG] finalUrl 提取失败，从 normalizedUrl 提取: ${noteId || "仍失败"}`);
    }
    if (noteId) {
      console.log(
        `[XHS-DEBUG] __INITIAL_STATE__ 无数据或解析失败，尝试 API: noteId=${noteId}`
      );
      console.log(
        `[XHS-DEBUG] XHS_COOKIE 状态: ${XHS_COOKIE ? `已配置 (长度=${XHS_COOKIE.length})` : "未配置（API策略需要有效Cookie，否则大概率返回空数据）"}`
      );
      const apiData = await fetchNoteFromAPI(noteId);
      if (apiData) {
        _logExtractionResult(apiData, "策略2.5(API)");
        return apiData;
      }
      console.log("[XHS-DEBUG] API 也未返回数据，继续降级HTML解析");
    } else {
      console.log("[XHS-DEBUG] 无法从 URL 提取 noteId，跳过 API 回退");
    }

    // ===== 策略 3: 增强降级 HTML 解析 =====
    console.log(
      "[XHS-DEBUG] ⚠️ 进入增强降级HTML解析（扫描script标签+meta+OG）"
    );
    const fallbackResult = parseFromHTMLEnhanced(html, finalUrl);
    _logExtractionResult(fallbackResult, "策略3(HTML降级)");
    return fallbackResult;
  } catch (err: any) {
    console.error(`[XHS-DEBUG] ❌ parseXHSLink 全部分析链均失败:`);
    console.error(`[XHS-DEBUG]   inputUrl: ${url}`);
    console.error(`[XHS-DEBUG]   normalizedUrl: ${normalizedUrl}`);
    console.error(`[XHS-DEBUG]   finalUrl: ${finalUrl}`);
    console.error(`[XHS-DEBUG]   htmlSize: ${html?.length || 0}`);
    console.error(
      `[XHS-DEBUG]   hasInitialState: ${html?.includes("__INITIAL_STATE__") || false}`
    );
    console.error(
      `[XHS-DEBUG]   hasServerState: ${html?.includes("__INITIAL_SERVER_STATE__") || false}`
    );
    console.error(
      `[XHS-DEBUG]   hasSSRState: ${html?.includes("__INITIAL_SSR_STATE__") || false}`
    );
    console.error(
      `[XHS-DEBUG]   hasNextData: ${html?.includes("__NEXT_DATA__") || false}`
    );
    console.error(`[XHS-DEBUG]   error.name: ${err.name}`);
    console.error(`[XHS-DEBUG]   error.message: ${err.message}`);
    console.error(`[XHS-DEBUG]   error.stack: ${err.stack}`);
    console.error(
      `[XHS-DEBUG]   html首500字符: ${(html || "").slice(0, 500)}`
    );
    console.error(
      `[XHS-DEBUG]   html末500字符: ${(html || "").slice(-500)}`
    );
    throw new Error(
      `parseXHSLink 全链路解析失败 (URL=${normalizedUrl}): ${err.message}`
    );
  }
}

/**
 * 标准化 URL（补全协议、处理短链接）
 */
function normalizeUrl(url: string): string {
  let result = url.trim();
  if (!result.startsWith("http")) {
    result = "https://" + result;
  }
  return result;
}

/**
 * 从小红书 URL 中提取 note ID
 *
 * 支持的 URL 格式：
 *   - https://www.xiaohongshu.com/explore/6836ac5a0000000023010126
 *   - https://www.xiaohongshu.com/discovery/item/6836ac5a0000000023010126
 *   - https://www.xiaohongshu.com/a/events/6836ac5a0000000023010126
 *   - https://xhslink.com/... （需要先重定向）
 */
function extractNoteId(url: string): string | null {
  const patterns = [
    /xiaohongshu\.com\/explore\/([a-f0-9]+)/i,
    /xiaohongshu\.com\/discovery\/item\/([a-f0-9]+)/i,
    /xiaohongshu\.com\/a\/[^/]+\/([a-f0-9]+)/i,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * 通过 XHS 内部 API 获取帖子详情（当 __INITIAL_STATE__ 无数据时的回退方案）
 */
async function fetchNoteFromAPI(noteId: string): Promise<XHSPostData | null> {
  const apiUrl = "https://www.xiaohongshu.com/api/sns/web/v1/feed";

  const body = JSON.stringify({
    source_note_id: noteId,
    image_formats: ["jpg", "webp", "avif"],
    extra: { need_body_topic: 1 },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json;charset=UTF-8",
    "User-Agent": DESKTOP_UA,
    Accept: "application/json",
    Origin: "https://www.xiaohongshu.com",
    Referer: `https://www.xiaohongshu.com/explore/${noteId}`,
  };

  if (XHS_COOKIE) {
    headers["Cookie"] = XHS_COOKIE;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!resp.ok) {
      console.log(`[XHS-DEBUG] API 请求失败: HTTP ${resp.status}`);
      if (resp.status === 401 || resp.status === 403) {
        console.log(`[XHS-DEBUG] API 鉴权失败 (HTTP ${resp.status}) — 需要有效的 XHS_COOKIE`);
      }
      return null;
    }

    const json = await resp.json();

    // 打印 API 响应顶层结构
    console.log(`[XHS-DEBUG] API 响应成功, 顶层键: [${Object.keys(json || {}).join(", ") || "(空)"}]`);
    if (json?.data) {
      console.log(`[XHS-DEBUG] API data 键: [${Object.keys(json.data).join(", ")}]`);
    }

    const items = json?.data?.items;
    if (!items || items.length === 0) {
      console.log("[XHS-DEBUG] API 返回 items 为空");
      return null;
    }

    console.log(`[XHS-DEBUG] API items 数量: ${items.length}`);
    const firstItemKeys = Object.keys(items[0] || {}).join(", ");
    console.log(`[XHS-DEBUG] API items[0] 键: [${firstItemKeys}]`);

    const note = items[0]?.note_card || items[0];
    if (!note || typeof note !== "object") {
      console.log("[XHS-DEBUG] API 返回 note 节点不存在");
      return null;
    }

    // 打印 note 节点结构
    console.log(`[XHS-DEBUG] API note 键: [${Object.keys(note).join(", ")}]`);

    const user = note.user || {};
    const interact = note.interact_info || {};
    console.log(`[XHS-DEBUG] API user 键: [${Object.keys(user).join(", ") || "(空)"}]`);
    console.log(`[XHS-DEBUG] API interact_info 键: [${Object.keys(interact).join(", ") || "(空)"}]`);
    console.log(`[XHS-DEBUG] API note.video: ${note.video ? "有" : "无"}, duration: ${note.video?.duration ?? "N/A"}`);

    const result: XHSPostData = {
      url: `https://www.xiaohongshu.com/explore/${noteId}`,
      title: note.title || note.display_title || "",
      content: note.desc || note.description || "",
      authorName: cleanAuthorName(user.nickname || user.nick_name || ""),
      authorFollowers:
        parseInt(user.follower_count || user.fans || "0", 10) || 0,
      likes: parseInt(interact.liked_count || note.liked_count || "0", 10) || 0,
      collects:
        parseInt(
          interact.collected_count || note.collected_count || "0",
          10
        ) || 0,
      comments:
        parseInt(interact.comment_count || note.comment_count || "0", 10) || 0,
      durationSeconds: note.video?.duration || null,
      publishedAt: safeToISOString(note.time),
      postType: _resolvePostType(note),
    };

    return result;
  } catch (err: any) {
    console.log(`[XHS-DEBUG] API 请求异常: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 从 HTML 中提取 window.__INITIAL_STATE__ 或等效 SSR JSON
 */
function extractInitialState(html: string): any | null {
  const markers = [
    "window.__INITIAL_STATE__",
    "window.__INITIAL_SERVER_STATE__",
    "window.__INITIAL_SSR_STATE__",
  ];

  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;

    console.log(`[XHS-DEBUG] 找到标记: "${marker}" 位置=${idx}`);

    const eqIdx = html.indexOf("=", idx);
    if (eqIdx === -1) {
      console.log(`[XHS-DEBUG] 未找到 = 号，跳过"${marker}"`);
      continue;
    }

    const afterEq = html.slice(eqIdx + 1);
    const trimmedStart = afterEq.search(/\S/);
    if (trimmedStart === -1) continue;

    const firstChar = afterEq[trimmedStart];
    const valueStart = eqIdx + 1 + trimmedStart;

    if (firstChar === "{") {
      // 形式 A: = {...}
      const result = extractBracketJSON(html, valueStart);
      if (result) {
        console.log(
          `[XHS-DEBUG] 括号计数提取成功 (直接JSON), JSON长度=${result.jsonStr.length}`
        );
        return result.data;
      }
      console.log(`[XHS-DEBUG] 括号计数提取失败 (直接JSON)`);
    } else if (firstChar === "'" || firstChar === '"') {
      // 形式 B: = '...' 或 = "..."
      const quote = firstChar;
      const innerStart = valueStart + 1;
      const innerEnd = findMatchingQuote(html, innerStart, quote);
      if (innerEnd !== -1) {
        const innerStr = html.slice(innerStart, innerEnd);
        try {
          return _parseJSONRelaxed(innerStr);
        } catch {
          console.log(
            `[XHS-DEBUG] 字符串包裹JSON解析失败, 前200字符: ${innerStr.slice(0, 200)}`
          );
        }
      }
    }
  }

  // ===== 备选: <script id="__NEXT_DATA__"> =====
  const nextDataMatch = html.match(
    /<script[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextDataMatch) {
    try {
      const parsed = JSON.parse(nextDataMatch[1]);
      console.log("[XHS-DEBUG] 从 __NEXT_DATA__ 提取成功");
      return parsed;
    } catch {
      console.log("[XHS-DEBUG] __NEXT_DATA__ JSON 解析失败");
    }
  }

  // ===== 备选: <script> 标签内模糊搜索 =====
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const scriptContent = scriptMatch[1];
    for (const marker of markers) {
      if (scriptContent.includes(marker)) {
        console.log(`[XHS-DEBUG] 在 <script> 标签内找到 "${marker}"`);
        const localIdx = scriptContent.indexOf(marker);
        const localEqIdx = scriptContent.indexOf("=", localIdx);
        if (localEqIdx !== -1) {
          const afterEq2 = scriptContent.slice(localEqIdx + 1);
          const ts2 = afterEq2.search(/\S/);
          if (ts2 !== -1 && afterEq2[ts2] === "{") {
            const result = extractBracketJSON(
              scriptContent,
              localEqIdx + 1 + ts2
            );
            if (result) {
              console.log(`[XHS-DEBUG] <script>内括号计数提取成功`);
              return result.data;
            }
          }
        }
      }
    }
  }

  console.log("[XHS-DEBUG] 所有标记均未找到，extractInitialState 返回 null");
  return null;
}

/**
 * 括号计数法提取完整 JSON 对象（仅双引号为字符串边界）
 */
function extractBracketJSON(
  html: string,
  braceIdx: number
): { jsonStr: string; data: any } | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = braceIdx;

  for (let i = braceIdx; i < html.length; i++) {
    const ch = html[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  if (depth !== 0) {
    console.log(`[XHS-DEBUG] 括号计数未闭合, depth=${depth}`);
    return null;
  }

  const jsonStr = html.slice(braceIdx, endIdx);
  console.log(`[XHS-DEBUG] 括号计数完成, JSON长度=${jsonStr.length}`);

  try {
    const data = _parseJSONRelaxed(jsonStr);
    return { jsonStr, data };
  } catch (err: any) {
    console.log(
      `[XHS-DEBUG] JSON解析失败. 错误: ${err.message?.slice(0, 80)}`
    );
    console.log(`[XHS-DEBUG] JSON前200字符: ${jsonStr.slice(0, 200)}`);
    console.log(`[XHS-DEBUG] JSON后200字符: ${jsonStr.slice(-200)}`);
    return null;
  }
}

/**
 * 查找匹配的引号（处理转义）
 */
function findMatchingQuote(
  str: string,
  start: number,
  quote: string
): number {
  for (let i = start; i < str.length; i++) {
    if (str[i] === "\\") {
      i++;
      continue;
    }
    if (str[i] === quote) {
      return i;
    }
  }
  return -1;
}

/**
 * 从 __INITIAL_STATE__ JSON 中提取帖子数据
 */
function parseFromInitialState(data: any, finalUrl: string): XHSPostData {
  try {
    let note = _findNoteNode(data);

    if (!note || _isNoteEmpty(note)) {
      if (note) {
        _debugLog("_findNoteNode 返回了空对象，启动深搜回退...");
      } else {
        _debugLog("_findNoteNode 返回 null，启动深搜回退...");
      }
      note = _deepSearchNote(data, 5);
    }

    if (!note || _isNoteEmpty(note)) {
      _debugLog("_deepSearchNote 也未找到有效节点，启动全树候选收集...");
      const candidates: any[] = [];
      _collectCandidates(data, candidates, 4);
      _debugLog(`全树收集到 ${candidates.length} 个候选节点`);
      candidates.sort((a, b) => _dataScore(b) - _dataScore(a));
      if (candidates.length > 0) {
        note = candidates[0];
        _debugLog(
          `选择最佳候选: _dataScore=${_dataScore(note)}, keys=[${Object.keys(note).join(", ")}]`
        );
      }
    }

    if (!note) {
      throw new Error("未找到帖子数据节点");
    }

    _dumpNoteDebug(note);

    // ===== 字段提取 =====

    const title =
      note.title || note.displayTitle || note.desc?.slice(0, 80) || "";

    const content = note.desc || note.description || "";

    const userNode =
      note.user ||
      note.owner ||
      note.author ||
      note.note_card?.user ||
      {};
    const authorName = cleanAuthorName(
      userNode.nickname ||
        userNode.nickName ||
        userNode.name ||
        userNode.username ||
        ""
    );

    const authorFollowers = _extractNumber([
      ...FOLLOWER_KEYS.map((k) => userNode[k]),
      ...FOLLOWER_KEYS.map((k) => note.user?.[k]),
      note.interactInfo?.followerCount,
      note.stat?.followerCount,
      note.authorFollowers,
      note.followers,
    ]);

    const interactNode =
      note.interactInfo ||
      note.note_card?.interact_info ||
      note.note_card ||
      note.stat ||
      note.interaction ||
      note;
    const likes = _extractNumber([
      ...LIKE_KEYS.map((k) => interactNode[k]),
      ...LIKE_KEYS.map((k) => note[k]),
    ]);
    const collects = _extractNumber([
      ...COLLECT_KEYS.map((k) => interactNode[k]),
      ...COLLECT_KEYS.map((k) => note[k]),
    ]);
    const comments = _extractNumber([
      ...COMMENT_KEYS.map((k) => interactNode[k]),
      ...COMMENT_KEYS.map((k) => note[k]),
    ]);

    _debugLog("=== interactNode 字段结构 ===");
    _dumpKeys(interactNode, "interactNode", 1);
    _debugLog("=== userNode 字段结构 ===");
    _dumpKeys(userNode, "userNode", 1);

    const videoNode = note.video || note.videoInfo || {};
    const durationSeconds =
      videoNode.duration || note.duration || note.durationSeconds || null;

    const timeStamp =
      note.time ||
      note.createTime ||
      note.publishTime ||
      note.create_time ||
      note.publishDate ||
      note.publishedAt ||
      note.updatedAt ||
      note.timestamp;
    const publishedAt = safeToISOString(timeStamp);

    _debugLog(`parseFromInitialState 提取摘要: likes=${likes}, collects=${collects}, comments=${comments}, followers=${authorFollowers}, duration=${durationSeconds}, publishedAt=${publishedAt}, timeStamp=${timeStamp}, postType=${_resolvePostType(note)}`);

    return {
      url: finalUrl,
      title,
      content,
      authorName,
      authorFollowers,
      likes,
      collects,
      comments,
      durationSeconds,
      publishedAt,
      postType: _resolvePostType(note),
      rawData: data,
    };
  } catch (err: any) {
    throw new Error(`解析小红书数据失败: ${err.message}`);
  }
}

/**
 * 多路径查找 note 节点
 */
function _findNoteNode(data: any): any | null {
  _debugLog("=== STATE 顶层结构 ===");
  _dumpKeys(data, "STATE", 1);

  // 路径 1：详情页 noteDetailMap
  if (data?.note?.noteDetailMap) {
    const entries = Object.values(data.note.noteDetailMap) as any[];
	    const keys = Object.keys(data.note.noteDetailMap);
    _debugLog(`noteDetailMap 含 ${entries.length} 个条目 (keys: [${keys.join(", ")}])`);
    if (entries.length > 0) {
      const entry = entries[0];
      _debugLog(`entry (顶层) 键: [${Object.keys(entry || {}).join(", ")}]`);
      const note = entry?.note;
      if (note) {
        _debugLog(`entry.note 键: [${Object.keys(note).join(", ")}]`);
        for (const key of [
          "interactInfo",
          "user",
          "note_card",
          "video",
          "stat",
          "interaction",
        ]) {
          if (entry[key] != null && note[key] == null) {
            note[key] = entry[key];
          }
        }
        if (_isNoteEmpty(note)) {
          _debugLog(
            "entry.note 合并后仍为空，改用 entry 本身作为 note 节点"
          );
          if (!_isNoteEmpty(entry)) {
            return entry;
          }
          return null;
        }
        return note;
      }
      _debugLog(`entry.note 为 null/undefined，尝试使用 entry 本身`);
      return entry || null;
    }
  }

  // 路径 2：列表页
  if (data?.note) {
    if (Array.isArray(data.note)) {
      for (const item of data.note) {
        const found = item?.noteList?.[0] || item?.note || item;
        if (found && (found.title || found.desc)) return found;
      }
    }
    if (data.note.noteList) {
      const list = Array.isArray(data.note.noteList)
        ? data.note.noteList
        : data.note.noteList[0];
      if (Array.isArray(list) && list.length > 0)
        return list[0]?.note || list[0];
    }
    if (data.note.title || data.note.desc) return data.note;
  }

  return null;
}

/**
 * 深搜 STATE 树中可能的 note 节点
 */
function _deepSearchNote(obj: any, depth: number): any | null {
  if (!obj || typeof obj !== "object" || depth <= 0) return null;
  if (obj.title || obj.desc) {
    _debugLog(
      `_deepSearchNote: 找到候选(depth=${depth}), keys=[${Object.keys(obj).slice(0, 20).join(", ")}]`
    );
    return obj;
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object") {
      const found = _deepSearchNote(val, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 判断 note 节点是否为一个"有效空对象"
 */
function _isNoteEmpty(note: any): boolean {
  if (!note || typeof note !== "object") return true;
  const usefulFields = [
    "title", "desc", "displayTitle", "description",
    "noteId", "note_id", "id",
    "user", "interactInfo", "noteCard", "note_card",
    "interaction", "stat",
    "likedCount", "liked_count", "likes",
    "collectedCount", "collected_count", "collects",
    "commentCount", "comment_count", "comments",
    "type", "video", "videoInfo",
    "time", "createTime", "publishTime",
  ];
  return !usefulFields.some((f) => note[f] != null);
}

/**
 * 递归遍历对象树，收集所有包含帖子特征字段的候选节点
 */
function _collectCandidates(
  obj: any,
  candidates: any[],
  maxDepth: number,
  currentDepth: number = 0
): void {
  if (!obj || typeof obj !== "object" || currentDepth > maxDepth) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      _collectCandidates(item, candidates, maxDepth, currentDepth + 1);
    }
    return;
  }

  const hasField = CANDIDATE_NOTE_FIELDS.some((f) => obj[f] != null);
  if (hasField) {
    candidates.push(obj);
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object") {
      _collectCandidates(val, candidates, maxDepth, currentDepth + 1);
    }
  }
}

function _dataScore(obj: any): number {
  if (!obj || typeof obj !== "object") return 0;
  let score = 0;
  if (obj.title) score += 10;
  if (obj.desc || obj.description) score += 10;
  if (obj.displayTitle) score += 5;
  if (obj.interactInfo || obj.interaction || obj.stat) score += 8;
  if (obj.likedCount || obj.liked_count || obj.likes) score += 8;
  if (obj.collectedCount || obj.collected_count || obj.collects) score += 5;
  if (obj.commentCount || obj.comment_count || obj.comments) score += 5;
  if (obj.user || obj.owner || obj.author) score += 8;
  if (obj.type) score += 3;
  if (obj.noteId || obj.note_id || obj.id) score += 5;
  if (obj.video || obj.videoInfo) score += 5;
  return score;
}

/**
 * 从一组候选值中提取第一个有效数字
 */
function _extractNumber(
  candidates: (number | string | null | undefined)[]
): number {
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === "number") {
      if (c > 0 && c < 1000000000) return Math.round(c);
      continue;
    }
    if (typeof c === "string") {
      const wanMatch = c.match(/^([\d.]+)\s*[万wW]/);
      if (wanMatch) return Math.round(parseFloat(wanMatch[1]) * 10000);
      const plusMatch = c.match(/^([\d.]+)\+/);
      if (plusMatch) return Math.round(parseFloat(plusMatch[1]));
      const n = parseFloat(c);
      if (!isNaN(n) && n > 0) return Math.round(n);
    }
  }
  return 0;
}

// ========== 候选收集常量 ==========

const CANDIDATE_NOTE_FIELDS = [
  "title", "desc", "displayTitle",
  "likedCount", "liked_count", "likes",
  "collectedCount", "collected_count", "collects",
  "commentCount", "comment_count", "comments",
  "interactInfo", "interaction", "stat",
  "noteId", "note_id",
  "user", "type", "video",
];

// ========== 增强降级解析 ==========

function parseFromHTMLEnhanced(html: string, finalUrl: string): XHSPostData {
  const $ = cheerio.load(html);

  const scriptData = searchScriptTagsForNoteData(html, $);
  if (scriptData) {
    console.log("[XHS-DEBUG] 增强降级: 从 <script> 标签提取到帖子JSON");
    return {
      url: finalUrl,
      title: scriptData.title || "",
      content: scriptData.content || "",
      authorName: scriptData.authorName || "",
      authorFollowers: scriptData.authorFollowers ?? 0,
      likes: scriptData.likes ?? 0,
      collects: scriptData.collects ?? 0,
      comments: scriptData.comments ?? 0,
      durationSeconds: scriptData.durationSeconds ?? null,
      publishedAt: scriptData.publishedAt ?? null,
      postType: scriptData.postType || "note",
      rawData: scriptData._raw,
    };
  }

  const jsonLdData = extractJsonLD($);
  if (jsonLdData) {
    console.log("[XHS-DEBUG] 增强降级: 从 JSON-LD 提取到数据");
    return {
      url: finalUrl,
      title: jsonLdData.title || "",
      content: jsonLdData.content || "",
      authorName: jsonLdData.authorName || "",
      authorFollowers: jsonLdData.authorFollowers ?? 0,
      likes: jsonLdData.likes ?? 0,
      collects: jsonLdData.collects ?? 0,
      comments: jsonLdData.comments ?? 0,
      durationSeconds: jsonLdData.durationSeconds ?? null,
      publishedAt: jsonLdData.publishedAt ?? null,
      postType: jsonLdData.postType || "note",
    };
  }

  console.log("[XHS-DEBUG] 增强降级: 使用 meta/OG 标签（数据不完整）");
  const title =
    $('meta[property="og:title"]').attr("content") || $("title").text() || "";
  const content =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";
  const authorName = cleanAuthorName(
    $('meta[name="author"]').attr("content") ||
      $('meta[property="article:author"]').attr("content") ||
      ""
  );

  const ogLikes =
    parseInt(
      $('meta[property="og:likes"]').attr("content") ||
        $('meta[property="og:like_count"]').attr("content") ||
        "0",
      10
    ) || 0;

  const ogPublished =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[property="og:published_time"]').attr("content") ||
    null;

  return {
    url: finalUrl,
    title: cleanText(title),
    content: cleanText(content),
    authorName: cleanText(authorName),
    authorFollowers: 0,
    likes: ogLikes,
    collects: 0,
    comments: 0,
    durationSeconds: null,
    publishedAt: safeToISOString(ogPublished),
    postType: "note" as const,
  };
}

function searchScriptTagsForNoteData(
  html: string,
  $: cheerio.CheerioAPI
): (Partial<XHSPostData> & { _raw?: any }) | null {
  const noteFeatures = [
    "note_id", "noteId", "noteid",
    "liked_count", "likedCount",
    "collected_count", "collectedCount",
    "comment_count", "commentCount",
    "nickname", "nickName",
  ];

  const scripts = $("script").toArray();

  for (const scriptEl of scripts) {
    const scriptContent = $(scriptEl).html() || "";
    if (scriptContent.length < 100) continue;

    const hasFeature = noteFeatures.some((f) => scriptContent.includes(f));
    if (!hasFeature) continue;

    console.log(
      `[XHS-DEBUG] 发现疑似帖子数据的<script>标签, 长度=${scriptContent.length}`
    );

    const extracted = tryExtractAnyJSON(scriptContent);
    if (!extracted) continue;

    const noteNode = _deepSearchNote(extracted, 6);
    if (!noteNode) {
      if (extracted.title || extracted.note_id || extracted.noteId) {
        return buildPartialFromRaw(extracted, extracted);
      }
      continue;
    }

    const result = buildPartialFromRaw(noteNode, extracted);
    if (result.title || result.authorName) {
      return result;
    }
  }

  return null;
}

function tryExtractAnyJSON(str: string): any | null {
  const candidates: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(str.slice(start, i + 1));
        start = -1;
      }
    }
  }

  candidates.sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    if (candidate.length < 50) continue;
    try {
      return _parseJSONRelaxed(candidate);
    } catch {
      // 继续尝试下一个
    }
  }

  return null;
}

function extractJsonLD($: cheerio.CheerioAPI): Partial<XHSPostData> | null {
  const ldJson = $('script[type="application/ld+json"]').toArray();
  for (const el of ldJson) {
    const rawText = $(el).html();
    if (!rawText) continue;
    try {
      const data = JSON.parse(rawText);
      if (!data) continue;

      const headline = data.headline || data.name || "";
      const desc = data.description || data.articleBody || "";
      const author = data.author?.name || data.creator?.name || "";
      const datePublished = data.datePublished || data.dateCreated || null;
      const interactionCount = data.interactionStatistic
        ? (Array.isArray(data.interactionStatistic)
            ? data.interactionStatistic
            : [data.interactionStatistic]
          ).reduce((acc: any, s: any) => {
            acc[s.interactionType?.toLowerCase?.() || ""] =
              s.userInteractionCount || 0;
            return acc;
          }, {} as Record<string, number>)
        : {};

      if (headline || desc) {
        return {
          title: cleanText(headline),
          content: cleanText(desc),
          authorName: cleanText(author),
          authorFollowers: 0,
          likes:
            interactionCount.like ||
            interactionCount.likes ||
            interactionCount.likeaction ||
            0,
          collects: interactionCount.collect || interactionCount.save || 0,
          comments:
            interactionCount.comment || interactionCount.comments || 0,
          durationSeconds: null,
          publishedAt: datePublished
            ? new Date(datePublished).toISOString()
            : null,
          postType: "note" as const,
        };
      }
    } catch {
      // JSON-LD parse 失败，继续下一个
    }
  }
  return null;
}

function buildPartialFromRaw(
  node: any,
  rawData: any
): Partial<XHSPostData> & { _raw?: any } {
  const userNode =
    node.user ||
    node.owner ||
    node.author ||
    node.note_card?.user ||
    node.authorInfo ||
    {};
  const interactNode =
    node.interactInfo ||
    node.note_card?.interact_info ||
    node.stat ||
    node.interaction ||
    node;

  return {
    title:
      node.title || node.displayTitle || node.desc?.slice(0, 80) || "",
    content: node.desc || node.description || node.content || "",
    authorName: cleanAuthorName(
      userNode.nickname ||
        userNode.nickName ||
        userNode.name ||
        userNode.username ||
        ""
    ),
    authorFollowers: _extractNumber(FOLLOWER_KEYS.map((k) => userNode[k])),
    likes: _extractNumber([
      ...LIKE_KEYS.map((k) => interactNode[k]),
      ...LIKE_KEYS.map((k) => node[k]),
    ]),
    collects: _extractNumber([
      ...COLLECT_KEYS.map((k) => interactNode[k]),
      ...COLLECT_KEYS.map((k) => node[k]),
    ]),
    comments: _extractNumber([
      ...COMMENT_KEYS.map((k) => interactNode[k]),
      ...COMMENT_KEYS.map((k) => node[k]),
    ]),
    durationSeconds:
      node.video?.duration || node.videoInfo?.duration || node.duration || null,
    publishedAt: safeToISOString(
      node.time || node.createTime || node.publishTime || node.timestamp
    ),
    postType: _resolvePostType(node),
    _raw: rawData,
  };
}

// ========== 调试工具 ==========

function _debugLog(msg: string): void {
  console.log(`[XHS-DEBUG] ${msg}`);
}

function _dumpKeys(obj: any, label: string, depth: number): void {
  if (!obj || typeof obj !== "object" || depth < 0) return;
  if (Array.isArray(obj)) {
    _debugLog(`${label}: Array[${obj.length}]`);
    if (obj.length > 0 && depth > 0)
      _dumpKeys(obj[0], `${label}[0]`, depth - 1);
    return;
  }
  const keys = Object.keys(obj);
  _debugLog(`${label}: { ${keys.join(", ")} }`);
  for (const key of keys) {
    const val = obj[key];
    const type = typeof val;
    if (type === "object" && val !== null && depth > 0) {
      if (Array.isArray(val)) {
        _debugLog(`  ${key}: Array[${val.length}]`);
        if (val.length > 0 && depth > 1)
          _dumpKeys(val[0], `  ${key}[0]`, depth - 2);
      } else {
        _dumpKeys(val, `  ${label}.${key}`, depth - 1);
      }
    } else {
      const preview =
        type === "string"
          ? val.length > 80
            ? val.slice(0, 80) + "..."
            : val
          : val;
      _debugLog(`  ${key}: ${type} = ${preview}`);
    }
  }
}

/**
 * 打印各策略的提取结果摘要，方便诊断哪个字段缺失
 */
function _logExtractionResult(r: XHSPostData, label: string): void {
  _debugLog(`=== ${label} 提取完成 ===`);
  _debugLog(`  title: ${r.title ? r.title.slice(0, 50) : "(空)"}`);
  _debugLog(`  authorName: ${r.authorName || "(空)"}`);
  _debugLog(`  likes: ${r.likes}`);
  _debugLog(`  collects: ${r.collects}`);
  _debugLog(`  comments: ${r.comments}`);
  _debugLog(`  authorFollowers: ${r.authorFollowers}`);
  _debugLog(`  durationSeconds: ${r.durationSeconds ?? "(null)"}`);
  _debugLog(`  publishedAt: ${r.publishedAt ?? "(null)"}`);
  _debugLog(`  postType: ${r.postType || "note"}`);
  _debugLog(`  content长度: ${r.content?.length || 0}`);
  _debugLog(`=== ${label} 摘要结束 ===`);
}

function safeToISOString(value: unknown): string | null {
  if (value == null) return null;
  let ms: number;
  if (typeof value === "number") {
    ms = value < 9999999999 ? value * 1000 : value;
  } else {
    ms = new Date(value as any).getTime();
  }
  if (isNaN(ms) || ms < 0) return null;
  return new Date(ms).toISOString();
}

function cleanText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
