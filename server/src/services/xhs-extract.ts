/**
 * 小红书帖子详情提取服务
 *
 * 通过 OpenCLI 浏览器控制打开帖子详情页，提取标题、正文、互动数据、
 * 作者信息、发布时间、视频时长等结构化数据。
 *
 * 从 xhs-search.ts 拆分出来，用于更清晰的职责分离：
 *   - xhs-search.ts：搜索 + 链接发现
 *   - xhs-extract.ts：详情页内容提取
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { cleanAuthorName } from "./xhs-scraper";
import { parseChineseDate } from "../utils";

const execFileAsync = promisify(execFile);

// OpenCLI main.js 的路径（直接用 node 调用，避免 Windows shell 对 URL 中 & 的解析问题）
const OPENCLI_MAIN = `${homedir()}/AppData/Roaming/npm/node_modules/@jackwener/opencli/dist/src/main.js`;

/** 运行 opencli 命令，返回 stdout（不经过 shell，避免 & 等特殊字符被解析） */
export async function runOpenCLI(args: string[], timeoutMs = 15_000): Promise<string> {
  const { stdout } = await execFileAsync("node", [OPENCLI_MAIN, ...args], {
    timeout: timeoutMs,
  });
  return stdout;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    '[class*="user-name"]', '[class*="userName"]',
    '[class*="nick"]', '[class*="author-name"]',
    '[class*="user"] [class*="name"]',
    '[class*="creator"] [class*="name"]',
    '[class*="account"] [class*="name"]',
  ].join(', '));
  const authorName = authorEl ? (authorEl.textContent || '').trim() : '';

	  // 粉丝数 —— 优先在作者信息区域搜索，避免匹配评论区/侧边栏推荐
	  let followers = '';
	  const findFollowersInScope = (root) => {
	    if (!root) return '';
	    const els = root.querySelectorAll('span, div, a');
	    for (const el of els) {
	      const text = (el.textContent || '').trim();
	      const m = text.match(/([\\d,.]+万?)\\s*粉丝/);
	      if (m) return m[1];
	    }
	    return '';
	  };
	  // 策略1：在作者名附近的容器中搜索（最可靠，避免全页误匹配）
	  if (authorName) {
	    let container = authorEl;
	    let searchedLevels = 0;
	    for (let i = 0; i < 6 && container; i++) {
	      const f = findFollowersInScope(container);
	      if (f) { followers = f; console.log('[eval] 粉丝数(strategy1): 在第' + i + '层找到, value=' + f); break; }
	      searchedLevels = i + 1;
	      container = container.parentElement;
	    }
	    if (!followers) console.log('[eval] 粉丝数(strategy1): authorEl存在但向上' + searchedLevels + '层未找到');
	  } else {
	    console.log('[eval] 粉丝数(strategy1): authorEl为null, 跳过 (authorName="' + (authorName || '') + '")');
	  }
	  // 策略2：专用 CSS 选择器定位作者/profile 区域搜索
	  if (!followers) {
	    const profileSelectors = [
	      '[class*="author"]', '[class*="profile"]',
	      '[class*="user-info"]', '[class*="user"]', '[class*="info"]',
	      '[class*="username"]', '[class*="nickname"]',
	      '[class*="userName"]', '[class*="nick"]',
	      '[class*="user-card"]', '[class*="userCard"]',
	      '[class*="author-card"]', '[class*="creator"]',
	      '[class*="account"]',
	    ];
	    const profileAreas = document.querySelectorAll(profileSelectors.join(', '));
	    let searchedAreas = 0;
	    for (const area of profileAreas) {
	      const f = findFollowersInScope(area);
	      if (f) {
	        followers = f;
	        console.log('[eval] 粉丝数(strategy2): 在class="' + ((area.className || area.tagName) + '').slice(0,40) + '"中找到');
	        break;
	      }
	      searchedAreas++;
	    }
	    if (!followers) console.log('[eval] 粉丝数(strategy2): 搜索了' + searchedAreas + '个profile区域, 均未找到');
	  }
	  // 策略3：回退到评论区之前的主内容区域
	  if (!followers) {
	    const commentSelectors = [
	      '[class*="comment"]', '[class*="reply"]', '[class*="note-comment"]',
	      '[class*="comments-container"]', '[class*="comment-list"]',
	    ];
	    const commentSection = document.querySelector(commentSelectors.join(', '));
	    let beforeRoot = document.body;
	    if (commentSection && commentSection.previousElementSibling) {
	      beforeRoot = commentSection.previousElementSibling;
	      console.log('[eval] 粉丝数(strategy3): 使用commentSection.previousElementSibling');
	    } else if (commentSection && commentSection.parentElement) {
	      beforeRoot = commentSection.parentElement;
	      console.log('[eval] 粉丝数(strategy3): 回退使用commentSection.parentElement');
	    } else {
	      console.log('[eval] 粉丝数(strategy3): commentSection为' + (commentSection ? '存在但无可用父级' : 'null') + ', 回退到document.body');
	    }
	    followers = findFollowersInScope(beforeRoot);
	    if (followers) console.log('[eval] 粉丝数(strategy3): 在评论区前区域找到, value=' + followers);
	    else console.log('[eval] 粉丝数(strategy3): 评论区前区域未找到');
	  }
	  // 策略4：CSS 选择器直接取含粉丝计数的元素
	  if (!followers) {
	    const followerSelectors = [
	      '.followers', '.fans', '[class*="follower"] .count',
	      '.follower-count', '[class*="follower"] span',
	      '[class*="info"] [class*="count"]',
	      '[class*="follow"] [class*="count"]',
	      '[class*="follow"] span',
	      '.follower-number', '[class*="followerNum"]',
	      '[class*="fan-count"]', '[class*="fanCount"]',
	    ];
	    const followerEl = document.querySelector(followerSelectors.join(', '));
	    if (followerEl) {
	      followers = (followerEl.textContent || '').trim().replace('粉丝', '').trim();
	      console.log('[eval] 粉丝数(strategy4): 选择器命中, raw="' + followers + '"');
	    } else {
	      console.log('[eval] 粉丝数(strategy4): 所有选择器未命中');
	    }
	  }
	  // 策略5（新增）：全局搜索所有含"粉丝"文本的元素，按位置+文本特征排序
	  if (!followers) {
	    const candidates = [];
	    const allElements = document.querySelectorAll('span, div, a, p, strong, b');
	    for (const el of allElements) {
	      const text = (el.textContent || '').trim();
	      if (!/[\\d]+/.test(text) || !text.includes('粉丝')) continue;
	      const m = text.match(/([\\d,.]+万?)\\s*粉丝/);
	      if (!m) continue;
	      const rect = el.getBoundingClientRect();
	      if (rect.width === 0 && rect.height === 0) continue;
	      if (rect.top < -500 || rect.top > 2000) continue;
	      let score = rect.top + text.length * 0.5;
	      let ancestor = el.parentElement;
	      for (let a = 0; a < 5 && ancestor; a++) {
	        const cls = (ancestor.className || '').toString();
	        if (/author|profile|user|info|creator|account/i.test(cls)) {
	          score -= 500;
	          break;
	        }
	        ancestor = ancestor.parentElement;
	      }
	      candidates.push({ value: m[1], score, top: Math.round(rect.top) });
	    }
	    candidates.sort(function(a, b) { return a.score - b.score; });
	    if (candidates.length > 0) {
	      console.log('[eval] 粉丝数(strategy5): 扫描到' + candidates.length + '个候选, top3: ' + JSON.stringify(candidates.slice(0,3)));
	      followers = candidates[0].value;
	      console.log('[eval] 粉丝数(strategy5): 选取最佳候选, value=' + followers);
	    } else {
	      console.log('[eval] 粉丝数(strategy5): 全局扫描未找到任何含"粉丝"的可视元素');
	    }
	  }
	  // 调试：所有策略失败时，dump页面中所有含"粉丝"的元素文本
	  if (!followers) {
	    const debugEls = [];
	    const allDebugEls = document.querySelectorAll('*');
	    for (const el of allDebugEls) {
	      const text = (el.textContent || '').trim();
	      if (text.includes('粉丝') && text.length < 100) {
	        const rect = el.getBoundingClientRect();
	        debugEls.push({
	          tag: el.tagName,
	          cls: (el.className || '').toString().slice(0, 60),
	          text: text.slice(0, 50),
	          top: Math.round(rect.top),
	          vis: rect.width > 0 && rect.height > 0,
	        });
	      }
	    }
	    const seen = new Set();
	    const unique = debugEls.filter(function(d) {
	      if (seen.has(d.text)) return false;
	      seen.add(d.text);
	      return true;
	    });
	    console.log('[eval] DEBUG 全部"粉丝"元素(' + unique.length + '个): ' + JSON.stringify(unique.slice(0, 15)));
	  }
	  if (!followers) console.log('[eval] 粉丝数: 最终未提取到');
	  else console.log('[eval] 粉丝数 最终值:', followers);

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
 *
 * 增强策略（2026-06）：
 * - beforeComments 切分后追加日志，打印首尾片段便于诊断
 * - 第一次搜索失败后，用全文本搜索取最后一个匹配（作者信息通常在页面顶部，最后一个非评论区的匹配大概率是作者）
 * - 每个模式失败时打印日志
 */
