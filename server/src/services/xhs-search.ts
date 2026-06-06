/**
 * 小红书链接自动搜索服务
 *
 * 根据关键词通过搜索引擎查找小红书爆款链接，
 * 返回链接列表，后续交给 xhs-scraper 解析完整内容。
 *
 * 策略：
 *   - "bing"   : Bing 搜索（默认，零依赖）
 *   - "opencli": OpenCLI 浏览器控制（需 Chrome 扩展）
 */

import * as cheerio from "cheerio";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { FILTER_THRESHOLDS } from "../types";
import { cleanAuthorName } from "./xhs-scraper";
import { normalizeXHSLink } from "../utils";

const execFileAsync = promisify(execFile);

// OpenCLI main.js 的路径（直接用 node 调用，避免 Windows shell 对 URL 中 & 的解析问题）
const OPENCLI_MAIN = `${homedir()}/AppData/Roaming/npm/node_modules/@jackwener/opencli/dist/src/main.js`;

/** 运行 opencli 命令，返回 stdout（不经过 shell，避免 & 等特殊字符被解析） */
async function runOpenCLI(args: string[], timeoutMs = 15_000): Promise<string> {
  const { stdout } = await execFileAsync("node", [OPENCLI_MAIN, ...args], {
    timeout: timeoutMs,
  });
  return stdout;
}

// ========== 类型 ==========

// ⚠️ 与 client/src/types.ts 中的 XHSSearchResult 保持同步
// 服务端 postType 使用字面量 "video"|"note"，客户端使用 XHSPostType（等价）
export interface XHSSearchResult {
  url: string;
  title: string;
  snippet: string;
  keyword: string; // 触发该结果的关键词
  xsecToken?: string; // 小红书搜索结果的访问令牌，用于在浏览器中打开帖子详情页
  postType?: "video" | "note"; // 帖子类型：视频或图文
  likes?: number; // 点赞数（用于预筛选）
  matchPercent?: number; // 四维预筛选匹配度均值（0-100），用于前端排序和筛选
}

export interface AutoSearchOutput {
  urls: string[];
  searchResults: XHSSearchResult[];
  stats: {
    keywordsSearched: number;
    totalLinksFound: number;
    uniqueLinks: number;
  };
}

export type SearchStrategy = "bing" | "opencli";

// ========== 主入口 ==========

export async function searchXHSLinks(
  keywords: string[],
  options?: {
    strategy?: SearchStrategy;
    limit?: number; // 最多返回多少条链接（去重后）
    maxPerKeyword?: number; // 每个关键词最多取几条
  }
): Promise<AutoSearchOutput> {
  const strategy = options?.strategy ?? "opencli";

  switch (strategy) {
    case "bing":
      return searchViaBing(keywords, options);
    case "opencli":
      try {
        return await searchViaOpenCLI(keywords, options);
      } catch (err: any) {
        // OpenCLI 不可用时自动回退到 Bing 搜索
        console.log(`OpenCLI 搜索失败（${err.message || err}），自动回退到 Bing 搜索`);
        return searchViaBing(keywords, options);
      }
    default:
      throw new Error(`未知搜索策略: ${strategy}`);
  }
}

// ========== 方案 A: Bing 搜索 ==========

async function searchViaBing(
  keywords: string[],
  options?: { limit?: number; maxPerKeyword?: number }
): Promise<AutoSearchOutput> {
  const maxPerKeyword = options?.maxPerKeyword ?? 5;
  const limit = options?.limit ?? 20;

  const allResults: XHSSearchResult[] = [];
  const seenUrls = new Set<string>();

  // 取前 N 个关键词（避免搜索过多）
  const searchKeywords = keywords.slice(0, 8);

  for (const keyword of searchKeywords) {
    try {
      const results = await searchBingForKeyword(keyword, maxPerKeyword);

      for (const r of results) {
        // 四维预筛选（不再丢弃，仅附加 matchPercent 供前端排序）
        const filter = preFilterSearchResult(r);

        const normalized = normalizeXHSLink(r.url);
        if (!seenUrls.has(normalized)) {
          seenUrls.add(normalized);
          allResults.push({ ...r, url: normalized, matchPercent: filter.avgMatchPercent });
        }
      }

      // 达到限制则停止
      if (allResults.length >= limit) break;

      // 关键词间延迟，避免 Bing 限流
      await sleep(500);
    } catch {
      // 单个关键词搜索失败不中断整体
    }
  }

  // 限制：图文最多5篇 + 视频最多5篇（共10篇），各自按匹配度从高到低排序
  const videos = allResults
    .filter((r) => r.postType === "video")
    .sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0))
    .slice(0, 5);
  const notes = allResults
    .filter((r) => r.postType !== "video")
    .sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0))
    .slice(0, 5);
  const limitedResults = [...videos, ...notes].slice(0, limit);

  return {
    urls: limitedResults.map((r) => r.url),
    searchResults: limitedResults,
    stats: {
      keywordsSearched: searchKeywords.length,
      totalLinksFound: allResults.length,
      uniqueLinks: seenUrls.size,
    },
  };
}

