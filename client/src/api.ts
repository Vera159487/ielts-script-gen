import type { Style, Script, Session, SessionDetail, ViralPost, ProgressEvent, RewriteStreamCallbacks } from "./types";

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

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "pipeline_complete") {
                callbacks.onComplete(data.data);
              } else {
                callbacks.onEvent(data as ProgressEvent);
              }
            } catch {
              // 不完整的 JSON，放回 buffer
              buffer += line + "\n";
            }
          }
        }
      }
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

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "pipeline_complete") {
                callbacks.onComplete(data.data);
              } else {
                callbacks.onEvent(data as ProgressEvent);
              }
            } catch {
              buffer += line + "\n";
            }
          }
        }
      }
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
  strength: string | undefined,
  rewriteSuggestion: string | undefined,
  callbacks: RewriteStreamCallbacks
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/pipeline/stream-rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, styleId, originalScript, sourceUrl, strength, rewriteSuggestion }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("改写请求失败");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
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
            } catch {
              buffer += line + "\n";
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message || "改写失败");
      }
    }
  })();

  return () => controller.abort();
}

/**
 * 添加小红书链接到会话
 */
export async function addViralUrls(
  sessionId: string,
  urls: string[]
): Promise<{ posts: ViralPost[]; count: number }> {
  const res = await fetch(`${BASE}/pipeline/add-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, urls }),
  });
  if (!res.ok) throw new Error("添加链接失败");
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

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "chunk") {
                callbacks.onChunk(data.content);
              } else if (data.type === "done") {
                callbacks.onDone(data.scriptId, data.content);
              } else if (data.type === "error") {
                callbacks.onError(data.message);
              }
            } catch {
              buffer += line + "\n";
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message || "生成失败");
      }
    }
  })();

  return () => controller.abort();
}
