/**
 * Pipeline 编排器 — SOP 四步全链路自动化
 *
 * Step1: 关键词生成    (keywords)
 * Step2: 爆款搜索      (search)
 * Step3: 爆款验证      (verify)
 * Step4: 二创改写      (rewrite)
 *
 * 每步独立执行、独立存储、独立可重试
 * 通过 AsyncGenerator 推送 ProgressEvent
 */

import { v4 as uuid } from "uuid";
import { chat } from "./ai";
import {
  KEYWORDS_SYSTEM_PROMPT,
  buildKeywordsUserPrompt,
} from "./prompts/keywords";
import {
  buildRewriterSystemPrompt,
  buildRewriterUserPrompt,
} from "./prompts/rewriter";
import {
  createSession,
  updateSessionStatus,
  createStep,
  updateStepStatus,
  getStepsBySession,
  getCachedKeywords,
  cacheKeywords,
  createViralPost,
  getViralPostsBySession,
  updateViralPostData,
  updateViralPostVerification,
  getStyleById,
  createScript,
} from "../db";
import { parseXHSLink, cleanAuthorName } from "./xhs-scraper";
import { parsePostWithOpenCLI } from "./xhs-search";
import { normalizeXHSLink } from "../utils";
import {
  FILTER_THRESHOLDS,
  ProgressEvent,
  ViralPostData,
  FilterDetail,
  VerifyResult,
} from "../types";

// 重新导出，保持向后兼容
export { FILTER_THRESHOLDS, ProgressEvent, ViralPostData, FilterDetail, VerifyResult };
export type { ProgressEvent as ProgressEventType };

export interface PipelineContext {
  sessionId: string;
  topic: string;
  styleId?: string;
  // Step1 产出
  keywords?: string[];
  relatedKeywords?: string[];
  // Step2 产出
  viralPosts?: ViralPostData[];
  // Step3 产出
  verifiedPost?: ViralPostData;
  verifyResult?: VerifyResult;
  // Step4 产出
  rewrittenContent?: string;
  scriptId?: string;
}

// ========== Pipeline 执行 ==========

/**
 * 执行完整 Pipeline（SSE 流式）
 * 每步产出通过 yield 推送给前端
 */
export async function* executePipeline(
  topic: string,
  styleId?: string,
  existingSessionId?: string
): AsyncGenerator<ProgressEvent, PipelineContext, void> {
  // 如果提供了已有会话 ID，则复用；否则创建新会话
  const sessionId = existingSessionId || uuid();
  const ctx: PipelineContext = { sessionId, topic, styleId };

  if (!existingSessionId) {
    // 新会话：创建
    createSession(sessionId, topic, styleId);
  } else {
    // 已有会话：先加载关键词（如果有的话）
    const cached = getCachedKeywords(topic);
    if (cached) {
      const { core, related } = splitKeywords(cached);
      ctx.keywords = core;
      ctx.relatedKeywords = related;
    }
  }

  // 获取已有步骤，判断哪些已完成
  const existingSteps = existingSessionId ? getStepsBySession(sessionId) : [];
  const completedStepNames = new Set(
    existingSteps.filter((s: any) => s.status === "completed").map((s: any) => s.step_name)
  );

  const steps = [
    { name: "keywords" as const, order: 1, label: "🔍 关键词生成", fn: () => runKeywordsStep(ctx), skipIfCompleted: true },
    { name: "search" as const,    order: 2, label: "📊 爆款搜索",     fn: () => runSearchStep(ctx),   skipIfCompleted: false },
    { name: "verify" as const,    order: 3, label: "✅ 爆款验证",     fn: () => runVerifyStep(ctx),   skipIfCompleted: true },
    { name: "rewrite" as const,   order: 4, label: "✏️ 二创改写",     fn: () => runRewriteStep(ctx),  skipIfCompleted: true },
  ];

  for (const step of steps) {
    if (step.skipIfCompleted && completedStepNames.has(step.name)) {
      yield {
        type: "step_complete",
        step: step.name,
        stepOrder: step.order,
        message: `${step.label}（已完成，跳过）`,
        data: { skipped: true },
      };
      continue;
    }

    const stepId = uuid();
    createStep(stepId, sessionId, step.name, step.order);

    // 推送步骤开始
    updateSessionStatus(sessionId, "running", step.name);
    yield {
      type: "step_start",
      step: step.name,
      stepOrder: step.order,
      message: `${step.label}开始...`,
    };

    try {
      updateStepStatus(stepId, "running");
      await step.fn();

      updateStepStatus(stepId, "completed", JSON.stringify(getStepOutput(ctx, step.name)));
      yield {
        type: "step_complete",
        step: step.name,
        stepOrder: step.order,
        message: `${step.label}完成`,
        data: getStepOutput(ctx, step.name),
      };
    } catch (err: any) {
      updateStepStatus(stepId, "failed", undefined, err.message || "未知错误");
      yield {
        type: "step_error",
        step: step.name,
        stepOrder: step.order,
        message: `${step.label}失败: ${err.message}`,
        data: { error: err.message },
      };
      // 继续执行下一步（不阻断流程）
    }
  }

  // Pipeline 完成
  updateSessionStatus(sessionId, "completed", "done");
  yield {
    type: "pipeline_complete",
    message: "全部步骤完成",
    data: {
      sessionId,
      hasRewrittenScript: !!ctx.rewrittenContent,
      scriptId: ctx.scriptId,
    },
  };

  return ctx;
}

