import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Script, ViralPost } from "../types";

interface Props {
  verifiedPost: ViralPost | null;
  rewrittenScript: Script | null;
  isRewriting: boolean;
  streamContent: string;
  stepStatus: "pending" | "running" | "completed" | "failed";
  stepMessage: string;
  onRewrite: (post: ViralPost) => void;
}

export default function Step4Rewrite({
  verifiedPost,
  rewrittenScript,
  isRewriting,
  streamContent,
  stepStatus,
  stepMessage,
  onRewrite,
}: Props) {
  const [copied, setCopied] = useState(false);

  const displayContent = isRewriting
    ? streamContent
    : rewrittenScript?.content || "";

  const canRewrite =
    verifiedPost && stepStatus !== "running" && !isRewriting;

  const handleCopy = async () => {
    if (!displayContent) return;
    // 构建三件套内容
    const fullText = [
      `原链接：${rewrittenScript?.source_url || verifiedPost?.xhsUrl || ""}`,
      "",
      "--- 原脚本 ---",
      rewrittenScript?.original_script || verifiedPost?.scriptContent || "",
      "",
      "--- 二创终稿 ---",
      displayContent,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = fullText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!displayContent) return;
    const fullText = [
      `原链接：${rewrittenScript?.source_url || verifiedPost?.xhsUrl || ""}`,
      "",
      "--- 原脚本 ---",
      rewrittenScript?.original_script || verifiedPost?.scriptContent || "",
      "",
      "--- 二创终稿 ---",
      displayContent,
    ].join("\n");

    const blob = new Blob([fullText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rewrittenScript?.topic || "脚本"}_三件套.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (stepStatus === "pending" && !verifiedPost) {
    return (
      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <span>✏️</span> Step 4: 二创改写
        </h3>
        <p className="text-sm text-gray-400">
          请先完成 Step 3 验证爆款，确认后进入改写
        </p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        <span>✏️</span> Step 4: 二创改写
        {stepStatus === "completed" && (
          <span className="text-xs text-green-600 font-normal">✓ 完成</span>
        )}
        {stepStatus === "failed" && (
          <span className="text-xs text-red-500 font-normal">⚠ 失败</span>
        )}
      </h3>

      {stepStatus === "running" && (
        <div className="flex items-center gap-2 text-brand-600 text-sm">
          <span className="animate-spin">⏳</span>
          <span>{stepMessage}</span>
        </div>
      )}

      {stepStatus === "failed" && (
        <p className="text-sm text-red-500">{stepMessage}</p>
      )}

      {/* 改写按钮 */}
      {canRewrite && !rewrittenScript && !isRewriting && (
        <button
          onClick={() => onRewrite(verifiedPost!)}
          className="btn-primary flex items-center gap-2"
        >
          ✨ 开始二创改写
        </button>
      )}

      {/* 改写内容 */}
      {(isRewriting || rewrittenScript) && (
        <>
          {/* 工具栏 */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!displayContent}
              className="btn-secondary text-sm"
            >
              {copied ? "✅ 已复制" : "📋 复制三件套"}
            </button>
            <button
              onClick={handleDownload}
              disabled={!displayContent}
              className="btn-secondary text-sm"
            >
              📥 下载 Markdown
            </button>
          </div>

          {/* 原脚本对照 */}
          {rewrittenScript?.original_script && (
            <details className="bg-gray-50 rounded-lg p-3">
              <summary className="text-sm text-gray-500 cursor-pointer">
                📄 查看原爆款脚本（对照）
              </summary>
              <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap max-h-60 overflow-y-auto">
                {rewrittenScript.original_script}
              </pre>
            </details>
          )}

          {/* Markdown 预览 */}
          <div
            className={`markdown-preview prose max-w-none ${
              isRewriting ? "streaming-cursor" : ""
            }`}
          >
            <ReactMarkdown>{displayContent}</ReactMarkdown>
          </div>
        </>
      )}
    </div>
  );
}
