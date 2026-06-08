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

    // 5. 用 eval 提取结构化数据
    //    使用语义选择器分别提取互动数据，避免依赖 DOM 顺序假设
    let stats = {
      likes: 0, collects: 0, comments: 0,
      authorFollowers: 0, authorName: "",
      publishedAt: "", durationSeconds: undefined as number | undefined,
    };
    try {
      const statsJson = await runOpenCLI([
        "browser", "xhs", "eval",
        // 增强的 eval 脚本：语义互动提取 + 增强粉丝提取 + 精确发布时间
        `(() => {
  // ===== 调试：dump 页面基本信息（首次诊断用） =====
  console.log('[eval] PAGE TITLE:', document.title);
  console.log('[eval] BODY textContent 前500字符:', (document.body.textContent || '').trim().slice(0, 500));

  // ===== 互动数据：语义选择器分别提取（不依赖 DOM 顺序） =====
  const extractCountFromEl = (el) => {
    if (!el) return '';
    const t = (el.textContent || '').trim();
    if (t && /^[\\d,.万wW+]+$/.test(t)) return t;
    const m = t.match(/^([\\d,.]+[万wW]?)/);
    if (m) return m[1];
    return '';
  };

  // 通过语义关键词找所属容器，再取 count
  const findCountBySemantics = (keywords) => {
    for (const kw of keywords) {
      const el = document.querySelector(
        '[class*="' + kw + '"] [class*="count"], ' +
        '[class*="' + kw + '"] .count, ' +
        '[class*="' + kw + '"][class*="count"]'
      );
      if (el) { const v = extractCountFromEl(el); if (v) return v; }
    }
    for (const kw of keywords) {
      const container = document.querySelector('[class*="' + kw + '"]');
      if (container) {
        const spans = container.querySelectorAll('span');
        for (const s of spans) {
          const v = extractCountFromEl(s);
          if (v) return v;
        }
      }
    }
    return '';
  };

  const likeStr = findCountBySemantics(['like', 'heart', 'thumb', 'praise', 'like-wrapper']);
  const collectStr = findCountBySemantics(['collect', 'fav', 'star', 'bookmark', 'save', 'collect-wrapper']);
  const commentStr = findCountBySemantics(['comment', 'chat', 'reply', 'discuss', 'comment-wrapper']);

  console.log('[eval] 语义互动: like="' + likeStr + '", collect="' + collectStr + '", comment="' + commentStr + '"');

  // 兜底：engage-bar 区域扫描（带语义标注，每个数字记录其父级关键词）
  let fallbackNums = [];
  let fallbackAnnotated = { like: '', collect: '', comment: '' };
  if (!likeStr || !collectStr || !commentStr) {
    const barLeft = document.querySelectorAll([
      '.engage-bar [class*="left"] span',
      '[class*="engage"] [class*="left"] span',
      '.interact [class*="left"] .count',
      '[class*="interact"] [class*="left"] span',
      '.engage-bar-container span',
    ].join(', '));
    barLeft.forEach(el => {
      const t = el.textContent ? el.textContent.trim() : '';
      if (t && /^[\\d,.万wW+]+$/.test(t)) {
        fallbackNums.push(t);
        // 检查该元素的父链中是否包含语义关键词
        let p = el;
        for (let i = 0; i < 5 && p; i++) {
          const cls = (p.className || '').toString().toLowerCase();
          if (/like|heart|thumb|praise/.test(cls) && !fallbackAnnotated.like) fallbackAnnotated.like = t;
          if (/collect|fav|star|bookmark|save/.test(cls) && !fallbackAnnotated.collect) fallbackAnnotated.collect = t;
          if (/comment|chat|reply|discuss/.test(cls) && !fallbackAnnotated.comment) fallbackAnnotated.comment = t;
          p = p.parentElement;
        }
      }
    });
    console.log('[eval] engage-bar 兜底 nums:', JSON.stringify(fallbackNums));
    console.log('[eval] engage-bar 注解映射:', JSON.stringify(fallbackAnnotated));
  }

  // ===== 作者名 =====
  const authorEl = document.querySelector([
    '.username', '.author-name', '[class*="nickname"]',
    '.name', '[class*="author"] .name',
    '[class*="user-name"]', '[class*="userName"]',
    '[class*="nick"]', '[class*="author-name"]',
    '[class*="user"] [class*="name"]',
    '[class*="creator"] [class*="name"]',
    '[class*="account"] [class*="name"]',
    'a[href*="/user/profile/"] span',
    'a[href*="/user/profile/"]',
  ].join(', '));
  const authorName = authorEl ? (authorEl.textContent || '').trim() : '';
  console.log('[eval] 作者名: "' + authorName + '" (el found=' + (authorEl !== null) + ')');

  // 尝试提取作者主页链接中的 user ID
  let userIdFromHref = '';
  const authorLink = document.querySelector('a[href*="/user/profile/"]');
  if (authorLink) {
    const href = authorLink.getAttribute('href') || '';
    const uidMatch = href.match(/\\/user\\/profile\\/([a-f0-9]+)/i);
    if (uidMatch) {
      userIdFromHref = uidMatch[1];
      console.log('[eval] 作者ID(从href):', userIdFromHref);
    }
  }

  // ===== 粉丝数 —— 7层增强策略 =====
  let followers = '';
  const findFollowersInScope = (root) => {
    if (!root) return '';
    const els = root.querySelectorAll('span, div, a');
    for (const el of els) {
      const text = (el.textContent || '').trim();
      const m = text.match(/([\\d,.]+[万wW]?)\\s*粉丝/);
      if (m) return m[1];
      const m2 = text.match(/粉丝\\s*[:：]?\\s*([\\d,.]+[万wW]?)/);
      if (m2) return m2[1];
    }
    return '';
  };

  // 策略1：作者名附近的容器（扩展到8层）
  if (authorName) {
    let container = authorEl;
    let searchedLevels = 0;
    for (let i = 0; i < 8 && container; i++) {
      const f = findFollowersInScope(container);
      if (f) { followers = f; console.log('[eval] 粉丝数(s1): 第' + i + '层找到, value=' + f); break; }
      searchedLevels = i + 1;
      container = container.parentElement;
    }
    if (!followers) console.log('[eval] 粉丝数(s1): 向上' + searchedLevels + '层未找到');
  } else {
    console.log('[eval] 粉丝数(s1): authorEl为null, 跳过');
  }

  // 策略2：专用 CSS 选择器定位作者/profile 区域
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
        console.log('[eval] 粉丝数(s2): class="' + ((area.className || area.tagName) + '').slice(0,40) + '"');
        break;
      }
      searchedAreas++;
    }
    if (!followers) console.log('[eval] 粉丝数(s2): 搜索了' + searchedAreas + '个区域, 均未找到');
  }

  // 策略3：评论区之前的主内容区域
  if (!followers) {
    const commentSelectors = [
      '[class*="comment"]', '[class*="reply"]', '[class*="note-comment"]',
      '[class*="comments-container"]', '[class*="comment-list"]',
    ];
    const commentSection = document.querySelector(commentSelectors.join(', '));
    let beforeRoot = document.body;
    if (commentSection && commentSection.previousElementSibling) {
      beforeRoot = commentSection.previousElementSibling;
      console.log('[eval] 粉丝数(s3): 使用previousElementSibling');
    } else if (commentSection && commentSection.parentElement) {
      beforeRoot = commentSection.parentElement;
      console.log('[eval] 粉丝数(s3): 使用parentElement');
    } else {
      console.log('[eval] 粉丝数(s3): 回退到document.body (commentSection=' + (commentSection ? 'exists' : 'null') + ')');
    }
    followers = findFollowersInScope(beforeRoot);
    if (followers) console.log('[eval] 粉丝数(s3): 找到, value=' + followers);
    else console.log('[eval] 粉丝数(s3): 未找到');
  }

  // 策略4：CSS 选择器直接取
  if (!followers) {
    const followerSelectors = [
      '.followers', '.fans', '[class*="follower"] .count',
      '.follower-count', '[class*="follower"] span',
      '[class*="info"] [class*="count"]',
      '[class*="follow"] [class*="count"]',
      '[class*="follow"] span',
      '.follower-number', '[class*="followerNum"]',
      '[class*="fan-count"]', '[class*="fanCount"]',
      '[class*="sub"] [class*="count"]',
      '[class*="subscribe"] span',
    ];
    const followerEl = document.querySelector(followerSelectors.join(', '));
    if (followerEl) {
      followers = (followerEl.textContent || '').trim().replace(/粉丝|关注/g, '').trim();
      console.log('[eval] 粉丝数(s4): 选择器命中, raw="' + followers + '"');
    } else {
      console.log('[eval] 粉丝数(s4): 未命中');
    }
  }

  // 策略5：全局扫描含"粉丝"文本的元素
  if (!followers) {
    const candidates = [];
    const allElements = document.querySelectorAll('span, div, a, p, strong, b');
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      if (!/[\\d]+/.test(text) || !text.includes('粉丝')) continue;
      const m = text.match(/([\\d,.]+[万wW]?)\\s*粉丝/);
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
      console.log('[eval] 粉丝数(s5): ' + candidates.length + '个候选, top3: ' + JSON.stringify(candidates.slice(0,3)));
      followers = candidates[0].value;
      console.log('[eval] 粉丝数(s5): 选取最佳, value=' + followers);
    } else {
      console.log('[eval] 粉丝数(s5): 未找到含"粉丝"的可视元素');
    }
  }

  // 策略6（新）：搜索不带"粉丝"后缀的缩写数字（如 "1.2万" "3.4w"）
  if (!followers) {
    if (authorEl) {
      let container = authorEl;
      for (let i = 0; i < 5 && container; i++) {
        const spans = container.querySelectorAll('span, div');
        for (const s of spans) {
          const text = (s.textContent || '').trim();
          const m = text.match(/^([\\d,.]+[万wW])$/);
          if (m) {
            followers = m[1];
            console.log('[eval] 粉丝数(s6): 作者区缩写 "' + followers + '"');
            break;
          }
        }
        if (followers) break;
        container = container.parentElement;
      }
    }
    if (!followers) {
      const infoAreas = document.querySelectorAll(
        '[class*="author"] [class*="info"], [class*="user"] [class*="info"], [class*="profile"] [class*="info"]'
      );
      for (const area of infoAreas) {
        const spans = area.querySelectorAll('span, div');
        for (const s of spans) {
          const text = (s.textContent || '').trim();
          const m = text.match(/^([\\d,.]+[万wW]?)$/);
          if (m && m[1].length <= 8 && /[\\d]/.test(m[1])) {
            if (/^20\\d{2}$/.test(m[1])) continue;
            followers = m[1];
            console.log('[eval] 粉丝数(s6-info): info区域 "' + followers + '"');
            break;
          }
        }
        if (followers) break;
      }
    }
    if (!followers) console.log('[eval] 粉丝数(s6): 未找到缩写');
  }

  // 策略7（新）：aria-label 属性中的粉丝信息
  if (!followers) {
    const ariaCandidates = document.querySelectorAll(
      '[aria-label*="粉丝"], [aria-label*="follower"], [aria-label*="follow"]'
    );
    for (const el of ariaCandidates) {
      const label = el.getAttribute('aria-label') || '';
      const m = label.match(/([\\d,.]+[万wW]?)\\s*(?:粉丝|follower|follow)/i);
      if (m) {
        followers = m[1];
        console.log('[eval] 粉丝数(s7): aria-label提取, value=' + followers);
        break;
      }
    }
    if (!followers) console.log('[eval] 粉丝数(s7): aria-label未找到');
  }

  // 调试 dump：全部失败时输出含"粉丝"或数字+万的元素
  if (!followers) {
    const debugEls = [];
    const allDebugEls = document.querySelectorAll('*');
    for (const el of allDebugEls) {
      const text = (el.textContent || '').trim();
      if (text.length > 100) continue;
      const hasFans = text.includes('粉丝');
      const hasWan = /\\d+[万wW]/.test(text);
      if (hasFans || hasWan) {
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
    console.log('[eval] DEBUG 粉丝/万元素(' + unique.length + '个): ' + JSON.stringify(unique.slice(0, 20)));
  }
  if (!followers) console.log('[eval] 粉丝数: 最终未提取到');
  else console.log('[eval] 粉丝数 最终值:', followers);

  // ===== 发布时间 —— 分层精确提取（避免匹配评论区时间） =====
  let timeStr = '';
  // 策略1：帖子头部/元信息区域
  const headerTimeSelectors = [
    '[class*="bottom"] [class*="date"]',
    '[class*="bottom"] [class*="time"]',
    '[class*="bottom-container"] span',
    '.bottom-date',
    '[class*="note"] [class*="date"]',
    '[class*="note"] [class*="time"]',
    '[class*="note-info"] span',
    '[class*="meta"] [class*="date"]',
    'time[datetime]',
    'time',
    '[class*="author"] [class*="time"]',
    '[class*="author"] [class*="date"]',
    '[class*="user"] [class*="time"]',
  ];
  for (const sel of headerTimeSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const t = (el.getAttribute('datetime') || el.textContent || '').trim();
      if (t && t.length >= 2 && t.length <= 30) {
        timeStr = t;
        console.log('[eval] 发布时间(s1): 选择器"' + sel + '"命中, raw="' + timeStr + '"');
        break;
      }
    }
  }
  // 策略2：回退通用选择器但排除评论区
  if (!timeStr) {
    const fallbackEls = document.querySelectorAll('.date, .publish-date, .time, [class*="date"] span');
    for (const el of fallbackEls) {
      const t = (el.textContent || '').trim();
      if (t && t.length >= 2 && t.length <= 30) {
        let parent = el.parentElement;
        let inCommentArea = false;
        for (let i = 0; i < 5 && parent; i++) {
          const cls = (parent.className || '').toString();
          if (/comment|reply/i.test(cls)) { inCommentArea = true; break; }
          parent = parent.parentElement;
        }
        if (!inCommentArea) {
          timeStr = t;
          console.log('[eval] 发布时间(s2-回退): 非评论区时间, raw="' + timeStr + '"');
          break;
        }
      }
    }
  }
  if (!timeStr) console.log('[eval] 发布时间: 未提取到');
  else console.log('[eval] 发布时间 最终值:', timeStr);

  // ===== 视频时长 =====
  let duration = '';
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
  if (!duration) {
    const broadCandidates = document.querySelectorAll('span, div, time, p, label');
    for (const el of broadCandidates) {
      const text = (el.textContent || '').trim();
      const m = text.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        const mins = parseInt(m[1], 10);
        const secs = parseInt(m[2], 10);
        if (mins < 20 && secs < 60 && (mins > 0 || secs >= 5)) {
          duration = m[1] + ':' + m[2] + (m[3] ? ':' + m[3] : '');
          break;
        }
      }
    }
  }
  if (!duration) {
    const vid = document.querySelector('video');
    if (vid && vid.duration && isFinite(vid.duration)) {
      duration = String(Math.round(vid.duration));
    }
  }
  if (!duration) console.log('[eval] 视频时长: 未提取到');
  else console.log('[eval] 视频时长:', duration);

  return { authorName, followers, timeStr, duration, likeStr, collectStr, commentStr, fallbackNums, fallbackAnnotated, userIdFromHref };
})()`,
      ], 10_000);
      const sd = JSON.parse(statsJson);

      // 解析作者名
      stats.authorName = cleanAuthorName(sd.authorName || "");

      // 解析粉丝数
      if (sd.followers) {
        const s = String(sd.followers).replace(/,/g, "").trim();
        if (/[万wW]/i.test(s)) {
          stats.authorFollowers = Math.round(parseFloat(s) * 10000);
        } else {
          const n = parseInt(s, 10);
          if (!isNaN(n)) stats.authorFollowers = n;
        }
        console.log(`[xhs-search] eval 提取粉丝数: raw="${sd.followers}" → parsed=${stats.authorFollowers}`);
      } else {
        console.log(`[xhs-search] eval 未提取到粉丝数 (userIdFromHref=${sd.userIdFromHref || "N/A"})`);
      }

      // 解析发布时间
      if (sd.timeStr) {
        stats.publishedAt = sd.timeStr;
        console.log(`[xhs-search] eval 提取发布时间: raw="${sd.timeStr}"`);
      } else {
        console.log(`[xhs-search] eval 未提取到发布时间`);
      }

      // 解析视频时长
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

      // 解析互动数据 —— 每个字段独立回退
      const parseCount = (raw: string): number => {
        if (!raw) return 0;
        const s = String(raw).replace(/,/g, "").trim();
        if (/[万wW]/i.test(s)) return Math.round(parseFloat(s) * 10000);
        const num = parseInt(s, 10);
        return isNaN(num) ? 0 : num;
      };

      // 优先语义提取，语义为空时用 annotated 回退
      const fbAnnotated = sd.fallbackAnnotated || {};
      stats.likes = parseCount(sd.likeStr || fbAnnotated.like || '');
      stats.collects = parseCount(sd.collectStr || fbAnnotated.collect || '');
      stats.comments = parseCount(sd.commentStr || fbAnnotated.comment || '');

      // 如果所有字段仍为0，回退到兜底 nums 数组（顺序不可靠，仅作最后手段）
      if (stats.likes === 0 && stats.collects === 0 && stats.comments === 0 &&
          sd.fallbackNums && Array.isArray(sd.fallbackNums) && sd.fallbackNums.length > 0) {
        const parsedNums = sd.fallbackNums.map((n: string) => parseCount(n));
        stats.likes = parsedNums[0] || 0;
        stats.collects = parsedNums[1] || 0;
        stats.comments = parsedNums[2] || 0;
        console.log(`[xhs-search] eval 兜底互动(nums按顺序): likes=${stats.likes}, collects=${stats.collects}, comments=${stats.comments} (原始=${JSON.stringify(sd.fallbackNums)})`);
      } else {
        console.log(`[xhs-search] eval 互动数据: likes=${stats.likes}, collects=${stats.collects}, comments=${stats.comments} (语义+annotated)`);
      }
    } catch (err: any) {
      console.error(`[xhs-search] OpenCLI eval 提取 stats 失败:`, err.message || err);
    }

    // 合并策略：eval DOM 提取优先（更精确），markdown 作回退
    const finalFollowers =
      (stats.authorFollowers > 0 ? stats.authorFollowers : 0) ||
      (mdFollowers.followers > 0 ? mdFollowers.followers : 0);
    const finalDuration = stats.durationSeconds ?? mdDuration;
    // 发布时间：eval DOM 提取优先（排除了评论区），markdown 回退
    const finalPublishedAt = stats.publishedAt || mdPublishedAt || undefined;

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
  const lines = markdown.split("\n");
  const contentLines: string[] = [];
  let inContent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === pageTitle?.replace(" - 小红书", "").trim()) {
      inContent = true;
      continue;
    }

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
      if (inContent) break;
      continue;
    }

    if (
      trimmed === "首页" ||
      trimmed === "消息" ||
      trimmed === "我" ||
      trimmed === "发布" ||
      trimmed === "直播" ||
      trimmed === "点点" ||
      trimmed.match(/^\d{2}-\d{2}/) ||
      trimmed.match(/^\d+$/) ||
      trimmed === "回复" ||
      trimmed === "赞"
    ) {
      if (inContent && contentLines.length > 0) break;
      continue;
    }

    if (inContent) {

        // 过滤 XHS 页面垃圾（平台图标、推荐区域、评论计数、话题标签链接等）
        if (
          trimmed.startsWith("![](http") ||               // 平台图片
          trimmed.includes("picasso-static.xiaohongshu.com") ||
          trimmed.includes("猜你想搜") ||
          trimmed.includes("为你推荐") ||
          trimmed.includes("相关笔记") ||
          trimmed.includes("热门搜索") ||
          trimmed.match(/^共\s*\d+\s*条评论/) ||         // "共 470 条评论"
          trimmed.match(/\d+\s*条评论/) ||                // "470条评论"
          trimmed.match(/\d+\s*条回复/) ||                // "3条回复"
          trimmed.match(/^\d{4}-\d{2}-\d{2}$/) ||        // 纯日期行 "2024-09-17"
          trimmed.match(/^\d{2}-\d{2}$/) ||               // 纯日期行 "09-17"
          trimmed.startsWith("发表于") ||
          trimmed.match(/^\d+\s*(分钟|小时|天|月|年)前/)  // "20分钟前" / "3天前"
        ) {
          continue;
        }

        // 清理话题标签链接：[#xxx](/search_result?... → #xxx
        let cleaned = trimmed;
        if (cleaned.includes("/search_result?keyword=")) {
          cleaned = cleaned.replace(/\[(#\S+?)\]\(\/search_result\?[^)]+\)/g, "$1");
        }

      contentLines.push(cleaned);
    }
  }

  const desc = contentLines.join("\n").trim();
  return desc.length >= 20 ? desc : "";
}

/**
 * 从页面 markdown 中提取粉丝数和作者名
 */
function extractFollowersFromMarkdown(md: string): { followers: number; authorName: string } {
  const beforeComments = md.split(/评论\s*\n|共\s*\d+\s*条\s*评论|相关笔记/)[0];

  console.log(`[xhs-search] markdown粉丝提取: beforeComments 长度=${beforeComments.length}, 全文长度=${md.length}`);
  console.log(`[xhs-search] markdown粉丝提取: beforeComments 前200字符: "${beforeComments.slice(0, 200)}"`);
  console.log(`[xhs-search] markdown粉丝提取: beforeComments 后200字符: "${beforeComments.slice(-200)}"`);

  const followersPatterns = [
    /(\d[\d,.]*)\s*粉丝/,
    /粉丝\s*[:：]?\s*(\d[\d,.]*)/,
    /(\d[\d,.]*\s*万)\s*粉丝/,
    /粉丝\s*[:：]?\s*(\d[\d,.]*\s*万)/,
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

  // 第一轮：beforeComments 范围
  const result1 = tryParseFollowers(beforeComments, "beforeComments");
  if (result1.followers > 0) return result1;

  console.log(`[xhs-search] markdown粉丝: beforeComments 未找到，尝试全文搜索`);

  // 第二轮：全文搜索
  const allMatches: Array<{ index: number; match: string; value: string }> = [];
  for (const pat of followersPatterns) {
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
    console.log(`[xhs-search] markdown粉丝全文搜索: ${allMatches.length} 个候选`);
    allMatches.forEach((m, i) => {
      const ctx = md.slice(Math.max(0, m.index - 20), m.index + m.match.length + 20);
      console.log(`[xhs-search]   候选${i}: index=${m.index} match="${m.match}" ctx="...${ctx}..."`);
    });

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
      if (followers >= 50) {
        console.log(`[xhs-search] 从markdown全文搜索提取粉丝数: ${followers} (候选${i})`);
        return { followers, authorName: "" };
      }
    }

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
      console.log(`[xhs-search] 从markdown全文搜索提取粉丝数(兜底): ${lastFollowers}`);
      return { followers: lastFollowers, authorName: "" };
    }
  }

  console.log(`[xhs-search] markdown粉丝: 全文也未找到"数字+粉丝"匹配`);
  return { followers: 0, authorName: "" };
}

