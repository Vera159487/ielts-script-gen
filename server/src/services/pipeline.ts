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
import { chat, chatStream } from "./ai";
import {
  KEYWORDS_SYSTEM_PROMPT,
  buildKeywordsUserPrompt,
} from "./prompts/keywords";
import {
  VERIFIER_SYSTEM_PROMPT,
  buildVerifierUserPrompt,
} from "./prompts/verifier";
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
  updateViralPostVerification,
  getStyleById,
  createScript,
} from "../db";
import { parseXHSLink } from "./xhs-scraper";

// ========== 类型定义 ==========

export interface ProgressEvent {
  type: "step_start" | "step_progress" | "step_complete" | "step_error" | "pipeline_complete";
  step?: string;
  stepOrder?: number;
  message: string;
  data?: any;
}

export interface ViralPostData {
  id?: string;
  xhsUrl: string;
  title?: string;
  authorName?: string;
  authorFollowers?: number;
  likes?: number;
  collects?: number;
  comments?: number;
  durationSeconds?: number;
  publishedAt?: string;
  scriptContent?: string;
}

export interface VerifyResult {
  passesFilter: boolean;
  isGenericViral: boolean;
  genericScore: number;
  strength?: string;
  weakness?: string;
  rewriteSuggestion?: string;
  filterDetails?: any;
}

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
      const mid = Math.ceil(cached.length * 0.6);
      ctx.keywords = cached.slice(0, mid);
      ctx.relatedKeywords = cached.slice(mid);
    }
  }

  // 获取已有步骤，判断哪些已完成
  const existingSteps = existingSessionId ? getStepsBySession(sessionId) : [];
  const completedStepNames = new Set(
    existingSteps.filter((s: any) => s.status === "completed").map((s: any) => s.step_name)
  );

  const steps = [
    {
      name: "keywords" as const,
      order: 1,
      label: "🔍 关键词生成",
      fn: () => runKeywordsStep(ctx),
    },
    {
      name: "search" as const,
      order: 2,
      label: "📊 爆款搜索",
      fn: () => runSearchStep(ctx),
    },
    {
      name: "verify" as const,
      order: 3,
      label: "✅ 爆款验证",
      fn: () => runVerifyStep(ctx),
    },
    {
      name: "rewrite" as const,
      order: 4,
      label: "✏️ 二创改写",
      fn: () => runRewriteStep(ctx),
    },
  ];

  for (const step of steps) {
    // 跳过已完成的步骤（除非是 search 步骤，需要重新加载帖子）
    if (completedStepNames.has(step.name) && step.name !== "search") {
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

// ========== 各步骤实现 ==========

async function runKeywordsStep(ctx: PipelineContext): Promise<void> {
  // 1. 检查缓存
  const cached = getCachedKeywords(ctx.topic);
  if (cached) {
    // 缓存命中时分类：前一半为 core，后一半为 related（或按原始结构）
    if (Array.isArray(cached) && cached.length > 0) {
      // 尝试按存储格式解析
      const mid = Math.ceil(cached.length * 0.6);
      ctx.keywords = cached.slice(0, mid);
      ctx.relatedKeywords = cached.slice(mid);
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

  // 3. 解析 JSON
  try {
    const parsed = JSON.parse(response.trim());
    ctx.keywords = parsed.core_keywords || [];
    ctx.relatedKeywords = parsed.related_keywords || [];
  } catch {
    // 降级：按行分割
    const lines = response
      .split("\n")
      .map((l) => l.replace(/^[-\d.]+\s*/, "").trim())
      .filter((l) => l.length > 0);
    const mid = Math.ceil(lines.length * 0.6);
    ctx.keywords = lines.slice(0, mid);
    ctx.relatedKeywords = lines.slice(mid);
  }

  // 4. 缓存
  const allKeywords = [...(ctx.keywords || []), ...(ctx.relatedKeywords || [])];
  if (allKeywords.length > 0) {
    cacheKeywords(ctx.topic, allKeywords);
  }
}

async function runSearchStep(ctx: PipelineContext): Promise<void> {
  // Step2 默认无需操作（用户手动粘贴链接）
  // 如果有从 Step1 传递的关键词，这里可以预先展示给用户
  // 实际的搜索/解析由用户通过 addViralPost API 触发

  // 从已保存的帖子中加载
  const existingPosts = getViralPostsBySession(ctx.sessionId);
  if (existingPosts.length > 0) {
    ctx.viralPosts = existingPosts.map((p: any) => ({
      id: p.id,
      xhsUrl: p.xhs_url,
      title: p.title,
      authorName: p.author_name,
      authorFollowers: p.author_followers,
      likes: p.likes,
      collects: p.collects,
      comments: p.comments,
      durationSeconds: p.duration_seconds,
      publishedAt: p.published_at,
      scriptContent: p.script_content,
    }));
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
    durationSeconds: parsed.durationSeconds || undefined,
    publishedAt: parsed.publishedAt || undefined,
    scriptContent: parsed.content,
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
    durationSeconds: parsed.durationSeconds || undefined,
    publishedAt: parsed.publishedAt || undefined,
    scriptContent: parsed.content,
  };
}

/**
 * 批量添加小红书链接
 */
export async function addViralPostsToSession(
  sessionId: string,
  urls: string[]
): Promise<ViralPostData[]> {
  const results: ViralPostData[] = [];
  for (const url of urls) {
    try {
      const post = await addViralPostToSession(sessionId, url);
      results.push(post);
    } catch {
      // 跳过解析失败的链接
    }
  }
  return results;
}

async function runVerifyStep(ctx: PipelineContext): Promise<void> {
  // 获取该会话的帖子列表
  const posts: ViralPostData[] =
    ctx.viralPosts?.length
      ? ctx.viralPosts
      : getViralPostsBySession(ctx.sessionId).map((p: any) => ({
          id: p.id,
          xhsUrl: p.xhs_url,
          title: p.title,
          authorName: p.author_name,
          authorFollowers: p.author_followers,
          likes: p.likes,
          collects: p.collects,
          comments: p.comments,
          durationSeconds: p.duration_seconds,
          publishedAt: p.published_at,
          scriptContent: p.script_content,
        }));

  if (posts.length === 0) {
    throw new Error("没有可验证的帖子，请先添加小红书链接");
  }

  // 逐条验证
  for (const post of posts) {
    try {
      const response = await chat({
        systemPrompt: VERIFIER_SYSTEM_PROMPT,
        userPrompt: buildVerifierUserPrompt({
          title: post.title,
          authorName: post.authorName,
          authorFollowers: post.authorFollowers,
          likes: post.likes,
          collects: post.collects,
          comments: post.comments,
          durationSeconds: post.durationSeconds,
          publishedAt: post.publishedAt,
          scriptContent: post.scriptContent,
        }),
        temperature: 0.5,
        responseFormat: "json_object",
      });

      const result: VerifyResult = JSON.parse(response.trim());

      // 更新数据库
      if (post.id) {
        const notes = [
          result.isGenericViral ? "✅ 通用爆款" : "⚠️ 非通用爆款",
          `评分: ${result.genericScore}/10`,
          result.strength ? `亮点: ${result.strength}` : "",
          result.weakness ? `风险: ${result.weakness}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
        updateViralPostVerification(post.id, result.isGenericViral, notes);
      }

      // 保存第一个验证通过的爆款
      if (result.isGenericViral && !ctx.verifiedPost) {
        ctx.verifiedPost = post;
        ctx.verifyResult = result;
      }
    } catch {
      // 单条验证失败，继续下一条
    }
  }

  // 如果没找到通用爆款，使用第一条帖子
  if (!ctx.verifiedPost && posts.length > 0) {
    ctx.verifiedPost = posts[0];
    ctx.verifyResult = {
      passesFilter: true,
      isGenericViral: false,
      genericScore: 5,
      strength: "未经过严格验证，仅供参考",
    };
  }
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
    const style = getStyleById(ctx.styleId) as any;
    styleName = style?.name;
  }

  // 调用 AI 改写
  const systemPrompt = buildRewriterSystemPrompt(styleName);
  const userPrompt = buildRewriterUserPrompt(
    ctx.topic,
    post.scriptContent,
    post.xhsUrl,
    ctx.verifyResult?.strength,
    ctx.verifyResult?.rewriteSuggestion
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
      };
    default:
      return null;
  }
}
