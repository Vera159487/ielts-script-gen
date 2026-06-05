import type { ViralPost, VerifyResult } from "../types";

interface Props {
  viralPosts: ViralPost[];
  verifiedPost: ViralPost | null;
  verifyResult: VerifyResult | null;
  stepStatus: "pending" | "running" | "completed" | "failed";
  stepMessage: string;
  onSelectPost: (post: ViralPost) => void;
}

export default function Step3Verify({
  viralPosts,
  verifiedPost,
  verifyResult,
  stepStatus,
  stepMessage,
  onSelectPost: _onSelectPost,
}: Props) {
  const isRunning = stepStatus === "running";

  if (stepStatus === "pending" && !verifiedPost) {
    return (
      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <span>✅</span> Step 3: 爆款验证
        </h3>
        <p className="text-sm text-gray-400">请先在 Step 2 添加小红书链接，然后继续执行</p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        <span>✅</span> Step 3: 爆款验证
        {stepStatus === "completed" && verifyResult?.isGenericViral && (
          <span className="text-xs text-green-600 font-normal">✓ 通过验证</span>
        )}
        {stepStatus === "completed" && !verifyResult?.isGenericViral && (
          <span className="text-xs text-yellow-600 font-normal">
            ⚠ 非通用爆款，但仍可用于二创
          </span>
        )}
        {stepStatus === "failed" && (
          <span className="text-xs text-red-500 font-normal">⚠ 失败</span>
        )}
      </h3>

      {isRunning && (
        <div className="flex items-center gap-2 text-brand-600 text-sm">
          <span className="animate-spin">⏳</span>
          <span>{stepMessage}</span>
        </div>
      )}

      {stepStatus === "failed" && (
        <p className="text-sm text-red-500">{stepMessage}</p>
      )}

      {/* 验证结果 */}
      {verifyResult && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`text-2xl ${
                verifyResult.isGenericViral ? "" : "opacity-50"
              }`}
            >
              {verifyResult.isGenericViral ? "🌟" : "📝"}
            </span>
            <div>
              <p className="font-medium text-gray-800">
                {verifyResult.isGenericViral ? "通用爆款" : "非通用爆款"}
              </p>
              <p className="text-sm text-gray-500">
                通用性评分：{verifyResult.genericScore}/10
              </p>
            </div>
          </div>

          {verifyResult.strength && (
            <div>
              <p className="text-xs font-medium text-gray-500">💪 亮点</p>
              <p className="text-sm text-gray-700">{verifyResult.strength}</p>
            </div>
          )}
          {verifyResult.weakness && (
            <div>
              <p className="text-xs font-medium text-gray-500">⚠️ 风险</p>
              <p className="text-sm text-gray-700">{verifyResult.weakness}</p>
            </div>
          )}
          {verifyResult.rewriteSuggestion && (
            <div>
              <p className="text-xs font-medium text-gray-500">💡 二创建议</p>
              <p className="text-sm text-gray-700">
                {verifyResult.rewriteSuggestion}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 选中的爆款帖子 */}
      {verifiedPost && (
        <div>
          <p className="text-sm font-medium text-gray-600 mb-2">
            选中用于二创的帖子：
          </p>
          <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
            <p className="text-sm font-medium text-gray-700">
              {verifiedPost.title || "无标题"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              点赞 {formatNum(verifiedPost.likes)} · 收藏{" "}
              {formatNum(verifiedPost.collects)} · 评论{" "}
              {formatNum(verifiedPost.comments)}
            </p>
            {verifiedPost.scriptContent && (
              <details className="mt-2">
                <summary className="text-xs text-brand-600 cursor-pointer">
                  查看原脚本
                </summary>
                <pre className="text-xs text-gray-600 mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {verifiedPost.scriptContent}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      {/* 候选列表 */}
      {viralPosts.length > 0 && !verifiedPost && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">已解析的帖子（共 {viralPosts.length} 条）</p>
        </div>
      )}
    </div>
  );
}

function formatNum(n?: number): string {
  if (n == null) return "?";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}