function extractFollowersFromMarkdown(md: string): { followers: number; authorName: string } {
  // 限制搜索范围：评论区之前（避免匹配到评论区用户"xx粉丝"）
  const beforeComments = md.split(/评论\s*\n|共\s*\d+\s*条\s*评论|相关笔记/)[0];

  console.log(`[xhs-search] markdown粉丝提取: beforeComments 长度=${beforeComments.length}, 全文长度=${md.length}`);
  console.log(`[xhs-search] markdown粉丝提取: beforeComments 前200字符: "${beforeComments.slice(0, 200)}"`);
  console.log(`[xhs-search] markdown粉丝提取: beforeComments 后200字符: "${beforeComments.slice(-200)}"`);

  // 模式：数字(含逗号、小数点、万字) + 粉丝
  // 按优先级排序：先尝试完整数字，再尝试带"万"的
  const followersPatterns = [
    /(\d[\d,.]*)\s*粉丝/,           // "1324粉丝" 或 "1324 粉丝"
    /粉丝\s*[:：]?\s*(\d[\d,.]*)/, // "粉丝 1324" 或 "粉丝:1324"
    /(\d[\d,.]*\s*万)\s*粉丝/,     // "1.2万粉丝"
    /粉丝\s*[:：]?\s*(\d[\d,.]*\s*万)/, // "粉丝 1.2万"
  ];

  const tryParseFollowers = (text: string, source: string): { followers: number; authorName: string } => {
    for (const pat of followersPatterns) {
      const m = text.match(pat);
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
          console.log(`[xhs-search] 从markdown提取粉丝数(${source}): ${followers} (匹配: "${m[0]}")`);
          return { followers, authorName: "" };
        }
        console.log(`[xhs-search] markdown粉丝: 模式匹配到"${m[0]}"但解析后为0, 跳过`);
      }
    }
    return { followers: 0, authorName: "" };
  };

  // 第一轮：在 beforeComments 范围内搜索
  const result1 = tryParseFollowers(beforeComments, "beforeComments");
  if (result1.followers > 0) return result1;

  console.log(`[xhs-search] markdown粉丝: beforeComments 中未找到粉丝数，尝试全文搜索（取最后一个匹配）`);

  // 第二轮回退：全文搜索，但取最后一个匹配（作者信息在页面顶部，
  // 全文末尾的"粉丝"匹配大概率是推荐/关注列表，而顶部附近的更可靠。
  // 但有些页面布局会把作者信息放在靠后，所以取最后一个非评论区匹配作为折中）
  // 策略：找到所有匹配位置，排除明显在评论区的（通过位置判断），取最靠后的一个
  const allMatches: Array<{ index: number; match: string; value: string }> = [];
  for (const pat of followersPatterns) {
    // 使用 exec 循环获取所有匹配
    const regex = new RegExp(pat.source, "g");
    let execMatch: RegExpExecArray | null;
    while ((execMatch = regex.exec(md)) !== null) {
      allMatches.push({
        index: execMatch.index,
        match: execMatch[0],
        value: execMatch[1],
      });
    }
  }

  if (allMatches.length > 0) {
    console.log(`[xhs-search] markdown粉丝全文搜索: 找到 ${allMatches.length} 个候选`);
    allMatches.forEach((m, i) => {
      // 打印每个候选的前后文
      const ctx = md.slice(Math.max(0, m.index - 20), m.index + m.match.length + 20);
      console.log(`[xhs-search]   候选${i}: index=${m.index} match="${m.match}" ctx="...${ctx}..."`);
    });

    // 取最后一个有效匹配（排除明显在评论区或推荐区域的）
    // 倒序遍历，跳过疑似评论区用户项（如 "昵称 · 123粉丝" 格式在评论中很常见）
    for (let i = allMatches.length - 1; i >= 0; i--) {
      const m = allMatches[i];
      const val = m.value.replace(/,/g, "").trim();
      let followers = 0;
      if (/万/i.test(val)) {
        followers = Math.round(parseFloat(val) * 10000);
      } else {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) followers = n;
      }
      // 过滤：粉丝数太小（<10）的像是评论用户，太大的（>10亿）不合理
      if (followers >= 50) {
        console.log(`[xhs-search] 从markdown全文搜索提取粉丝数: ${followers} (候选${i}, 匹配: "${m.match}")`);
        return { followers, authorName: "" };
      }
    }

    // 如果都被过滤了，取最后一个作为兜底（即使粉丝数<50，也比"未知"好）
    const last = allMatches[allMatches.length - 1];
    const lastVal = last.value.replace(/,/g, "").trim();
    let lastFollowers = 0;
    if (/万/i.test(lastVal)) {
      lastFollowers = Math.round(parseFloat(lastVal) * 10000);
    } else {
      const n = parseInt(lastVal, 10);
      if (!isNaN(n) && n > 0) lastFollowers = n;
    }
    if (lastFollowers > 0) {
      console.log(`[xhs-search] 从markdown全文搜索提取粉丝数(兜底): ${lastFollowers} (最后一个候选, 匹配: "${last.match}")`);
      return { followers: lastFollowers, authorName: "" };
    }
  }

  console.log(`[xhs-search] markdown粉丝: 全文也未找到任何"数字+粉丝"匹配`);
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
 * 扫描全文寻找日期候选文本，解析委托给共享的 parseChineseDate
 * 返回 ISO 日期字符串（YYYY-MM-DD），未提取到时返回 undefined
 */