// ========== 工具函数 ==========

/**
 * 安全解析 AI 返回的 JSON，自动处理 markdown 代码块和额外文本
 */
function safeParseJson(text: string): any {
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

/** URL 去重别名（自注释，指向统一工具函数） */
const stripQs = (u: string): string => normalizeXHSLink(u, { stripQuery: true });

/**
 * 将关键词数组按 60/40 比例分割为核心词和关联词
 * @returns core 前 60%，related 后 40%
 */
function splitKeywords(arr: string[]): { core: string[]; related: string[] } {
  const mid = Math.ceil(arr.length * 0.6);
  return { core: arr.slice(0, mid), related: arr.slice(mid) };
}

// ========== 各步骤实现 ==========

async function runKeywordsStep(ctx: PipelineContext): Promise<void> {
  // 1. 检查缓存
  const cached = getCachedKeywords(ctx.topic);
  if (cached) {
    // 缓存命中时分类：前一半为 core，后一半为 related（或按原始结构）
    if (Array.isArray(cached) && cached.length > 0) {
      const { core, related } = splitKeywords(cached);
      ctx.keywords = core;
      ctx.relatedKeywords = related;
      return;
    }
  }

  // 2. 调用 AI 生成关键词
  const response = await chat({
    systemPrompt: KEYWORDS_SYSTEM_PROMPT,
    userPrompt: buildKeywordsUserPrompt(ctx.topic),
    temperature: 0.7,
    responseFormat: "json_object",
  });

  // 3. 解析 JSON（使用 safeParseJson 统一处理 markdown 代码块等边缘情况）
  try {
    const parsed = safeParseJson(response);
    ctx.keywords = parsed.core_keywords || [];
    ctx.relatedKeywords = parsed.related_keywords || [];
  } catch {
    // 降级：按行分割
    const lines = response
      .split("\n")
      .map((l) => l.replace(/^[-\d.]+\s*/, "").trim())
      .filter((l) => l.length > 0);
    const { core, related } = splitKeywords(lines);
    ctx.keywords = core;
    ctx.relatedKeywords = related;
  }

  // 4. 缓存
  const allKeywords = [...(ctx.keywords || []), ...(ctx.relatedKeywords || [])];
  if (allKeywords.length > 0) {
    cacheKeywords(ctx.topic, allKeywords);
  }
}

function mapDbRowToViralPost(row: any): ViralPostData {
  return {
    id: row.id,
    xhsUrl: row.xhs_url,
    title: row.title,
    authorName: row.author_name,
    authorFollowers: row.author_followers,
    likes: row.likes,
    collects: row.collects,
    comments: row.comments,
    durationSeconds: row.duration_seconds,
    publishedAt: row.published_at,
    scriptContent: row.script_content,
    postType: row.post_type || "note",
  };
}

async function runSearchStep(ctx: PipelineContext): Promise<void> {
  // Step2 默认无需操作（用户手动粘贴链接）
  // 如果有从 Step1 传递的关键词，这里可以预先展示给用户
  // 实际的搜索/解析由用户通过 addViralPost API 触发

  // 从已保存的帖子中加载
  const existingPosts = getViralPostsBySession(ctx.sessionId);
  if (existingPosts.length > 0) {
    ctx.viralPosts = existingPosts.map(mapDbRowToViralPost);
  }
}

/**
 * 添加小红书链接到当前会话
 * 由前端触发调用（非 Pipeline 步骤自动执行）
 */
export async function addViralPostToSession(
  sessionId: string,
  xhsUrl: string
): Promise<ViralPostData> {
  // 检查是否已被搜索结果导入过（复用已有数据，避免 scraper 覆盖好数据）
  const normalizedUrl = xhsUrl.trim();
  try {
    const existingPosts = getViralPostsBySession(sessionId);
    const existing = existingPosts.find((p: any) => {
      const dbUrl = (p.xhs_url || "").trim();
      if (!dbUrl) return false;
      return stripQs(dbUrl) === stripQs(normalizedUrl);
    });
    if (existing && (existing.likes || 0) > 0) {
      console.log(`[pipeline] URL 已被搜索结果导入（likes=${existing.likes}），跳过 scraper：${normalizedUrl}`);
      return mapDbRowToViralPost(existing);
    }
  } catch {
    // 检查失败不影响主流程
  }

  // 解析链接
  const parsed = await parseXHSLink(xhsUrl);

  // 存入数据库
  const postId = uuid();
  createViralPost({
    id: postId,
    sessionId,
    xhsUrl: parsed.url,
    title: parsed.title,
    authorName: parsed.authorName,
    authorFollowers: parsed.authorFollowers,
    likes: parsed.likes,
    collects: parsed.collects,
    comments: parsed.comments,
    durationSeconds: parsed.durationSeconds ?? undefined,
    publishedAt: parsed.publishedAt || undefined,
    scriptContent: parsed.content,
    postType: parsed.postType,
    metadata: parsed.rawData ? JSON.stringify(parsed.rawData) : undefined,
  });

  return {
    id: postId,
    xhsUrl: parsed.url,
    title: parsed.title,
    authorName: parsed.authorName,
    authorFollowers: parsed.authorFollowers,
    likes: parsed.likes,
    collects: parsed.collects,
    comments: parsed.comments,
    durationSeconds: parsed.durationSeconds ?? undefined,
    publishedAt: parsed.publishedAt || undefined,
    scriptContent: parsed.content,
    postType: parsed.postType,
  };
}

/**
 * 批量添加小红书链接
 */
export async function addViralPostsToSession(
  sessionId: string,
  urls: string[]
): Promise<ViralPostData[]> {
  const settled = await Promise.allSettled(
    urls.map((url) => addViralPostToSession(sessionId, url))
  );
  return settled
    .filter((s): s is PromiseFulfilledResult<ViralPostData> => s.status === "fulfilled")
    .map((s) => s.value);
}

/**
 * 从搜索结果批量添加帖子（保留搜索元数据，优先通过 OpenCLI 提取内容）
 */
export async function addViralPostsFromSearchResults(
  sessionId: string,
  results: Array<{
    url: string;
    title?: string;
    snippet?: string;
    keyword?: string;
    xsecToken?: string;
    postType?: "video" | "note";
    likes?: number;
  }>
): Promise<ViralPostData[]> {
  const posts: ViralPostData[] = [];

  // 先加载会话中已有的帖子，避免重复导入
  const existingPosts = getViralPostsBySession(sessionId);
  const existingUrlSet = new Set(
    existingPosts
      .map((p: any) => (p.xhs_url || "").trim())
      .filter(Boolean)
      .map(stripQs)
  );

  for (const r of results) {
    // 防御：跳过 URL 为空的异常条目
    if (!r.url) continue;

    // 去重检查：若该 URL 已存在于会话中，跳过
    const normalizedForDedup = stripQs(r.url.trim());
    if (existingUrlSet.has(normalizedForDedup)) {
      console.log(`[pipeline] 搜索结果 URL 已存在于会话中，跳过: ${r.url}`);
      // 将已有帖子加入返回列表（前端期望看到全部导入结果）
      const existing = existingPosts.find((p: any) => stripQs((p.xhs_url || "").trim()) === normalizedForDedup);
      if (existing) {
        posts.push(mapDbRowToViralPost(existing));
      }
      continue;
    }

    try {
      // 从 snippet 中解析作者和点赞（格式："作者名 · 👍 741"）
      let authorName = "";
      let likes: number | undefined = r.likes;

      // 始终从 snippet 提取 authorName（不受 likes 有无影响）
      if (r.snippet) {
        const parts = r.snippet.split(" · ");
        authorName = cleanAuthorName(parts[0] || "");

        // likes 仅在搜索阶段没有时从 snippet 解析
        if (likes == null) {
          const likeMatch = r.snippet.match(/👍\s*([\d.]+万?)/);
          if (likeMatch) {
            const val = likeMatch[1];
            likes = val.endsWith("万") ? parseFloat(val) * 10000 : parseInt(val, 10);
          }
        }
      }

      // ===== 策略 A: 通过 OpenCLI 获取帖子完整内容（优先，如果登录且 token 可用）=====
      let scriptContent = "";
      // OpenCLI 提取的完整字段（非零非空值才使用）
      let opencliCollects: number | undefined;
      let opencliComments: number | undefined;
      let opencliFollowers: number | undefined;
      let opencliPublishedAt: string | undefined;
      let opencliDuration: number | undefined;
      let opencliSuccess = false;

      if (r.xsecToken) {
        const parsed = await parsePostWithOpenCLI(r.url, r.xsecToken);
        if (parsed) {
          scriptContent = parsed.desc;
          opencliSuccess = true;

          // 只在搜索阶段没有有效数据时才使用 OpenCLI 的值（防止覆盖搜索阶段已有的好数据）
          if (likes == null || likes === 0) likes = parsed.likes;
          if (!authorName) authorName = parsed.authorName || "";
          if (parsed.collects > 0) opencliCollects = parsed.collects;
          if (parsed.comments > 0) opencliComments = parsed.comments;
          if (parsed.authorFollowers && parsed.authorFollowers > 0) opencliFollowers = parsed.authorFollowers;
          if (parsed.publishedAt) opencliPublishedAt = parsed.publishedAt;
          if (parsed.durationSeconds != null) opencliDuration = parsed.durationSeconds;

          console.log(`[pipeline] ✅ OpenCLI 提取帖子成功: ${r.url}`);
          console.log(`[pipeline]    → likes=${parsed.likes}, collects=${parsed.collects}, comments=${parsed.comments}, followers=${parsed.authorFollowers ?? "NULL"}, publishedAt=${parsed.publishedAt || "NULL"}, duration=${parsed.durationSeconds ?? "NULL"}, descLen=${parsed.desc.length}`);
        }
      }

      // 创建帖子记录（优先使用 OpenCLI 数据，搜索元数据兜底）
      const postId = uuid();
      createViralPost({
        id: postId,
        sessionId,
        xhsUrl: r.url,
        title: r.title || "",
        authorName,
        likes,
        collects: opencliCollects,
        comments: opencliComments,
        authorFollowers: opencliFollowers,
        durationSeconds: opencliDuration,
        publishedAt: opencliPublishedAt,
        scriptContent,
        postType: r.postType,
      });
      existingUrlSet.add(normalizedForDedup); // 标记为已添加，避免同一批次内的重复

      // ===== 策略 B: scraper 降级（仅当 OpenCLI 未获取到 desc 时才触发）=====
      // 合并变量：优先 OpenCLI → 搜索元数据 → scraper 补充
      let scraperCollects: number | undefined;
      let scraperComments: number | undefined;
      let scraperFollowers: number | undefined;
      let scraperPublishedAt: string | undefined;
      let scraperDuration: number | undefined;
      let scraperLikes: number | undefined;
      let scraperAuthorName: string | undefined;
      let scraperContent: string | undefined;

      if (!opencliSuccess) {
        try {
          const scraped = await parseXHSLink(r.url);
          if (scraped) {
            scraperLikes = scraped.likes > 0 ? scraped.likes : undefined;
            scraperCollects = scraped.collects > 0 ? scraped.collects : undefined;
            scraperComments = scraped.comments > 0 ? scraped.comments : undefined;
            scraperFollowers = scraped.authorFollowers > 0 ? scraped.authorFollowers : undefined;
            scraperPublishedAt = scraped.publishedAt ?? undefined;
            scraperDuration = scraped.durationSeconds ?? undefined;
            scraperAuthorName = scraped.authorName || undefined;
            scraperContent = scraped.content || undefined;

            // merge 策略：仅当 scraper 有非零/非空值且 OpenCLI/搜索阶段无有效数据时才更新 DB
            updateViralPostData(postId, {
              authorName: !authorName && scraperAuthorName ? scraperAuthorName : undefined,
              authorFollowers: (opencliFollowers == null || opencliFollowers === 0) && scraperFollowers ? scraperFollowers : undefined,
              likes: (likes == null || likes === 0) && scraperLikes ? scraperLikes : undefined,
              collects: (opencliCollects == null || opencliCollects === 0) && scraperCollects ? scraperCollects : undefined,
              comments: (opencliComments == null || opencliComments === 0) && scraperComments ? scraperComments : undefined,
              durationSeconds: opencliDuration == null && scraperDuration != null ? scraperDuration : undefined,
              publishedAt: !opencliPublishedAt && scraperPublishedAt ? scraperPublishedAt : undefined,
              scriptContent: !scriptContent && scraperContent ? scraperContent : undefined,
            });

            console.log(`[pipeline] ✅ scraper 降级补充数据成功: ${r.url}`);
            console.log(`[pipeline]    → collect=${scraperCollects ?? "NULL"}, comments=${scraperComments ?? "NULL"}, followers=${scraperFollowers ?? "NULL"}, likes=${scraperLikes ?? "NULL"}, publishedAt=${scraperPublishedAt || "NULL"}, duration=${scraperDuration ?? "NULL"}, hasContent=${!!scraped.content}`);
          }
        } catch (err: any) {
          console.error(`[pipeline] ❌ scraper 降级补充数据失败（不阻断，URL=${r.url}）:`);
          console.error(`[pipeline]    error.name: ${err.name}`);
          console.error(`[pipeline]    error.message: ${err.message}`);
          console.error(`[pipeline]    error.stack: ${err.stack?.slice(0, 300)}`);
          console.error(`[pipeline]    搜索结果原数据: title="${(r.title || "").slice(0, 50)}", likes=${r.likes}, postType=${r.postType}, snippet="${(r.snippet || "").slice(0, 50)}"`);
        }
      } else {
        console.log(`[pipeline] ⏭️ 跳过 scraper（OpenCLI 已提取完整内容）: ${r.url}`);
      }

      // 构建返回对象（OpenCLI 优先 → 搜索元数据 → scraper 补充）
      const mergedLikes = (likes ?? 0) > 0 ? likes : scraperLikes ?? likes;
      const mergedAuthorName = authorName || scraperAuthorName || "";
      const mergedContent = scriptContent || scraperContent || "";
      posts.push({
        id: postId,
        xhsUrl: r.url,
        title: r.title || "",
        authorName: mergedAuthorName,
        authorFollowers: (opencliFollowers && opencliFollowers > 0) ? opencliFollowers : scraperFollowers,
        likes: mergedLikes,
        collects: (opencliCollects && opencliCollects > 0) ? opencliCollects : scraperCollects,
        comments: (opencliComments && opencliComments > 0) ? opencliComments : scraperComments,
        durationSeconds: opencliDuration ?? scraperDuration,
        publishedAt: opencliPublishedAt || scraperPublishedAt,
        scriptContent: mergedContent,
        postType: r.postType,
      });
    } catch (err: any) {
      console.error(`[pipeline] 从搜索结果添加帖子失败 (${r.url}):`, err.message || err);
      // 跳过失败项，继续处理其他结果
    }
  }

  return posts;
}

// ========== 四维过滤（纯数学计算） ==========

/**
 * 将 publishedAt 文本解析为有效的时间戳（毫秒）
 * 支持：ISO 日期、中文日期、相对时间（"发布于307天前"等）
 * 返回 null 表示无法解析
 */
function parsePublishedAtToTimestamp(raw: string | undefined): number | null {
  if (!raw) return null;

  // 1. 直接解析（ISO 字符串、时间戳等）
  const parsed = new Date(raw);
  const ts = parsed.getTime();
  // 必须在合理范围：非未来、不早于 10 年前
  if (!isNaN(ts) && ts <= Date.now() && ts > Date.now() - 10 * 365 * 24 * 60 * 60 * 1000) {
    return ts;
  }

  // 2. 尝试相对时间："发布于307天前" / "发布于 2天前" / "3小时前" / "刚刚"
  let m = raw.match(/发布于?\s*(\d+)\s*天前/);
  if (m) {
    const days = parseInt(m[1], 10);
    if (days >= 0 && days <= 3650) return Date.now() - days * 86400000;
  }

  m = raw.match(/发布于?\s*(\d+)\s*小时前/);
  if (m) return Date.now() - parseInt(m[1], 10) * 3600000;

  m = raw.match(/发布于?\s*(\d+)\s*分钟前/);
  if (m) return Date.now() - parseInt(m[1], 10) * 60000;

  if (raw.includes("刚刚")) return Date.now();

  // 3. 尝试中文日期："2025年5月28日" / "5月28日"
  m = raw.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T00:00:00+08:00`).getTime();

  m = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    const mo = parseInt(m[1], 10);
    const d = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const y = new Date().getFullYear();
      return new Date(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+08:00`).getTime();
    }
  }

  return null;
}