async function searchBingForKeyword(
  keyword: string,
  maxResults: number
): Promise<XHSSearchResult[]> {
  // 同时尝试多种搜索词，提高命中率
  const queries = [
    `site:xiaohongshu.com ${keyword}`,
    `xiaohongshu.com ${keyword}`,
    `小红书 ${keyword}`,
  ];

  const allResults: XHSSearchResult[] = [];
  const seen = new Set<string>();

  for (const rawQuery of queries) {
    if (allResults.length >= maxResults) break;
    try {
      const results = await searchBingOnce(rawQuery, keyword);
      for (const r of results) {
        const norm = normalizeXHSLink(r.url);
        if (!seen.has(norm)) {
          seen.add(norm);
          allResults.push(r);
        }
      }
    } catch {
      // 单个查询失败不中断
    }
    if (allResults.length >= maxResults) break;
    await sleep(300);
  }

  return allResults.slice(0, maxResults);
}

async function searchBingOnce(
  rawQuery: string,
  keyword: string
): Promise<XHSSearchResult[]> {
  const query = encodeURIComponent(rawQuery);
  const url = `https://www.bing.com/search?q=${query}&count=30`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Bing 返回 HTTP ${response.status}`);
    }

    const html = await response.text();
    return extractLinksFromBing(html, keyword);
  } finally {
    clearTimeout(timeout);
  }
}

function extractLinksFromBing(
  html: string,
  keyword: string
): XHSSearchResult[] {
  const $ = cheerio.load(html);
  const results: XHSSearchResult[] = [];

  // Bing 搜索结果在 <li class="b_algo"> 块中
  // 每个块包含：<h2><a href="...">标题</a></h2> + <cite>URL</cite> + <p>摘要</p>
  $(".b_algo").each((_, block) => {
    const $block = $(block);

    // 从 cite 标签获取真实 URL（Bing 对结果链接做跳转包装时，cite 显示的是目标域名）
    const citeText = $block.find("cite").text().trim();

    // 从 h2 中的链接尝试直接提取
    let url = "";
    let title = "";
    const $h2Link = $block.find("h2 a").first();
    if ($h2Link.length) {
      const href = $h2Link.attr("href") || "";
      url = extractRealUrl(href) || "";
      title = $h2Link.text().trim();
    }

    // 如果链接提取失败，尝试从 cite 构建
    if (!url && citeText) {
      url = citeText;
      if (!url.startsWith("http")) url = "https://" + url;
    }

    if (!url || !isXHSDomain(url)) return;

    const snippet = $block.find(".b_caption p, .b_lineclamp2 p").first().text().trim()
      || $block.find("p").first().text().trim()
      || "";

    results.push({
      url,
      title: title || citeText || url,
      snippet,
      keyword,
      postType: "note" as const, // Bing 搜索无法区分视频/图文，默认标为图文
    });
  });

  // 如果上面的结构化提取没找到，回退到扫描所有链接
  if (results.length === 0) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const extracted = extractRealUrl(href);
      if (!extracted || !isXHSDomain(extracted)) return;
      results.push({
        url: extracted,
        title: $(el).text().trim().slice(0, 80) || extracted,
        snippet: $(el).closest("li, div").find("p").first().text().trim() || "",
        keyword,
        postType: "note" as const,
      });
    });
  }

  return results;
}

/**
 * 从 Bing 包装链接或内部跳转中提取真实 URL
 */
function extractRealUrl(href: string): string | null {
  if (!href || href.startsWith("javascript:") || href === "#") return null;

  // Bing 的 click-tracking 重定向: https://www.bing.com/ck/a?!&&p=...&u=REAL_URL
  if (href.includes("bing.com/ck/a")) {
    const match = href.match(/[?&]u=([^&]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return null;
      }
    }
  }

  // Bing 内部导航链接（不是搜索结果，跳过）
  if (href.startsWith("/")) return null;

  // 直接外部链接
  if (href.startsWith("http")) return href;

  return null;
}

function isXHSDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "xiaohongshu.com" ||
      hostname.endsWith(".xiaohongshu.com") ||
      hostname === "xhslink.com" ||
      hostname.endsWith(".xhslink.com")
    );
  } catch {
    return false;
  }
}

// ========== 方案 B: OpenCLI 搜索（Chrome 扩展 + 小红书已登录） ==========

async function searchViaOpenCLI(
  keywords: string[],
  options?: { limit?: number; maxPerKeyword?: number }
): Promise<AutoSearchOutput> {
  const limit = options?.limit ?? 20;
  const maxPerKeyword = options?.maxPerKeyword ?? 10;

  const allResults: XHSSearchResult[] = [];
  const seenUrls = new Set<string>();
  const searchKeywords = keywords.slice(0, 5);

  const errors: string[] = [];

  for (const keyword of searchKeywords) {
    try {
      const results = await searchXHSWithBrowser(keyword, maxPerKeyword);

      for (const r of results) {
        // 四维预筛选（不再丢弃，仅附加 matchPercent 供前端排序）
        const filter = preFilterSearchResult(r);
        const normalized = normalizeXHSLink(r.url);
        if (!seenUrls.has(normalized)) {
          seenUrls.add(normalized);
          allResults.push({ ...r, url: normalized, matchPercent: filter.avgMatchPercent });
        }
      }

      if (allResults.length >= limit) break;
      await sleep(500);
    } catch (err: any) {
      const msg = err.message || String(err);
      console.error(`[xhs-search] OpenCLI 搜索 "${keyword}" 失败:`, msg);
      errors.push(msg);
    }
  }

  // 如果所有关键词都失败且没有找到任何结果，抛出错误以触发 Bing 回退
  if (allResults.length === 0 && errors.length > 0 && errors.length === searchKeywords.length) {
    throw new Error(`OpenCLI 搜索全部 ${searchKeywords.length} 个关键词均失败，可能需要登录小红书。首个错误: ${errors[0]}`);
  }

  // 限制：图文最多5篇 + 视频最多5篇（共10篇），各自按匹配度从高到低排序
  const videos = allResults
    .filter((r) => r.postType === "video")
    .sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0))
    .slice(0, 5);
  const notes = allResults
    .filter((r) => r.postType !== "video")
    .sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0))
    .slice(0, 5);
  const limitedResults = [...videos, ...notes].slice(0, limit);
  console.log(`[xhs-search] 搜索完成：videos=${videos.length}, notes=${notes.length}, totalLimited=${limitedResults.length}, rawTotal=${allResults.length}`);

  return {
    urls: limitedResults.map((r) => r.url),
    searchResults: limitedResults,
    stats: {
      keywordsSearched: searchKeywords.length,
      totalLinksFound: allResults.length,
      uniqueLinks: seenUrls.size,
    },
  };
}

/**
 * 通过浏览器控制搜索单个关键词，提取笔记链接
 */
async function searchXHSWithBrowser(
  keyword: string,
  maxResults: number
): Promise<XHSSearchResult[]> {
  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;

  // 1. 打开搜索页面
  await runOpenCLI(["browser", "xhs", "open", searchUrl], 15_000);

  // 2. 等待页面加载
  await sleep(1500);

  // 3. 检查页面是否有结果（快速判断是否需要 eval）
  const linkJson = await runOpenCLI([
    "browser", "xhs", "find",
    "--css", ".note-item",
    "--limit", "1",
  ], 10_000);

  const linkData = JSON.parse(linkJson);
  if (!linkData?.entries?.length) return [];

  // 4. 使用 eval 一次性提取所有 note-item 的信息（含 xsec_token、postType、likes 数字）
  const evalCode = `(() => { const items = document.querySelectorAll('.note-item'); return Array.from(items).slice(0, ${maxResults}).map(item => { const titleEl = item.querySelector('.title'); const authorEl = item.querySelector('.author'); const likeEl = item.querySelector('.like-count, .count'); const coverLink = item.querySelector('a.cover'); const href = titleEl?.getAttribute('href') || coverLink?.getAttribute('href') || ''; const searchLink = item.querySelector('a[href*=\\\"search_result\\\"]')?.getAttribute('href') || ''; const noteId = href.split('/').pop()?.split('?')[0] || ''; const xsecToken = searchLink.match(/xsec_token=([^&]+)/)?.[1] || ''; const hasPlayIcon = !!(item.querySelector('[class*=\\\"play\\\"], [class*=\\\"duration\\\"], [class*=\\\"video-icon\\\"], .play-icon, .duration')); const likesText = likeEl?.textContent?.trim() || ''; let likesNum = 0; if (likesText) { const n = likesText.endsWith('万') ? parseFloat(likesText) * 10000 : parseInt(likesText, 10); if (!isNaN(n)) likesNum = n; } return { url: noteId ? 'https://www.xiaohongshu.com/explore/' + noteId : '', title: titleEl?.textContent?.trim() || '', author: authorEl?.textContent?.trim() || '', likes: likesText, likesNum, postType: hasPlayIcon ? 'video' : 'note', xsecToken }; }).filter(n => n.url); })()`;

  const notesJson = await runOpenCLI([
    "browser", "xhs", "eval",
    evalCode,
  ], 10_000);

  const notes = JSON.parse(notesJson);

  // 5. 映射为标准格式
  const results: XHSSearchResult[] = [];
  for (const note of notes) {
    if (!note.url) continue;
    // 分离作者和日期（支持多种日期格式：03-27、2025-05-28、2天前、3小时前）
    // 同时清理"关注"后缀（搜索页面作者名有时附带关注按钮文本）
    const authorClean = cleanAuthorName(
      (note.author || "").replace(/(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d+天前|\d+小时前|\d+分钟前).*$/, "")
    );
    const snippet = [authorClean, note.likes ? `👍 ${note.likes}` : ""]
      .filter(Boolean).join(" · ");
    results.push({
      url: note.url,
      title: note.title,
      snippet,
      keyword,
      xsecToken: note.xsecToken || undefined,
      postType: note.postType || "note",
      likes: note.likesNum || 0,
    });
  }

  return results;
}

// ========== 通过浏览器解析帖子详情 ==========

export interface ParsedPostData {
  title: string;
  desc: string;
  authorName: string;
  likes: number;
  collects: number;
  comments: number;
  authorFollowers?: number;
  /** 发布时间原始文本（如 "2025-05-28"、"2天前"、"6月6日"） */
  publishedAt?: string;
  /** 视频时长（秒），图文帖子为 undefined */
  durationSeconds?: number;
}

/**
 * 通过 OpenCLI 浏览器打开帖子详情页并提取内容
 * 需要用户已登录小红书（Chrome 中保持登录状态）
 */
export async function parsePostWithOpenCLI(
  url: string,
  xsecToken?: string
): Promise<ParsedPostData | null> {
  try {
    // 构建带 token 的 URL（优先使用 search_result 路径）
    const openUrl = xsecToken
      ? url.replace("/explore/", "/search_result/") + `?xsec_token=${xsecToken}&xsec_source=`
      : url;

    // 1. 打开帖子页面
    await runOpenCLI(["browser", "xhs", "open", openUrl], 15_000);

    // 2. 等待页面加载
    await sleep(2000);

    // 3. 用 extract 命令获取页面内容（markdown 格式）
    const extractJson = await runOpenCLI(["browser", "xhs", "extract"], 15_000);
    const extractData = JSON.parse(extractJson);
    const markdown = extractData?.content || "";

    if (!markdown || markdown.length < 100) return null;

    // 4. 从 markdown 中解析帖子描述
    // 帖子正文通常在标题之后、评论区之前
    const desc = extractPostDesc(markdown, extractData?.title || "");

    if (!desc) return null;

    // 4b. 从 markdown 中提取粉丝数、视频时长、发布时间
    //     （这些字段在 DOM 中可能不可见，但 extract 命令的 markdown 包含全部页面文本）
    const mdFollowers = extractFollowersFromMarkdown(markdown);
    const mdDuration = extractDurationFromMarkdown(markdown);
    const mdPublishedAt = extractTimeFromMarkdown(markdown);

    // 5. 用 eval 提取结构化数据（点赞、收藏、评论、作者名 —— markdown 无法精确提取的）
    //    使用更精确的 XHS DOM 选择器，覆盖多种页面结构
    let stats = {
      likes: 0, collects: 0, comments: 0,
      authorFollowers: 0, authorName: "",
      publishedAt: "", durationSeconds: undefined as number | undefined,
    };
    try {
      const statsJson = await runOpenCLI([
        "browser", "xhs", "eval",
        // 增强的 eval 脚本：分别提取互动数据、作者名、粉丝数、发布时间、视频时长
        `(() => {

  // 互动数据：优先从 engage-bar / interact 区域提取
  const nums = [];
  const barLeft = document.querySelectorAll([
    '.engage-bar [class*="left"] span',
    '[class*="engage"] [class*="left"] span',
    '.interact [class*="left"] .count',
    '[class*="interact"] [class*="left"] span',
  ].join(', '));
  barLeft.forEach(el => {
    const t = el.textContent ? el.textContent.trim() : '';
    if (t && /^[\\d,.万+]+$/.test(t)) nums.push(t);
  });

  // 回退：扫描所有带互动类名的 span
  if (nums.length < 3) {
    const fallbackEls = document.querySelectorAll([
      '[class*="like"] span',
      '[class*="collect"] span',
      '[class*="comment"] span',
      '[class*="chat"] span',
    ].join(', '));
    const seen = new Set(nums);
    fallbackEls.forEach(el => {
      const t = el.textContent ? el.textContent.trim() : '';
      if (t && /^[\\d,.万+]+$/.test(t) && !seen.has(t)) {
        seen.add(t);
        nums.push(t);
      }
    });
  }

  // 作者名
  const authorEl = document.querySelector([
    '.username', '.author-name', '[class*="nickname"]',
    '.name', '[class*="author"] .name',
  ].join(', '));
  const authorName = authorEl ? (authorEl.textContent || '').trim() : '';

  // 粉丝数 —— 优先在作者信息区域搜索，避免匹配评论区/侧边栏推荐
  let followers = '';
  const findFollowersInScope = (root) => {
    const els = root.querySelectorAll('span, div, a');
    for (const el of els) {
      const text = (el.textContent || '').trim();
      const m = text.match(/([\d,.]+万?)\s*粉丝/);
      if (m) return m[1];
    }
    return '';
  };
  // 策略1：在作者名附近的容器中搜索（最可靠，避免全页误匹配）
  if (authorName) {
    let container = authorEl;
    for (let i = 0; i < 6 && container; i++) {
      const f = findFollowersInScope(container);
      if (f) { followers = f; break; }
      container = container.parentElement;
    }
  }
  // 策略2：专用 CSS 选择器定位作者/profile 区域搜索
  if (!followers) {
    const profileAreas = document.querySelectorAll([
      '[class*="author"]', '[class*="profile"]',
      '[class*="user-info"]', '[class*="user"]', '[class*="info"]',
    ].join(', '));
    for (const area of profileAreas) {
      const f = findFollowersInScope(area);
      if (f) { followers = f; break; }
    }
  }
  // 策略3：回退到评论区之前的主内容区域
  if (!followers) {
    const commentSection = document.querySelector([
      '[class*="comment"]', '[class*="reply"]', '[class*="note-comment"]',
    ].join(', '));
    let beforeRoot = document.body;
    if (commentSection && commentSection.previousElementSibling) {
      beforeRoot = commentSection.previousElementSibling;
    }
    followers = findFollowersInScope(beforeRoot);
  }
  // 策略4：CSS 选择器直接取含粉丝计数的元素（最后回退）
  if (!followers) {
    const followerEl = document.querySelector([
      '.followers', '.fans', '[class*="follower"] .count',
      '.follower-count', '[class*="follower"] span',
      '[class*="info"] [class*="count"]',
    ].join(', '));
    if (followerEl) followers = (followerEl.textContent || '').trim().replace('粉丝', '').trim();
  }
  if (!followers) console.log('[eval] 粉丝数: 未提取到');
  else console.log('[eval] 粉丝数:', followers);

  // 发布时间
  const timeEl = document.querySelector([
    '.date', '.publish-date',
    '[class*="bottom"] [class*="time"]', '[class*="bottom"] [class*="date"]',
    '.bottom-date', '.time', '[class*="date"] span',
  ].join(', '));
  const timeStr = timeEl ? (timeEl.textContent || '').trim() : '';

  // 视频时长 —— 专用选择器 + contains 匹配（XHS 视频封面上的时长标签）
  let duration = '';
  // 策略1：专用 CSS 选择器（XHS 时长标签的 class 命名模式）
  const durSelectors = [
    '[class*="duration"]', '[class*="time"]', '[class*="video-time"]',
    '[class*="play-duration"]', '[class*="play-time"]', '[class*="video-duration"]',
    '.duration', '.video-time', '.play-duration',
  ].join(', ');
  const durEls = document.querySelectorAll(durSelectors);
  for (const el of durEls) {
    const text = (el.textContent || '').trim();
    const m = text.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      duration = m[1] + ':' + m[2] + (m[3] ? ':' + m[3] : '');
      break;
    }
  }
  // 策略2：放宽搜索范围 + contains 匹配（不要求完全等于 MM:SS）
  if (!duration) {
    const broadCandidates = document.querySelectorAll('span, div, time, p, label');
    for (const el of broadCandidates) {
      const text = (el.textContent || '').trim();
      // 使用 match 而非 test，允许 "时长 02:35" 或 "02:35 分钟" 等格式
      const m = text.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        const mins = parseInt(m[1], 10);
        const secs = parseInt(m[2], 10);
        // 合理性校验：分钟 < 60，且排除年份/日期（如 "2025:05"）
        if (mins < 20 && secs < 60 && (mins > 0 || secs >= 5)) {
          duration = m[1] + ':' + m[2] + (m[3] ? ':' + m[3] : '');
          break;
        }
      }
    }
  }
  // 策略3：<video> 元素的 duration 属性（纯秒数，最后回退）
  if (!duration) {
    const vid = document.querySelector('video');
    if (vid && vid.duration && isFinite(vid.duration)) {
      duration = String(Math.round(vid.duration));
    }
  }
  if (!duration) console.log('[eval] 视频时长: 未提取到');
  else console.log('[eval] 视频时长:', duration);

  return { authorName, followers, timeStr, duration, nums };
})()`,
      ], 10_000);
      const sd = JSON.parse(statsJson);

      // 解析作者名
      stats.authorName = cleanAuthorName(sd.authorName || "");

      // 解析粉丝数
      if (sd.followers) {
        const s = String(sd.followers).replace(/,/g, "").trim();
        if (/万/i.test(s)) {
          stats.authorFollowers = Math.round(parseFloat(s) * 10000);
        } else {
          const n = parseInt(s, 10);
          if (!isNaN(n)) stats.authorFollowers = n;
        }
        console.log(`[xhs-search] eval 提取粉丝数: raw="${sd.followers}" → parsed=${stats.authorFollowers}`);
      } else {
        console.log(`[xhs-search] eval 未提取到粉丝数`);
      }

      // 解析发布时间（保留原始文本，由 computeFilterDetails 尝试解析）
      if (sd.timeStr) {
        stats.publishedAt = sd.timeStr;
      }

      // 解析视频时长 —— 支持 "MM:SS" 格式（如 "02:35"）和纯秒数字符串
      if (sd.duration) {
        const durStr = String(sd.duration).trim();
        if (durStr.includes(":")) {
          const parts = durStr.split(":");
          if (parts.length === 2) {
            const mins = parseInt(parts[0], 10);
            const secs = parseInt(parts[1], 10);
            if (!isNaN(mins) && !isNaN(secs)) stats.durationSeconds = mins * 60 + secs;
          } else if (parts.length === 3) {
            const hrs = parseInt(parts[0], 10);
            const mins = parseInt(parts[1], 10);
            const secs = parseInt(parts[2], 10);
            if (!isNaN(hrs) && !isNaN(mins) && !isNaN(secs)) stats.durationSeconds = hrs * 3600 + mins * 60 + secs;
          }
        } else {
          const dur = parseFloat(durStr);
          if (!isNaN(dur) && dur > 0) stats.durationSeconds = Math.round(dur);
        }
        console.log(`[xhs-search] eval 提取视频时长: raw="${sd.duration}" → parsed=${stats.durationSeconds ?? "NULL"}秒`);
      } else {
        console.log(`[xhs-search] eval 未提取到视频时长`);
      }

      // 解析互动数据 nums 数组（假定顺序: likes, collects, comments）
      if (sd.nums && Array.isArray(sd.nums)) {
        const parsedNums = sd.nums.map((n: string) => {
          const s = String(n).replace(/,/g, "").trim();
          if (/万/i.test(s)) return Math.round(parseFloat(s) * 10000);
          const num = parseInt(s, 10);
          return isNaN(num) ? 0 : num;
        });
        stats.likes = parsedNums[0] || 0;
        stats.collects = parsedNums[1] || 0;
        stats.comments = parsedNums[2] || 0;
      }
    } catch (err: any) {
      console.error(`[xhs-search] OpenCLI eval 提取 stats 失败:`, err.message || err);
      // 统计提取失败不影响主流程
    }

    // 合并策略：markdown 解析优先（页面全文），eval DOM 提取作回退
    const finalFollowers =
      (mdFollowers.followers > 0 ? mdFollowers.followers : 0) ||
      (stats.authorFollowers > 0 ? stats.authorFollowers : 0);
    const finalDuration = mdDuration ?? stats.durationSeconds;
    const finalPublishedAt = mdPublishedAt || stats.publishedAt || undefined;

    return {
      title: extractData?.title?.replace(" - 小红书", "").trim() || "",
      desc,
      authorName: stats.authorName || mdFollowers.authorName || "",
      likes: stats.likes,
      collects: stats.collects,
      comments: stats.comments,
      authorFollowers: finalFollowers > 0 ? finalFollowers : undefined,
      publishedAt: finalPublishedAt,
      durationSeconds: finalDuration,
    };
  } catch (err: any) {
    console.error(`[xhs-search] OpenCLI 解析帖子失败:`, err.message || err);
    return null;
  }
}

/**
 * 从页面 markdown 中提取帖子正文描述
 */
function extractPostDesc(markdown: string, pageTitle: string): string {
  // 移除页面 chrome（导航栏、侧边栏、页脚等）
  const lines = markdown.split("\n");
  const contentLines: string[] = [];
  let inContent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 跳过标题行（页面标题）
    if (trimmed === pageTitle?.replace(" - 小红书", "").trim()) {
      inContent = true;
      continue;
    }

    // 跳过导航/页脚标记
    if (
      trimmed.startsWith("[!") ||
      trimmed.startsWith("© ") ||
      trimmed.startsWith("行吟信息") ||
      trimmed.startsWith("地址：") ||
      trimmed.startsWith("电话：") ||
      trimmed.startsWith("沪ICP备") ||
      trimmed.startsWith("关于我们") ||
      trimmed.includes("网络文化经营许可") ||
      trimmed.startsWith("温馨提示") ||
      trimmed.startsWith("活动")
    ) {
      if (inContent) break; // 到达页脚区域，停止收集
      continue;
    }

    // 跳过明显是导航链接和评论区域的标记
    if (
      trimmed === "首页" ||
      trimmed === "消息" ||
      trimmed === "我" ||
      trimmed === "发布" ||
      trimmed === "直播" ||
      trimmed === "点点" ||
      trimmed.match(/^\d{2}-\d{2}/) || // 评论日期
      trimmed.match(/^\d+$/) || // 纯数字（点赞数）
      trimmed === "回复" ||
      trimmed === "赞"
    ) {
      if (inContent && contentLines.length > 0) break; // 到达评论区域
      continue;
    }

    if (inContent) {
      contentLines.push(trimmed);
    }
  }

  const desc = contentLines.join("\n").trim();
  // 过滤掉太短的"描述"（可能只是误识别）
  return desc.length >= 20 ? desc : "";
}

/**
 * 从页面 markdown 中提取粉丝数和作者名
 * 匹配模式："1.2万粉丝"、"3,099粉丝"、"粉丝 5,432"、"约 1.2万 粉丝"
 */
function extractFollowersFromMarkdown(md: string): { followers: number; authorName: string } {
  // 限制搜索范围：评论区之前（避免匹配到评论区用户"xx粉丝"）
  const beforeComments = md.split(/评论\s*\n|共\s*\d+\s*条\s*评论|相关笔记/)[0];

  // 模式：数字(含逗号、小数点、万字) + 粉丝
  // 按优先级排序：先尝试完整数字，再尝试带"万"的
  const followersPatterns = [
    /(\d[\d,.]*)\s*粉丝/,           // "1324粉丝" 或 "1324 粉丝"
    /粉丝\s*[:：]?\s*(\d[\d,.]*)/, // "粉丝 1324" 或 "粉丝:1324"
    /(\d[\d,.]*\s*万)\s*粉丝/,     // "1.2万粉丝"
    /粉丝\s*[:：]?\s*(\d[\d,.]*\s*万)/, // "粉丝 1.2万"
  ];

  for (const pat of followersPatterns) {
    const m = beforeComments.match(pat);
    if (m) {
      const val = m[1].replace(/,/g, "").trim();
      let followers = 0;
      if (/万/i.test(val)) {
        followers = Math.round(parseFloat(val) * 10000);
      } else {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) followers = n;
      }
      if (followers > 0) {
        console.log(`[xhs-search] 从markdown提取粉丝数: ${followers} (匹配: "${m[0]}")`);
        return { followers, authorName: "" };
      }
    }
  }

  return { followers: 0, authorName: "" };
}

/**
 * 从页面 markdown 中提取视频时长（秒数）
 * 优先匹配"时长"关键字附近的 MM:SS，其次在评论区之前搜索独立 MM:SS
 * 返回 undefined 表示未提取到有效时长
 */
function extractDurationFromMarkdown(md: string): number | undefined {
  // 限制搜索范围：评论区之前（避免匹配到评论中的时间戳）
  const beforeComments = md.split(/评论\s*\n|共\s*\d+\s*条\s*评论/)[0];

  // 策略1：关键字引导提取
  const keywordPatterns = [
    /时长\s*[:：]?\s*(\d{1,3}):(\d{2})(?::(\d{2}))?/,
    /duration\s*[:：]?\s*(\d{1,3}):(\d{2})/i,
    /(\d{1,3}):(\d{2})(?::(\d{2}))?\s*(?:分钟|min|分钟视频)/,
    // XHS 常见：视频时长标记在标题下方，带有 "播放" 等上下文
    /播放\s*[:：]?\s*(\d{1,3}):(\d{2})/,
    /(\d{1,3}):(\d{2})\s*[:：]\s*时长/,
    /timeline\s*[:：]?\s*(\d{1,3}):(\d{2})/i,
  ];

  for (const pat of keywordPatterns) {
    const m = beforeComments.match(pat);
    if (m) {
      let secs = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (m[3]) secs = secs * 60 + parseInt(m[3], 10);
      if (secs > 0 && secs < 3600) {
        console.log(`[xhs-search] 从markdown(关键词)提取时长: ${secs}秒 (匹配: "${m[0]}")`);
        return secs;
      }
    }
  }

  // 策略2：在内容区域搜索独立 MM:SS（排除年份、月份、价格等）
  const timeMatch = beforeComments.match(/(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/g);
  if (timeMatch) {
    for (const candidate of timeMatch) {
      const parts = candidate.split(":");
      const mins = parseInt(parts[0], 10);
      const secs = parseInt(parts[1], 10);
      const total = mins * 60 + secs;
      // XHS 短视频通常在 10 秒 ~ 20 分钟范围内（太短或太长都不合理）
      if (mins >= 0 && mins < 20 && mins + secs > 0 && total >= 5) {
        console.log(`[xhs-search] 从markdown(MM:SS扫描)提取时长: ${total}秒 (候选: ${candidate})`);
        return total;
      }
    }
  }

  console.log(`[xhs-search] markdown 未提取到时长`);
  return undefined;
}

/**
 * 从页面 markdown 中提取发布时间
 * 支持：ISO日期、"2025年5月28日"、"5月28日"、相对时间"发布于307天前"等
 * 返回 ISO 日期字符串（YYYY-MM-DD），未提取到时返回 undefined
 */
function extractTimeFromMarkdown(md: string): string | undefined {
  // 模式1：ISO格式日期 "2025-05-28" 或 "2025/05/28"
  const isoM = md.match(/\b((20\d{2})[-/](\d{1,2})[-/](\d{1,2}))\b/);
  if (isoM) {
    const y = parseInt(isoM[2], 10);
    const m = parseInt(isoM[3], 10);
    const d = parseInt(isoM[4], 10);
    // 验证月份和日期在合理范围
    if (y >= 2015 && y <= 2030 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // 模式2：中文完整日期 "2025年5月28日"
  let m = md.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  // 模式3：简写中文 "5月28日"（补充当前年份）
  m = md.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    const year = new Date().getFullYear();
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // 模式4：相对时间 "发布于307天前" / "发布于 2天前" / "3小时前"
  m = md.match(/发布于?\s*(\d+)\s*天前/);
  if (m) {
    const days = parseInt(m[1], 10);
    if (days >= 0 && days <= 3650) {
      const d = new Date(Date.now() - days * 86400000);
      return d.toISOString().split("T")[0];
    }
  }

  m = md.match(/发布于?\s*(\d+)\s*小时前/);
  if (m) {
    const hours = parseInt(m[1], 10);
    if (hours >= 0) {
      const d = new Date(Date.now() - hours * 3600000);
      return d.toISOString().split("T")[0];
    }
  }

  m = md.match(/发布于?\s*(\d+)\s*分钟前/);
  if (m) {
    const mins = parseInt(m[1], 10);
    if (mins >= 0) {
      const d = new Date(Date.now() - mins * 60000);
      return d.toISOString().split("T")[0];
    }
  }

  // 模式5："刚刚" → 当作今天
  if (md.includes("刚刚")) {
    return new Date().toISOString().split("T")[0];
  }

  return undefined;
}

// ========== 四维预筛选 ==========

interface PreFilterResult {
  passed: boolean;
  avgMatchPercent: number;
  details: {
    timeliness: number;
    duration: number;
    dataQuality: number;
    authorQuality: number;
  };
}

/**
 * 在搜索阶段对单个结果做四维预筛选
 * 搜索阶段数据不全，缺失维度给 50% 中性分，仅过滤掉确定很差的结果
 */
function preFilterSearchResult(r: XHSSearchResult): PreFilterResult {
  // 时效性：搜索阶段无法获取发布时间，给中性分
  const timeliness = 50;

  // 时长：图文无时长限制（100%），视频未知时长给中性分
  const duration = r.postType === "note" ? 100 : 50;

  // 数据质量：基于点赞数评分（基准值与 pipeline 的 computeFilterDetails 保持一致）
  const baseLikes = FILTER_THRESHOLDS.dataQuality.likes;
  let dataQuality = 50;
  if (r.likes != null && r.likes > 0) {
    if (r.likes >= baseLikes) dataQuality = 100;
    else if (r.likes >= baseLikes * 0.5) dataQuality = 70;
    else if (r.likes >= baseLikes * 0.2) dataQuality = 50;
    else if (r.likes >= baseLikes * 0.1) dataQuality = 35;
    else dataQuality = 20;
  }

  // 作者质量：搜索阶段无法获取粉丝数，给中性分
  const authorQuality = 50;

  const avgMatchPercent = (timeliness + duration + dataQuality + authorQuality) / 4;

  return {
    passed: avgMatchPercent > 25,
    avgMatchPercent,
    details: { timeliness, duration, dataQuality, authorQuality },
  };
}

// ========== 工具函数 ==========

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

