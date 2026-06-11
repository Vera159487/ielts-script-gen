import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Script, ViralPost } from "../types";
import { copyToClipboard, downloadFile, buildFullText } from "../utils";

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
  const [manualScript, setManualScript] = useState("");

  const displayContent = isRewriting
    ? streamContent
    : rewrittenScript?.content || "";

  const canRewrite =
    verifiedPost && stepStatus !== "running" && !isRewriting;

  const handleCopy = async () => {
    if (!displayContent) return;
    const fullText = buildFullText(
      displayContent,
      rewrittenScript?.source_url || verifiedPost?.xhsUrl,
      rewrittenScript?.original_script || verifiedPost?.scriptContent
    );
    const ok = await copyToClipboard(fullText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!displayContent) return;
    const fullText = buildFullText(
      displayContent,
      rewrittenScript?.source_url || verifiedPost?.xhsUrl,
      rewrittenScript?.original_script || verifiedPost?.scriptContent
    );
    const filename = `${rewrittenScript?.topic || "脚本"}_三件套.md`;
    downloadFile(fullText, filename, "text/markdown");
  };

  if (stepStatus === "pending" && !verifiedPost) {
    return (
      <div className="card space-y-2">
        <h3 className="font-semibold text-gray-800">Step 4: 二创改写</h3>
        <p className="text-sm text-gray-400">
          请先完成 Step 3 验证爆款，确认后进入改写
        </p>
      </div>
    );
  }

  return (
    <div className="card space-y-2">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        Step 4: 二创改写
        {stepStatus === "completed" && (
          <span className="text-xs text-green-600 font-normal">完成</span>
        )}
        {stepStatus === "failed" && (
          <span className="text-xs text-red-500 font-normal">失败</span>
        )}
      </h3>

      {stepStatus === "running" && (
        <div className="flex items-center gap-2 text-brand-600 text-sm">
          <span className="animate-spin">&#8987;</span>
          <span>{stepMessage}</span>
        </div>
      )}

      {stepStatus === "failed" && (
        <p className="text-sm text-red-500">{stepMessage}</p>
      )}

      {/* 手动粘贴原文区域：当帖子没有脚本内容时显示 */}
      {verifiedPost && !verifiedPost.scriptContent && !rewrittenScript && !isRewriting && (
        <details className="group" open>
          <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-600">
            该帖子未提取到脚本内容，请手动粘贴原文
          </summary>
          <div className="mt-2 space-y-2">
            <textarea
              className="input-field min-h-[120px] resize-y text-sm"
              placeholder="请粘贴小红书帖子的原文脚本内容..."
              value={manualScript}
              onChange={(e) => setManualScript(e.target.value)}
            />
            <button
              onClick={() => {
                if (verifiedPost && manualScript.trim()) {
                  onRewrite({ ...verifiedPost, scriptContent: manualScript.trim() });
                }
              }}
              disabled={!manualScript.trim()}
              className="btn-primary text-sm"
            >
              使用粘贴内容开始改写
            </button>
          </div>
        </details>
      )}

      {canRewrite && !rewrittenScript && !isRewriting && verifiedPost?.scriptContent && (
        <button
          onClick={() => onRewrite(verifiedPost!)}
          className="btn-primary"
        >
          开始改写
        </button>
      )}

      {(isRewriting || rewrittenScript) && (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!displayContent}
              className="btn-secondary text-sm"
            >
              {copied ? "已复制" : "复制"}
            </button>
            <button
              onClick={handleDownload}
              disabled={!displayContent}
              className="btn-secondary text-sm"
            >
              下载
            </button>
          </div>

          {rewrittenScript?.original_script && (
            <details className="bg-gray-50 rounded-lg p-3">
              <summary className="text-sm text-gray-500 cursor-pointer">
                查看原脚本
              </summary>
              <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap max-h-60 overflow-y-auto">
                {rewrittenScript.original_script}
              </pre>
            </details>
          )}

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
