import { useState, useMemo } from "react";
import type { ViralPost, XHSSearchResult } from "../types";
import { formatNumber, stripQs, getMatchColor, getMatchBgColor } from "../utils";

interface Props {
  keywords: string[];
  viralPosts: ViralPost[];
  stepStatus: "pending" | "running" | "completed" | "failed";
  stepMessage: string;
  onAddUrls: (urls: string[], results?: XHSSearchResult[]) => void;
  onContinue: () => void;
  onAutoSearch: (keywords: string[]) => void;
  autoSearchResults: XHSSearchResult[];
  isSearching: boolean;
  isLoading: boolean;
}

export default function Step2Search({
  keywords,
  viralPosts,
  stepStatus,
  stepMessage,
  onAddUrls,
  onContinue,
  onAutoSearch,
  autoSearchResults,
  isSearching,
  isLoading,
}: Props) {
  const [urlInput, setUrlInput] = useState("");
  // 单选模式：仅记录一个选中的 URL
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  // 按匹配度排序（从高到低），未评分的排最后
  const sortedResults = useMemo(() => {
    return [...autoSearchResults].sort((a, b) => {
      const pa = a.matchPercent ?? -1;
      const pb = b.matchPercent ?? -1;
      return pb - pa;
    });
  }, [autoSearchResults]);

  // 按视频/图文分组
  const { videoResults, noteResults } = useMemo(() => {
    const videos = sortedResults.filter((r) => r.postType === "video");
    const notes = sortedResults.filter((r) => r.postType !== "video");
    return { videoResults: videos, noteResults: notes };
  }, [sortedResults]);

  // 区分高于阈值和低于阈值的结果
  const threshold = 25;
  // 各组中高于阈值的结果（各自按匹配度从高到低排序）
  const videoAbove = useMemo(
    () => videoResults.filter((r) => (r.matchPercent ?? 0) >= threshold),
    [videoResults]
  );
  const noteAbove = useMemo(
    () => noteResults.filter((r) => (r.matchPercent ?? 0) >= threshold),
    [noteResults]
  );
  const belowAll = useMemo(
    () => sortedResults.filter((r) => (r.matchPercent ?? 0) < threshold),
    [sortedResults]
  );

  // 是否同时有图文和视频高于阈值
  const hasBothAbove = noteAbove.length > 0 && videoAbove.length > 0;

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

  const handleAutoSearch = () => {
    if (keywords.length > 0) {
      setSelectedUrl(null);
      onAutoSearch(keywords);
    }
  };

  // 单选：点击选中一个，自动取消其他
  const selectOne = (url: string) => {
    setSelectedUrl((prev) => (prev === url ? null : url));
  };

  const handleParseSelected = () => {
    if (selectedUrl) {
      const selectedResult = autoSearchResults.find((r) => r.url === selectedUrl);
      if (selectedResult) {
        onAddUrls([selectedUrl], [selectedResult]);
        setSelectedUrl(null);
      } else {
        console.warn(`选中的 URL 已不在当前搜索结果中: ${selectedUrl}`);
      }
    }
  };

  // 已导入的 URL 集合（用于在搜索结果中标记）
  // 去参数比较，与后端 addViralPostsFromSearchResults 去重逻辑保持一致
  const importedUrls = useMemo(
    () => new Set(viralPosts.map((p) => p.xhsUrl).map(stripQs)),
    [viralPosts]
  );

  const isRunning = stepStatus === "running";
  const shownKeywords = useMemo(() => keywords.slice(0, 8), [keywords]);

  // 渲染搜索结果卡片（单选 radio 模式）
  const renderResultCard = (r: XHSSearchResult) => {
    const pct = r.matchPercent;
    const isImported = importedUrls.has(stripQs(r.url));
    const isSelected = selectedUrl === r.url;
    return (
      <label
        key={r.url}
        className={`flex items-start gap-1.5 p-1 rounded hover:bg-gray-50 ${isImported ? "cursor-default opacity-50" : "cursor-pointer"}`}
      >
        {isImported ? (
          <span className="mt-1 text-xs text-green-600 font-medium whitespace-nowrap">已导入</span>
        ) : (
          <input
            type="radio"
            name="xhs-result-radio"
            checked={isSelected}
            onChange={() => selectOne(r.url)}
            className="mt-1"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-700 truncate flex-1">
              {r.postType === "video" ? "🎬 " : "📄 "}
              {r.title || r.url}
            </p>
            {pct != null && (
              <span
                className={`text-xs font-bold px-1.5 py-0.5 rounded ${getMatchBgColor(pct)} ${getMatchColor(pct)}`}
              >
                {Math.round(pct)}%
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">{r.snippet}</p>
        </div>
      </label>
    );
  };

  return (
    <div className="card space-y-2">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        Step 2: 筛选爆款
        {stepStatus === "completed" && (
          <span className="text-xs text-green-600 font-normal">
            已有 {viralPosts.length} 条
          </span>
        )}
        {stepStatus === "failed" && (
          <span className="text-xs text-red-500 font-normal">失败</span>
        )}
      </h3>

      {stepStatus === "failed" && (
        <p className="text-sm text-red-500">{stepMessage}</p>
      )}

      {/* 关键词展示 + 自动搜索 */}
      {keywords.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-2 flex items-center gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {shownKeywords.map((kw, i) => (
              <span
                key={i}
                className="text-xs bg-white px-2 py-0.5 rounded text-gray-600"
              >
                {kw}
              </span>
            ))}
          </div>

          <button
            onClick={handleAutoSearch}
            disabled={isSearching || isLoading}
            className="btn-secondary text-sm flex-shrink-0"
          >
            {isSearching ? "搜索中..." : "自动搜索"}
          </button>
        </div>
      )}

      {/* 自动搜索结果 — 按匹配度从高到低排序 */}
      {autoSearchResults.length > 0 && (
        <div className="border border-gray-100 rounded-lg p-2 space-y-2">
          <p className="text-sm font-medium text-gray-700">
            搜索到 {autoSearchResults.length} 条结果（按匹配度排序，单选一条导入）
          </p>

          {/* 高于阈值：左右两列网格（有内容的列才渲染） */}
          {(noteAbove.length > 0 || videoAbove.length > 0) && (
            <div className={`grid gap-2 ${hasBothAbove ? "grid-cols-2" : "grid-cols-1"}`}>
              {/* 左侧：图文 */}
              {noteAbove.length > 0 && (
                <div className="space-y-1 min-w-0">
                  <p className="text-xs text-blue-600 font-medium sticky top-0 bg-white py-0.5">
                    📄 图文 ({noteAbove.length}条)
                  </p>
                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {noteAbove.map(renderResultCard)}
                  </div>
                </div>
              )}

              {/* 右侧：视频 */}
              {videoAbove.length > 0 && (
                <div className="space-y-1 min-w-0">
                  <p className="text-xs text-purple-600 font-medium sticky top-0 bg-white py-0.5">
                    🎬 视频 ({videoAbove.length}条)
                  </p>
                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {videoAbove.map(renderResultCard)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 低于阈值组（跨视频/图文，占满宽） */}
          {belowAll.length > 0 && (
            <div className={`border-t border-gray-200 pt-2 ${(noteAbove.length > 0 || videoAbove.length > 0) ? "mt-1" : ""}`}>
              <p className="text-xs text-red-400 font-medium mb-1 flex items-center gap-1">
                ⚠️ 低于筛选阈值（&lt;{threshold}%）— {belowAll.length} 条
              </p>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {belowAll.map(renderResultCard)}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleParseSelected}
              disabled={!selectedUrl}
              className="btn-primary text-sm"
            >
              解析选中 {selectedUrl ? `(1)` : ""}
            </button>
          </div>
        </div>
      )}

      {/* 手动粘贴 */}
      <details className="group">
        <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-600">
          或手动粘贴链接
        </summary>
        <div className="mt-2 space-y-2">
          <textarea
            className="input-field min-h-[60px] resize-y text-sm"
            placeholder="https://xhslink.com/xxxxx"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            onClick={handleAddUrl}
            disabled={!urlInput.trim() || isLoading}
            className="btn-secondary text-sm"
          >
            解析链接
          </button>
        </div>
      </details>

      {/* 已解析的帖子列表 */}
      {viralPosts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-600">
            已解析 {viralPosts.length} 条帖子
          </p>
          {viralPosts.map((post, i) => (
            <div
              key={i}
              className="bg-gray-50 rounded p-2 flex items-start gap-2"
            >
              <span className="text-xs text-gray-400 mt-0.5 w-5">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">
                  {post.title || "无标题"}
                  {post.postType && (
                    <span className="ml-2 text-xs text-gray-400">
                      {post.postType === "video" ? "🎬" : "📄"}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">
                  {post.authorName && `@${post.authorName} · `}
                  {post.likes != null && `👍 ${formatNumber(post.likes)} · `}
                  {post.collects != null && `⭐ ${formatNumber(post.collects)} · `}
                  {post.authorFollowers != null && `粉丝 ${formatNumber(post.authorFollowers)}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 继续按钮 */}
      {viralPosts.length > 0 && (
        <button
          onClick={onContinue}
          disabled={isLoading}
          className="btn-primary"
        >
          继续
        </button>
      )}

      {isRunning && (
        <div className="flex items-center gap-2 text-brand-600 text-sm">
          <span className="animate-spin">&#8987;</span>
          <span>{stepMessage}</span>
        </div>
      )}
    </div>
  );
}
