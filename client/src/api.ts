import type { Style, Script } from "./types";

const BASE = "/api";

/** 获取所有风格 */
export async function fetchStyles(): Promise<Style[]> {
  const res = await fetch(`${BASE}/styles`);
  if (!res.ok) throw new Error("获取风格失败");
  const data = await res.json();
  return data.styles;
}

/** 获取脚本列表 */
export async function fetchScripts(
  limit = 50,
  offset = 0
): Promise<{ scripts: Script[]; total: number }> {
  const res = await fetch(`${BASE}/scripts?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("获取脚本列表失败");
  return res.json();
}

/** 获取单个脚本 */
export async function fetchScript(id: string): Promise<Script> {
  const res = await fetch(`${BASE}/scripts/${id}`);
  if (!res.ok) throw new Error("获取脚本失败");
  const data = await res.json();
  return data.script;
}

/** 更新脚本内容 */
export async function updateScript(
  id: string,
  content: string
): Promise<void> {
  const res = await fetch(`${BASE}/scripts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("保存失败");
}

/** 删除脚本 */
export async function deleteScriptApi(id: string): Promise<void> {
  const res = await fetch(`${BASE}/scripts/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("删除失败");
}

/**
 * 流式生成脚本
 * 返回一个 abort 函数用于取消请求
 */
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

      if (!res.ok) {
        throw new Error("生成请求失败");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("无法读取响应流");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件
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
              // 不完整的 JSON，放回 buffer
              buffer = line + "\n";
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