/**
 * 根据帖子数据计算四维匹配度，替代 AI 验证（更快、零成本、确定性）
 */
function computeFilterDetails(post: ViralPostData): NonNullable<VerifyResult["filterDetails"]> {
  // 1. 时效性：基于发布时间
  let timeliness: FilterDetail;
  if (post.publishedAt) {
    const ts = parsePublishedAtToTimestamp(post.publishedAt);
    if (ts !== null) {
      const monthsAgo = (Date.now() - ts) / (1000 * 60 * 60 * 24 * 30);
      if (monthsAgo <= 3) {
        timeliness = { passed: true, matchPercent: 100, requirement: "发布时间在半年内", actual: `发布于 ${Math.round(monthsAgo)} 个月前` };
      } else if (monthsAgo <= 6) {
        timeliness = { passed: true, matchPercent: 80, requirement: "发布时间在半年内", actual: `发布于 ${Math.round(monthsAgo)} 个月前` };
      } else if (monthsAgo <= 12) {
        timeliness = { passed: false, matchPercent: 50, requirement: "发布时间在半年内", actual: `发布于 ${Math.round(monthsAgo)} 个月前` };
      } else {
        timeliness = { passed: false, matchPercent: 25, requirement: "发布时间在半年内", actual: `发布于 ${Math.round(monthsAgo)} 个月前` };
      }
    } else {
      timeliness = { passed: true, matchPercent: 50, requirement: "发布时间在半年内", actual: "发布时间未知" };
    }
  } else {
    timeliness = { passed: true, matchPercent: 50, requirement: "发布时间在半年内", actual: "发布时间未知" };
  }

  // 2. 时长：仅视频有要求
  let duration: FilterDetail;
  if (post.postType === "note") {
    duration = { passed: true, matchPercent: 100, requirement: "30秒~3分钟（仅视频）", actual: "图文帖子" };
  } else if (post.durationSeconds != null) {
    const sec = post.durationSeconds;
    if (sec >= 30 && sec <= 180) {
      duration = { passed: true, matchPercent: 100, requirement: "30秒~3分钟", actual: `${Math.floor(sec / 60)}分${sec % 60}秒` };
    } else if ((sec >= 20 && sec < 30) || (sec > 180 && sec <= 210)) {
      duration = { passed: true, matchPercent: 90, requirement: "30秒~3分钟", actual: `${Math.floor(sec / 60)}分${sec % 60}秒` };
    } else if ((sec >= 10 && sec < 20) || (sec > 210 && sec <= 240)) {
      duration = { passed: false, matchPercent: 70, requirement: "30秒~3分钟", actual: `${Math.floor(sec / 60)}分${sec % 60}秒` };
    } else {
      duration = { passed: false, matchPercent: 50, requirement: "30秒~3分钟", actual: `${Math.floor(sec / 60)}分${sec % 60}秒` };
    }
  } else {
    duration = { passed: true, matchPercent: 50, requirement: "30秒~3分钟（仅视频）", actual: "时长未知" };
  }

  // 3. 数据质量：点赞/收藏/评论 三项加权
  let dataQuality: FilterDetail;
  const likes = post.likes ?? 0;
  const collects = post.collects ?? 0;
  const comments = post.comments ?? 0;
  const ratioOk = collects === 0 || likes / collects <= 20; // 赞藏比不过于悬殊

  const T = FILTER_THRESHOLDS.dataQuality;
  const dataScore = Math.round(
    (Math.min(likes / T.likes, 1) + Math.min(collects / T.collects, 1) + Math.min(comments / T.comments, 1)) / 3 * 100
  );
  const actualParts: string[] = [];
  if (likes > 0) actualParts.push(`点赞${likes.toLocaleString()}`);
  if (collects > 0) actualParts.push(`收藏${collects.toLocaleString()}`);
  if (comments > 0) actualParts.push(`评论${comments.toLocaleString()}`);
  dataQuality = {
    passed: dataScore >= 60 && ratioOk,
    matchPercent: ratioOk ? dataScore : Math.min(dataScore, 60),
    requirement: `点赞>${T.likes.toLocaleString()}, 收藏>${T.collects.toLocaleString()}, 评论>${T.comments}`,
    actual: actualParts.length > 0 ? actualParts.join(", ") : "数据缺失",
  };

  // 4. 作者质量：粉丝数
  let authorQuality: FilterDetail;
  const followers = post.authorFollowers ?? 0;
  if (followers === 0) {
    authorQuality = { passed: true, matchPercent: 50, requirement: "粉丝<10万, 最佳几千~3万", actual: "粉丝数未知" };
  } else if (followers >= 3000 && followers <= 30000) {
    authorQuality = { passed: true, matchPercent: 100, requirement: "粉丝<10万, 最佳几千~3万", actual: `粉丝${followers.toLocaleString()}` };
  } else if ((followers >= 1000 && followers < 3000) || (followers > 30000 && followers <= 50000)) {
    authorQuality = { passed: true, matchPercent: 90, requirement: "粉丝<10万, 最佳几千~3万", actual: `粉丝${followers.toLocaleString()}` };
  } else if (followers > 50000 && followers <= 100000) {
    authorQuality = { passed: false, matchPercent: 70, requirement: "粉丝<10万, 最佳几千~3万", actual: `粉丝${followers.toLocaleString()}` };
  } else if (followers > 100000) {
    authorQuality = { passed: false, matchPercent: 40, requirement: "粉丝<10万, 最佳几千~3万", actual: `粉丝${followers.toLocaleString()}` };
  } else {
    authorQuality = { passed: true, matchPercent: 80, requirement: "粉丝<10万, 最佳几千~3万", actual: `粉丝${followers.toLocaleString()}` };
  }

  return { timeliness, duration, dataQuality, authorQuality };
}