/**
 * 从页面 markdown 中提取视频时长（秒数）
 */
function extractDurationFromMarkdown(md: string): number | undefined {
  const beforeComments = md.split(/评论\s*\n|共\s*\d+\s*条\s*评论/)[0];

  const keywordPatterns = [
    /时长\s*[:：]?\s*(\d{1,3}):(\d{2})(?::(\d{2}))?/,
    /duration\s*[:：]?\s*(\d{1,3}):(\d{2})/i,
    /(\d{1,3}):(\d{2})(?::(\d{2}))?\s*(?:分钟|min|分钟视频)/,
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

  const timeMatch = beforeComments.match(/(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/g);
  if (timeMatch) {
    for (const candidate of timeMatch) {
      const parts = candidate.split(":");
      const mins = parseInt(parts[0], 10);
      const secs = parseInt(parts[1], 10);
      const total = mins * 60 + secs;
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
 *
 * 关键修复（2026-06）：限定搜索范围为评论区之前，
 * 避免匹配帖子正文中提到的日期（如 "2024-10-15 我参加了第一场雅思考试"）。
 *
 * 返回 ISO 日期字符串（YYYY-MM-DD），未提取到时返回 undefined
 */
function extractTimeFromMarkdown(md: string): string | undefined {
  // 限定搜索范围：评论区之前（避免匹配帖子正文/评论中的日期）
  const beforeComments = md.split(/评论\s*\n|共\s*\d+\s*条\s*评论|相关笔记/)[0];

  console.log(`[xhs-search] markdown发布时间提取: beforeComments 长度=${beforeComments.length}, 全文长度=${md.length}`);

  const candidates: string[] = [];

  // 模式1：ISO格式日期 "2025-05-28" 或 "2025/05/28"
  // 在 beforeComments 中查找所有匹配，取最后一个（发布时间通常在帖子头部偏后的位置）
  const isoMatches = beforeComments.match(/\b((20\d{2})[-/](\d{1,2})[-/](\d{1,2}))\b/g);
  if (isoMatches) {
    // 如果有多个 ISO 日期，取最后一个（发布时间通常在作者信息下方，比正文中提到的时间靠前但比标题靠后）
    // 实际策略：排除明显在帖子长文中的日期（帖子正文通常比较长）
    // 取倒数第二个（最后一个是帖子正文中提到的日期）或倒数第一个
    const last = isoMatches[isoMatches.length - 1];
    candidates.push(last);
    console.log(`[xhs-search] markdown发布时间: 找到 ${isoMatches.length} 个ISO日期, 取最后: "${last}" (全部: ${isoMatches.join(", ")})`);
  }

  // 模式2：中文完整日期 "2025年5月28日"
  const cnFullM = beforeComments.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cnFullM) candidates.push(cnFullM[0]);

  // 模式3：简写中文 "5月28日"
  const cnShortM = beforeComments.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cnShortM) candidates.push(cnShortM[0]);

  // 模式4：相对时间（beforeComments 中查找，避免匹配评论中的）
  const dayM = beforeComments.match(/发布于?\s*(\d+)\s*天前/);
  if (dayM) candidates.push(dayM[0]);

  const hourM = beforeComments.match(/发布于?\s*(\d+)\s*小时前/);
  if (hourM) candidates.push(hourM[0]);

  const minM = beforeComments.match(/发布于?\s*(\d+)\s*分钟前/);
  if (minM) candidates.push(minM[0]);

  // 模式5："刚刚"
  if (beforeComments.includes("刚刚")) candidates.push("刚刚");

  console.log(`[xhs-search] markdown发布时间候选: ${candidates.length > 0 ? candidates.join(" | ") : "(无)"}`);

  for (const cand of candidates) {
    const date = parseChineseDate(cand);
    if (date) {
      const iso = date.toISOString().split("T")[0];
      console.log(`[xhs-search] markdown发布时间: 解析成功 → ${iso} (候选="${cand}")`);
      return iso;
    }
  }

  console.log(`[xhs-search] markdown发布时间: 所有候选解析失败`);
  return undefined;
}
