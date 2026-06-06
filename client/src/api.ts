import type { Style, Script, Session, SessionDetail, ViralPost, XHSSearchResult, ProgressEvent, RewriteStreamCallbacks } from "./types";

const BASE = "/api";

// ========== 风格 ==========

export async function fetchStyles(): Promise<Style[]> {
  const res = await fetch(`${BASE}/styles`);
  if (!res.ok) throw new Error("获取风格失败");
  const data = await res.json();
  return data.styles;
}

// ========== 脚本（旧版兼容） ==========

export async function fetchScripts(
  limit = 50,
  offset = 0
): Promise<{ scripts: Script[]; total: number }> {
  const res = await fetch(`${BASE}/scripts?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("获取脚本列表失败");
  return res.json();
}

export async function fetchScript(id: string): Promise<Script> {
  const res = await fetch(`${BASE}/scripts/${id}`);
  if (!res.ok) throw new Error("获取脚本失败");
  const data = await res.json();
  return data.script;
}

export async function updateScript(id: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}/scripts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("保存失败");
}

export async function deleteScriptApi(id: string): Promise<void> {
  const res = await fetch(`${BASE}/scripts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除失败");
}

// ========== Pipeline ==========

/**
 * 共享 SSE 流读取器 — 正确处理跨 chunk 边界的行缓冲
 * 使用 parts.pop() 保留末尾不完整行，避免跨块事件丢失
 */
async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onData: (data: any) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // 流结束前处理缓冲区中剩余的最后一行（可能是没有尾随 \n 的最终事件）
      if (buffer.startsWith("data: ")) {
        try { onData(JSON.parse(buffer.slice(6))); } catch { /* 丢弃 */ }
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    // 最后一段可能是未完成的行，留在 buffer 等待下一个 chunk
    buffer = parts.pop() || "";

    for (const line of parts) {
      if (line.startsWith("data: ")) {
        try {
          onData(JSON.parse(line.slice(6)));
        } catch {
          // 跳过畸形 JSON 行
        }
      }
    }
  }
}

/**
 * 启动完整 Pipeline（SSE 流式）
 * 返回 abort 函数
 */
export function executePipeline(
  topic: string,
  styleId: string | undefined,
  callbacks: {
    onEvent: (event: ProgressEvent) => void;
    onError: (message: string) => void;
    onComplete: (data: any) => void;
  }
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/pipeline/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, styleId }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Pipeline 启动失败");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      await readSSEStream(reader, (data) => {
        if (data.type === "pipeline_complete") {
          callbacks.onComplete(data.data);
        } else {
          callbacks.onEvent(data as ProgressEvent);
        }
      });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message || "Pipeline 执行失败");
      }
    }
  })();

  return () => controller.abort();
}

/**
 * 继续执行 Pipeline（Step3+Step4）
 */
export function continuePipeline(
  sessionId: string,
  topic: string,
  styleId: string | undefined,
  callbacks: {
    onEvent: (event: ProgressEvent) => void;
    onError: (message: string) => void;
    onComplete: (data: any) => void;
  }
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/pipeline/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, topic, styleId }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("继续执行失败");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      await readSSEStream(reader, (data) => {
        if (data.type === "pipeline_complete") {
          callbacks.onComplete(data.data);
        } else {
          callbacks.onEvent(data as ProgressEvent);
        }
      });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message || "继续执行失败");
      }
    }
  })();

  return () => controller.abort();
}

/**
 * 流式二创改写（单独调用 Step4）
 */
export function streamRewrite(
  topic: string,
  styleId: string | undefined,
  originalScript: string,
  sourceUrl: string | undefined,
  callbacks: RewriteStreamCallbacks
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/pipeline/stream-rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, styleId, originalScript, sourceUrl }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("改写请求失败");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      await readSSEStream(reader, (data) => {
        if (data.type === "chunk") {
          callbacks.onChunk(data.content);
        } else if (data.type === "done") {
          callbacks.onDone(
            data.scriptId,
            data.content,
            data.sourceUrl,
            data.originalScript
          );
        } else if (data.type === "error") {
          callbacks.onError(data.message);
        }
      });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message || "改写失败");
      }
    }
  })();

  return () => controller.abort();
}

/**
 * 添加小红书链接到会话（支持传入搜索结果元数据以获取更完整的帖子信息）
 */
export async function addViralUrls(
  sessionId: string,
  urls: string[],
  searchResults?: Pick<XHSSearchResult, "url" | "title" | "snippet" | "keyword" | "xsecToken" | "postType" | "likes">[]
): Promise<{ posts: ViralPost[]; count: number }> {
  const body: any = { sessionId, urls };
  if (searchResults && searchResults.length > 0) {
    body.results = searchResults;
  }
  const res = await fetch(`${BASE}/pipeline/add-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("添加链接失败");
  return res.json();
}

export async function autoSearchXHS(
  keywords: string[],
  limit?: number,
  strategy?: "bing" | "opencli"
): Promise<{
  success: boolean;
  urls: string[];
  searchResults: XHSSearchResult[];
  stats: { keywordsSearched: number; totalLinksFound: number; uniqueLinks: number };
}> {
  const res = await fetch(`${BASE}/pipeline/auto-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords, limit, strategy }),
  });
  if (!res.ok) throw new Error("自动搜索失败");
  return res.json();
}

// ========== 会话管理 ==========

export async function fetchSessions(
  limit = 50,
  offset = 0
): Promise<{ sessions: Session[]; total: number }> {
  const res = await fetch(`${BASE}/sessions?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("获取会话列表失败");
  return res.json();
}

export async function fetchSessionDetail(id: string): Promise<SessionDetail> {
  const res = await fetch(`${BASE}/sessions/${id}`);
  if (!res.ok) throw new Error("获取会话详情失败");
  return res.json();
}

export async function deleteSessionApi(id: string): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除会话失败");
}

// ========== 旧版流式生成（保留兼容） ==========

export function generateScriptStream(
  topic: string,
  styleId: string,
  referenceScript: string | undefined,
  callbacks: {
    onChunk: (text: string) => void;
    onDone: (scriptId: string, fullContent: string) => void;
    onError: (message: string) => void;
  }
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, styleId, referenceScript }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("生成请求失败");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      await readSSEStream(reader, (data) => {
        if (data.type === "chunk") {
          callbacks.onChunk(data.content);
        } else if (data.type === "done") {
          callbacks.onDone(data.scriptId, data.content);
        } else if (data.type === "error") {
          callbacks.onError(data.message);
        }
      });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message || "生成失败");
      }
    }
  })();

  return () => controller.abort();
}