function extractTimeFromMarkdown(md: string): string | undefined {
  // 候选提取顺序：ISO → 中文完整 → 中文简写 → 相对时间 → 刚刚
  const candidates: string[] = [];

  // 模式1：ISO格式日期 "2025-05-28" 或 "2025/05/28"
  const isoM = md.match(/\b((20\d{2})[-/](\d{1,2})[-/](\d{1,2}))\b/);
  if (isoM) candidates.push(isoM[1]);

  // 模式2：中文完整日期 "2025年5月28日"
  const cnFullM = md.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cnFullM) candidates.push(cnFullM[0]);

  // 模式3：简写中文 "5月28日"（parseChineseDate 自动补充当前年份）
  const cnShortM = md.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cnShortM) candidates.push(cnShortM[0]);

  // 模式4：相对时间 "发布于307天前" / "发布于 2天前" / "3小时前" / "X分钟前"
  const dayM = md.match(/发布于?\s*(\d+)\s*天前/);
  if (dayM) candidates.push(dayM[0]);

  const hourM = md.match(/发布于?\s*(\d+)\s*小时前/);
  if (hourM) candidates.push(hourM[0]);

  const minM = md.match(/发布于?\s*(\d+)\s*分钟前/);
  if (minM) candidates.push(minM[0]);

  // 模式5："刚刚" → 当作今天
  if (md.includes("刚刚")) candidates.push("刚刚");

  for (const cand of candidates) {
    const date = parseChineseDate(cand);
    if (date) return date.toISOString().split("T")[0];
  }

  return undefined;
}
