import { useState, useCallback, useRef } from "react";
import type { Style, Script } from "../types";
import {
  fetchStyles,
  fetchScripts,
  updateScript,
  deleteScriptApi,
  generateScriptStream,
} from "../api";

export function useScripts() {
  // 风格列表
  const [styles, setStyles] = useState<Style[]>([]);

  // 脚本列表
  const [scripts, setScripts] = useState<Script[]>([]);
  const [total, setTotal] = useState(0);

  // 当前选中的脚本（预览/编辑）
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const cancelRef = useRef<(() => void) | null>(null);

  // ========== 加载 ==========

  const loadStyles = useCallback(async () => {
    try {
      const list = await fetchStyles();
      setStyles(list);
    } catch (err) {
      console.error("加载风格失败:", err);
    }
  }, []);

  const loadScripts = useCallback(async () => {
    try {
      const data = await fetchScripts();
      setScripts(data.scripts);
      setTotal(data.total);
    } catch (err) {
      console.error("加载脚本列表失败:", err);
    }
  }, []);

  // ========== 生成 ==========

  const generate = useCallback(
    (topic: string, styleId: string, referenceScript?: string) => {
      // 取消之前可能还在跑的生成
      if (cancelRef.current) {
        cancelRef.current();
      }

      setIsGenerating(true);
      setStreamContent("");
      setSelectedScript(null);

      const cancel = generateScriptStream(
        topic,
        styleId,
        referenceScript,
        {
          onChunk(text) {
            setStreamContent((prev) => prev + text);
          },
          onDone(scriptId, fullContent) {
            setIsGenerating(false);
            setStreamContent("");
            setSelectedScript({
              id: scriptId,
              topic,
              style_id: styleId,
              style_name: "",
              content: fullContent,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            loadScripts(); // 刷新历史列表
          },
          onError(message) {
            setIsGenerating(false);
            alert("生成失败: " + message);
          },
        }
      );

      cancelRef.current = cancel;
    },
    [loadScripts]
  );

  const cancelGeneration = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsGenerating(false);
  }, []);

  // ========== 编辑 ==========

  const saveScript = useCallback(
    async (id: string, content: string) => {
      await updateScript(id, content);
      // 更新本地状态
      if (selectedScript?.id === id) {
        setSelectedScript((prev) => (prev ? { ...prev, content } : null));
      }
      loadScripts();
    },
    [selectedScript, loadScripts]
  );

  const deleteScript = useCallback(
    async (id: string) => {
      await deleteScriptApi(id);
      if (selectedScript?.id === id) {
        setSelectedScript(null);
      }
      loadScripts();
    },
    [selectedScript, loadScripts]
  );

  const selectScript = useCallback(async (id: string) => {
    // 从已加载列表中找到
    setScripts((prev) => {
      const found = prev.find((s) => s.id === id);
      if (found) {
        setSelectedScript(found);
      }
      return prev;
    });
  }, []);

  return {
    styles,
    scripts,
    total,
    selectedScript,
    setSelectedScript,
    isGenerating,
    streamContent,
    loadStyles,
    loadScripts,
    generate,
    cancelGeneration,
    saveScript,
    deleteScript,
    selectScript,
  };
}
