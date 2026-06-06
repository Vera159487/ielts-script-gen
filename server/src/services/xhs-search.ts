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
import { FILTER_THRESHOLDS } from "../types";
import { cleanAuthorName } from "./xhs-scraper";
import { normalizeXHSLink } from "../utils";
import { runOpenCLI, sleep } from "./xhs-extract";

// 从 xhs-extract 重新导出，保持向后兼容
export { ParsedPostData, parsePostWithOpenCLI } from "./xhs-extract";

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
        // 相关性校验：标题或摘要必须包含关键词或雅思相关词汇
        if (!isRelevantToIelts(r.title, r.snippet, r.keyword)) continue;

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

  // 兜底：如果结果严重不足（不到 3 条），用更宽泛的雅思关联词再搜一轮
  if (allResults.length < 3 && searchKeywords.length > 0) {
    console.log(`[xhs-search] 主搜索仅获 ${allResults.length} 条，启动宽泛关联词补充搜索...`);
    const broadTerms = ["英语学习", "出国留学", "英语口语", "备考经验", "学习方法"];
    for (const term of broadTerms) {
      try {
        const results = await searchBingForKeyword(term, maxPerKeyword);
        for (const r of results) {
          // 宽泛词也必须通过雅思相关性校验
          if (!isRelevantToIelts(r.title, r.snippet, r.keyword)) continue;
          const filter = preFilterSearchResult(r);
          const normalized = normalizeXHSLink(r.url);
          if (!seenUrls.has(normalized)) {
            seenUrls.add(normalized);
            allResults.push({ ...r, url: normalized, matchPercent: filter.avgMatchPercent });
          }
        }
        if (allResults.length >= 10) break;
        await sleep(500);
      } catch {
        // 补充搜索失败不中断
      }
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

// ========== 相关性校验 ==========

/** 雅思相关通用词汇（标题/摘要命中即视为相关） */
const IELTS_RELATED_TERMS = [
  "雅思", "ielts", "英语", "备考", "口语", "听力", "阅读",
  "写作", "词汇", "真题", "技巧", "出国", "留学", "应试",
  "考试", "分数", "提分", "上岸", "逆袭", "模拟", "突击",
  "机经", "外教", "英文", "语法", "单词",
];

/**
 * 检查 Bing 搜索结果是否与雅思/英语学习相关
 * 标题或摘要中必须包含关键词分词片段，或雅思相关通用词
 */
function isRelevantToIelts(title: string, snippet: string, keyword: string): boolean {
  const combined = `${title} ${snippet}`.toLowerCase();

  // 1. 完整关键词匹配
  if (combined.includes(keyword.toLowerCase())) return true;

  // 2. 关键词分词匹配：至少2字的中文片段
  const tokens = keyword.split(/[\s,，、/]+/).filter((t) => t.length >= 2);
  if (tokens.some((t) => combined.includes(t.toLowerCase()))) return true;

  // 3. 雅思相关通用词匹配
  if (IELTS_RELATED_TERMS.some((t) => combined.includes(t))) return true;

  return false;
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
        // 相关性校验（小红书站内搜索一般已相关，作为安全网）
        if (!isRelevantToIelts(r.title, r.snippet, r.keyword)) continue;

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

  // 兜底：如果结果严重不足（不到 3 条），用更宽泛的雅思关联词再搜一轮
  if (allResults.length < 3 && searchKeywords.length > 0) {
    console.log(`[xhs-search] 主搜索仅获 ${allResults.length} 条，启动宽泛关联词补充搜索...`);
    const broadTerms = ["英语学习", "出国留学", "英语口语", "备考经验", "学习方法"];
    for (const term of broadTerms) {
      try {
        const results = await searchXHSWithBrowser(term, maxPerKeyword);
        for (const r of results) {
          if (!isRelevantToIelts(r.title, r.snippet, r.keyword)) continue;
          const filter = preFilterSearchResult(r);
          const normalized = normalizeXHSLink(r.url);
          if (!seenUrls.has(normalized)) {
            seenUrls.add(normalized);
            allResults.push({ ...r, url: normalized, matchPercent: filter.avgMatchPercent });
          }
        }
        if (allResults.length >= 10) break;
        await sleep(500);
      } catch (err: any) {
        console.error(`[xhs-search] 宽泛词 "${term}" 搜索失败:`, err.message || String(err));
      }
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
  const evalCode = `(() => { const items = document.querySelectorAll('.note-item'); return Array.from(items).slice(0, ${maxResults}).map(item => { const titleEl = item.querySelector('.title'); const authorEl = item.querySelector('.author'); const likeEl = item.querySelector('.like-count, .count'); const coverLink = item.querySelector('a.cover'); const href = titleEl?.getAttribute('href') || coverLink?.getAttribute('href') || ''; const searchLink = item.querySelector('a[href*=\\"search_result\\"]')?.getAttribute('href') || ''; const noteId = href.split('/').pop()?.split('?')[0] || ''; const xsecToken = searchLink.match(/xsec_token=([^&]+)/)?.[1] || ''; const hasPlayIcon = !!(item.querySelector('[class*=\\"play\\"], [class*=\\"duration\\"], [class*=\\"video-icon\\"], .play-icon, .duration')); const likesText = likeEl?.textContent?.trim() || ''; let likesNum = 0; if (likesText) { const n = likesText.endsWith('万') ? parseFloat(likesText) * 10000 : parseInt(likesText, 10); if (!isNaN(n)) likesNum = n; } return { url: noteId ? 'https://www.xiaohongshu.com/explore/' + noteId : '', title: titleEl?.textContent?.trim() || '', author: authorEl?.textContent?.trim() || '', likes: likesText, likesNum, postType: hasPlayIcon ? 'video' : 'note', xsecToken }; }).filter(n => n.url); })()`;

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
