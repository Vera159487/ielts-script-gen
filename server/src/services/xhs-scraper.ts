/**
 * 小红书链接解析服务
 *
 * 方案 A：用户粘贴分享链接 → 后端 fetch + cheerio 解析
 * 从小红书分享页的 __INITIAL_STATE__ JSON 中提取结构化数据
 */

import * as cheerio from "cheerio";

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
  /** 原始 JSON 数据（调试用） */
  rawData?: any;
}

/**
 * 解析小红书分享链接
 * 支持 xhslink.com 短链接和 xiaohongshu.com 完整链接
 */
export async function parseXHSLink(url: string): Promise<XHSPostData> {
  const normalizedUrl = normalizeUrl(url);

  // 1. 请求页面
  const response = await fetch(normalizedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`请求小红书页面失败: HTTP ${response.status}`);
  }

  const html = await response.text();
  const finalUrl = response.url; // 重定向后的真实 URL

  // 2. 尝试从 __INITIAL_STATE__ 提取 JSON
  const data = extractInitialState(html);
  if (data) {
    return parseFromInitialState(data, finalUrl);
  }

  // 3. 降级：从 HTML meta 标签和可见文本提取
  return parseFromHTML(html, finalUrl);
}

/**
 * 批量解析多条小红书链接
 */
export async function parseXHSLinks(urls: string[]): Promise<XHSPostData[]> {
  const results = await Promise.allSettled(urls.map((url) => parseXHSLink(url)));
  return results
    .filter((r): r is PromiseFulfilledResult<XHSPostData> => r.status === "fulfilled")
    .map((r) => r.value);
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
 * 从 HTML 中提取 window.__INITIAL_STATE__
 */
function extractInitialState(html: string): any | null {
  // 匹配 window.__INITIAL_STATE__ = {...}
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*</);
  if (match) {
    try {
      // 替换 undefined 为 null（小红书前端常见写法）
      const sanitized = match[1].replace(/undefined/g, "null");
      return JSON.parse(sanitized);
    } catch {
      // JSON 解析失败，尝试更宽松的匹配
    }
  }

  // 备选：匹配 <script> 标签中的 __INITIAL_STATE__
  const scriptMatch = html.match(
    /<script>window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})<\/script>/
  );
  if (scriptMatch) {
    try {
      const sanitized = scriptMatch[1].replace(/undefined/g, "null");
      return JSON.parse(sanitized);
    } catch {
      // 放弃
    }
  }

  return null;
}

/**
 * 从 __INITIAL_STATE__ JSON 中提取帖子数据
 */
function parseFromInitialState(data: any, finalUrl: string): XHSPostData {
  try {
    // 小红书的 STATE 结构因页面类型而异，需要兼容多种路径
    const note = data?.note?.noteDetailMap
      ? data.note.noteDetailMap[Object.keys(data.note.noteDetailMap)[0]]?.note
      : data?.note?.[0]?.noteList?.[0]
      || data?.note;

    if (!note) {
      throw new Error("未找到帖子数据节点");
    }

    return {
      url: finalUrl,
      title: note.title || note.displayTitle || "",
      content: note.desc || note.description || "",
      authorName: note.user?.nickname || note.user?.nickName || "",
      authorFollowers: note.user?.followerCount || note.user?.fans || 0,
      likes: note.interactInfo?.likedCount || note.likes || 0,
      collects: note.interactInfo?.collectedCount || note.collects || 0,
      comments: note.interactInfo?.commentCount || note.comments || 0,
      durationSeconds: note.video?.duration || null,
      publishedAt: note.time || note.createTime
        ? new Date(note.time || note.createTime).toISOString()
        : null,
      rawData: data,
    };
  } catch (err: any) {
    throw new Error(`解析小红书数据失败: ${err.message}`);
  }
}

/**
 * 降级方案：从 HTML meta 标签和可见文本提取
 */
function parseFromHTML(html: string, finalUrl: string): XHSPostData {
  const $ = cheerio.load(html);

  // 从 meta 标签提取
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text() ||
    "";
  const content =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";
  const authorName =
    $('meta[name="author"]').attr("content") ||
    $('meta[property="article:author"]').attr("content") ||
    "";

  return {
    url: finalUrl,
    title: cleanText(title),
    content: cleanText(content),
    authorName: cleanText(authorName),
    authorFollowers: 0,
    likes: 0,
    collects: 0,
    comments: 0,
    durationSeconds: null,
    publishedAt: null,
  };
}

/**
 * 清理文本（去 HTML 实体、多余空格）
 */
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