async function runVerifyStep(ctx: PipelineContext): Promise<void> {
  const posts: ViralPostData[] =
    ctx.viralPosts?.length
      ? ctx.viralPosts
      : getViralPostsBySession(ctx.sessionId).map(mapDbRowToViralPost);

  if (posts.length === 0) {
    throw new Error("没有可验证的帖子，请先添加小红书链接");
  }

  // 纯数学计算四维过滤，选四维均值最高的帖子
  let bestPost: ViralPostData | undefined;
  let bestResult: VerifyResult | undefined;
  let bestAvg = -1;

  for (const post of posts) {
    const filterDetails = computeFilterDetails(post);
    const dims = [filterDetails.timeliness, filterDetails.duration, filterDetails.dataQuality, filterDetails.authorQuality];
    const avgMatch = dims.reduce((sum, d) => sum + (d?.matchPercent ?? 0), 0) / dims.length;
    const allPassed = dims.every((d) => d?.passed !== false);

    const result: VerifyResult = { passesFilter: allPassed, filterDetails };

    if (post.id) {
      const notes = [
        allPassed ? "✅ 四维通过" : "⚠️ 部分维度未通过",
        `均值: ${Math.round(avgMatch)}%`,
      ].join(" | ");
      updateViralPostVerification(post.id, allPassed, notes);
    }

    if (avgMatch > bestAvg) {
      bestAvg = avgMatch;
      bestPost = post;
      bestResult = result;
    }
  }

  ctx.verifiedPost = bestPost ?? posts[0];
  ctx.verifyResult = bestResult ?? {
    passesFilter: true,
    filterDetails: computeFilterDetails(posts[0]),
  };
}

