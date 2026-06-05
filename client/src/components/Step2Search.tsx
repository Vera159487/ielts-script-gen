import { useState } from "react";
import type { ViralPost } from "../types";

interface Props {
  keywords: string[];
  viralPosts: ViralPost[];
  stepStatus: "pending" | "running" | "completed" | "failed";
  stepMessage: string;
  onAddUrls: (urls: string[]) => void;
  onContinue: () => void;
  isLoading: boolean;
}

export default function Step2Search({
  keywords,
  viralPosts,
  stepStatus,
  stepMessage,
  onAddUrls,
  onContinue,
  isLoading,
}: Props) {
  const [urlInput, setUrlInput] = useState("");

  const handleAddUrl = () => {
    const urls = urlInput
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (urls.length > 0) {
      onAddUrls(urls);
      setUrlInput("");
    }
  };

  const isPending = stepStatus === "pending";
  const isRunning = stepStatus === "running";

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        <span>📊</span> Step 2: 筛选爆款
        {stepStatus === "completed" && (
          <span className="text-xs text-green-600 font-normal">✓ 已有 {viralPosts.length} 条</span>
        )}
        {stepStatus === "failed" && (
          <span className="text-xs text-red-500 font-normal">⚠ 失败</span>
        )}
      </h3>

      {stepStatus === "failed" && (
        <p className="text-sm text-red-500">{stepMessage}</p>
      )}

      {/* 关键词展示（给用户参考，去小红书搜索） */}
      {keywords.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-2">
            用以下关键词到小红书搜索，然后粘贴爆款链接：
          </p>
          <div className="flex flex-wrap gap-1">
            {keywords.slice(0, 5).map((kw, i) => (
              <span key={i} className="text-xs bg-white px-2 py-0.5 rounded text-gray-600">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 链接输入 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          🔗 粘贴小红书爆款链接（一行一个）
        </label>
        <textarea
          className="input-field min-h-[80px] resize-y text-sm"
          placeholder={`https://xhslink.com/xxxxx
https://xhslink.com/yyyyy`}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isLoading}
        />
        <button
          onClick={handleAddUrl}
          disabled={!urlInput.trim() || isLoading}
          className="btn-secondary text-sm mt-2"
        >
          📎 解析链接
        </button>
      </div>

      {/* 已解析的帖子列表 */}
      {viralPosts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-600">
            已解析 {viralPosts.length} 条帖子：
          </p>
          {viralPosts.map((post, i) => (
            <div
              key={i}
              className="bg-gray-50 rounded-lg p-3 flex items-start gap-3"
            >
              <span className="text-lg mt-0.5">{i + 1}️⃣</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">
                  {post.title || "无标题"}
                </p>
                <p className="text-xs text-gray-400">
                  {post.authorName && `@${post.authorName} · `}
                  {post.likes != null && `👍 ${formatNumber(post.likes)} · `}
                  {post.collects != null && `⭐ ${formatNumber(post.collects)} · `}
                  {post.authorFollowers != null &&
                    `粉丝 ${formatNumber(post.authorFollowers)}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      {viralPosts.length > 0 && (
        <button
          onClick={onContinue}
          disabled={isLoading}
          className="btn-primary flex items-center gap-2"
        >
          ▶️ 继续验证和改写
        </button>
      )}

      {isPending && !viralPosts.length && keywords.length === 0 && (
        <p className="text-sm text-gray-400">请先完成 Step 1 生成关键词</p>
      )}

      {isRunning && (
        <div className="flex items-center gap-2 text-brand-600 text-sm">
          <span className="animate-spin">⏳</span>
          <span>{stepMessage}</span>
        </div>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
