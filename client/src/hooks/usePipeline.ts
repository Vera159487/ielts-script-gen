import { useState, useCallback, useRef } from "react";
import type { Style, ViralPost, ProgressEvent, VerifyResult, Script } from "../types";
import { executePipeline, continuePipeline, streamRewrite, addViralUrls } from "../api";

export type PipelineStepName = "keywords" | "search" | "verify" | "rewrite";

export interface StepState {
  status: "pending" | "running" | "completed" | "failed";
  message: string;
  data?: any;
}

export function usePipeline() {
  const [styles, setStyles] = useState<Style[]>([]);
  const [topic, setTopic] = useState("");
  const [styleId, setStyleId] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // 每个步骤的状态
  const [steps, setSteps] = useState<Record<string, StepState>>({
    keywords: { status: "pending", message: "" },
    search: { status: "pending", message: "" },
    verify: { status: "pending", message: "" },
    rewrite: { status: "pending", message: "" },
  });

  // 步骤产出
  const [keywords, setKeywords] = useState<string[]>([]);
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [viralPosts, setViralPosts] = useState<ViralPost[]>([]);
  const [verifiedPost, setVerifiedPost] = useState<ViralPost | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  // 改写结果
  const [rewrittenScript, setRewrittenScript] = useState<Script | null>(null);
  const [isRewriting, setIsRewriting] = useState(false);
  const [streamContent, setStreamContent] = useState("");

  // 进度日志
  const [logs, setLogs] = useState<string[]>([]);

  // 取消控制
  const cancelRef = useRef<(() => void) | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ========== Step1: 关键词生成 ==========

  const startPipeline = useCallback(
    (inputTopic: string, inputStyleId: string) => {
      setTopic(inputTopic);
      setStyleId(inputStyleId);
      setSessionId(null);
      setSteps({
        keywords: { status: "running", message: "正在生成关键词..." },
        search: { status: "pending", message: "" },
        verify: { status: "pending", message: "" },
        rewrite: { status: "pending", message: "" },
      });
      setKeywords([]);
      setRelatedKeywords([]);
      setViralPosts([]);
      setVerifiedPost(null);
      setVerifyResult(null);
      setRewrittenScript(null);
      setStreamContent("");
      setLogs([]);

      addLog(`开始 Pipeline: ${inputTopic}`);

      if (cancelRef.current) cancelRef.current();

      const cancel = executePipeline(
        inputTopic,
        inputStyleId || undefined,
        {
          onEvent(event: ProgressEvent) {
            addLog(event.message);

            if (event.type === "step_complete" && event.data) {
              setSteps((prev) => {
                const updated = { ...prev };
                if (event.step) {
                  updated[event.step] = { status: "completed", message: event.message, data: event.data };
                }
                return updated;
              });

              // 缓存各步产出
              if (event.step === "keywords" && event.data) {
                setKeywords(event.data.keywords || []);
                setRelatedKeywords(event.data.relatedKeywords || []);
              }
              if (event.step === "search" && event.data?.viralPosts) {
                setViralPosts(event.data.viralPosts);
              }
              if (event.step === "verify" && event.data) {
                setVerifiedPost(event.data.verifiedPost);
                setVerifyResult(event.data.verifyResult);
              }
            } else if (event.type === "step_error") {
              setSteps((prev) => {
                const updated = { ...prev };
                if (event.step) {
                  updated[event.step] = { status: "failed", message: event.message };
                }
                return updated;
              });
            } else if (event.type === "step_start") {
              setSteps((prev) => {
                const updated = { ...prev };
                if (event.step) {
                  updated[event.step] = { status: "running", message: event.message };
                }
                return updated;
              });
            } else if (event.type === "pipeline_complete") {
              if (event.data?.sessionId) {
                setSessionId(event.data.sessionId);
              }
            }
          },
          onError(message: string) {
            addLog(`❌ ${message}`);
          },
          onComplete(data: any) {
            addLog(`✅ Pipeline 完成`);
            if (data?.sessionId) setSessionId(data.sessionId);
          },
        }
      );

      cancelRef.current = cancel;
      return cancel;
    },
    [addLog]
  );

  // ========== Step2: 添加小红书链接 ==========

  const addUrls = useCallback(
    async (urls: string[]) => {
      if (!sessionId) {
        // 从最近 event 获取，或提示先完成 Step1
        addLog("⚠️ 请等待 Pipeline 初始化完成");
        return;
      }

      addLog(`📎 正在解析 ${urls.length} 条链接...`);
      setSteps((prev) => ({
        ...prev,
        search: { status: "running", message: "正在解析小红书链接..." },
      }));

      try {
        const result = await addViralUrls(sessionId, urls);
        setViralPosts(result.posts);
        addLog(`✅ 成功解析 ${result.count} 条帖子`);
        setSteps((prev) => ({
          ...prev,
          search: { status: "completed", message: `已添加 ${result.count} 条帖子` },
        }));
      } catch (err: any) {
        addLog(`❌ 解析失败: ${err.message}`);
        setSteps((prev) => ({
          ...prev,
          search: { status: "failed", message: err.message },
        }));
      }
    },
    [sessionId, addLog]
  );

  // ========== Step3+4: 继续执行（验证+改写） ==========

  const continueAfterSearch = useCallback(() => {
    if (!topic) return;

    addLog("▶️ 继续执行验证和改写...");
    setSteps((prev) => ({
      ...prev,
      verify: { status: "running", message: "正在验证爆款..." },
    }));

    if (cancelRef.current) cancelRef.current();

    const cancel = continuePipeline(
      sessionId || "",
      topic,
      styleId || undefined,
      {
        onEvent(event: ProgressEvent) {
          addLog(event.message);

          if (event.type === "step_complete" && event.data) {
            setSteps((prev) => {
              const updated = { ...prev };
              if (event.step) {
                updated[event.step] = { status: "completed", message: event.message, data: event.data };
              }
              return updated;
            });
            if (event.step === "verify" && event.data) {
              setVerifiedPost(event.data.verifiedPost);
              setVerifyResult(event.data.verifyResult);
            }
            if (event.step === "rewrite" && event.data) {
              setRewrittenScript({
                id: event.data.scriptId || "",
                topic,
                style_id: styleId || "",
                style_name: "",
                content: event.data.content || "",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                source_url: verifiedPost?.xhsUrl,
                original_script: verifiedPost?.scriptContent,
              });
            }
          } else if (event.type === "step_error") {
            setSteps((prev) => {
              const updated = { ...prev };
              if (event.step) {
                updated[event.step] = { status: "failed", message: event.message };
              }
              return updated;
            });
          } else if (event.type === "step_start") {
            setSteps((prev) => {
              const updated = { ...prev };
              if (event.step) {
                updated[event.step] = { status: "running", message: event.message };
              }
              return updated;
            });
          }
        },
        onError(message: string) {
          addLog(`❌ ${message}`);
        },
        onComplete(data: any) {
          addLog(`✅ 全部步骤完成`);
        },
      }
    );

    cancelRef.current = cancel;
  }, [topic, styleId, sessionId, verifiedPost, addLog]);

  // ========== Step4: 单独流式改写 ==========

  const startRewrite = useCallback(
    (post: ViralPost) => {
      if (!topic || !post.scriptContent) return;

      setIsRewriting(true);
      setStreamContent("");
      setSteps((prev) => ({
        ...prev,
        rewrite: { status: "running", message: "正在二创改写..." },
      }));

      if (cancelRef.current) cancelRef.current();

      const cancel = streamRewrite(
        topic,
        styleId || undefined,
        post.scriptContent,
        post.xhsUrl,
        verifyResult?.strength,
        verifyResult?.rewriteSuggestion,
        {
          onChunk(text) {
            setStreamContent((prev) => prev + text);
          },
          onDone(scriptId, content, sourceUrl, originalScript) {
            setIsRewriting(false);
            setRewrittenScript({
              id: scriptId,
              topic,
              style_id: styleId || "",
              style_name: "",
              content,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              source_url: sourceUrl,
              original_script: originalScript,
            });
            setSteps((prev) => ({
              ...prev,
              rewrite: { status: "completed", message: "二创改写完成" },
            }));
            addLog("✅ 二创改写完成");
          },
          onError(message) {
            setIsRewriting(false);
            setSteps((prev) => ({
              ...prev,
              rewrite: { status: "failed", message },
            }));
            addLog(`❌ 改写失败: ${message}`);
          },
        }
      );

      cancelRef.current = cancel;
    },
    [topic, styleId, verifyResult, addLog]
  );

  // ========== 取消 ==========

  const cancelAll = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsRewriting(false);
    addLog("⏹ 已取消");
  }, [addLog]);

  // ========== 重置 ==========

  const reset = useCallback(() => {
    cancelAll();
    setTopic("");
    setStyleId("");
    setSessionId(null);
    setSteps({
      keywords: { status: "pending", message: "" },
      search: { status: "pending", message: "" },
      verify: { status: "pending", message: "" },
      rewrite: { status: "pending", message: "" },
    });
    setKeywords([]);
    setRelatedKeywords([]);
    setViralPosts([]);
    setVerifiedPost(null);
    setVerifyResult(null);
    setRewrittenScript(null);
    setStreamContent("");
    setLogs([]);
  }, [cancelAll]);

  return {
    // 状态
    topic,
    styleId,
    setStyleId,
    sessionId,
    steps,
    keywords,
    relatedKeywords,
    viralPosts,
    verifiedPost,
    verifyResult,
    rewrittenScript,
    isRewriting,
    streamContent,
    logs,
    styles,
    setStyles,
    // 操作
    startPipeline,
    addUrls,
    continueAfterSearch,
    startRewrite,
    cancelAll,
    reset,
    addLog,
  };
}