async function runRewriteStep(ctx: PipelineContext): Promise<void> {
  const post = ctx.verifiedPost;
  if (!post) {
    throw new Error("没有选中的爆款帖子，无法进行二创");
  }

  if (!post.scriptContent) {
    throw new Error("该帖子没有提取到脚本内容，请手动粘贴原文");
  }

  // 获取风格名
  let styleName: string | undefined;
  if (ctx.styleId) {
    const style = getStyleById(ctx.styleId);
    styleName = style?.name;
  }

  // 调用 AI 改写
  const systemPrompt = buildRewriterSystemPrompt(styleName);
  const userPrompt = buildRewriterUserPrompt(
    ctx.topic,
    post.scriptContent,
    post.xhsUrl
    // strength 和 rewriteSuggestion 已移除（Step 3 改为纯数学计算）
  );

  // 使用非流式调用（流式内容由 routes/pipeline.ts 处理）
  const content = await chat({
    systemPrompt,
    userPrompt,
    temperature: 0.8,
    maxTokens: 4096,
  });

  ctx.rewrittenContent = content;

  // 保存到 scripts 表
  const scriptId = uuid();
  createScript(
    scriptId,
    ctx.topic,
    ctx.styleId || "",
    styleName || "二创改写",
    content,
    ctx.sessionId,
    post.xhsUrl,
    post.scriptContent
  );

  ctx.scriptId = scriptId;
}

// ========== 辅助函数 ==========

function getStepOutput(ctx: PipelineContext, stepName: string): any {
  switch (stepName) {
    case "keywords":
      return {
        keywords: ctx.keywords,
        relatedKeywords: ctx.relatedKeywords,
      };
    case "search":
      return { viralPosts: ctx.viralPosts };
    case "verify":
      return {
        verifiedPost: ctx.verifiedPost,
        verifyResult: ctx.verifyResult,
      };
    case "rewrite":
      return {
        scriptId: ctx.scriptId,
        content: ctx.rewrittenContent,
        sourceUrl: ctx.verifiedPost?.xhsUrl,
        originalScript: ctx.verifiedPost?.scriptContent,
      };
    default:
      return null;
  }
}
