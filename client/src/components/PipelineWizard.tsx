import { useEffect, useState } from "react";
import { usePipeline } from "../hooks/usePipeline";
import type { Style } from "../types";
import { fetchStyles } from "../api";
import StyleSelector from "./StyleSelector";
import StepIndicator from "./StepIndicator";
import Step1Keywords from "./Step1Keywords";
import Step2Search from "./Step2Search";
import Step3Verify from "./Step3Verify";
import Step4Rewrite from "./Step4Rewrite";
import ProgressPanel from "./ProgressPanel";
import HistoryPanel from "./HistoryPanel";

export default function PipelineWizard() {
  const pipeline = usePipeline();
  const [styles, setStyles] = useState<Style[]>([]);
  const [topicInput, setTopicInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"new" | "history">("new");

  useEffect(() => {
    fetchStyles()
      .then(setStyles)
      .catch(() => {});
  }, []);

  const handleStart = () => {
    if (!topicInput.trim() || !pipeline.styleId) return;
    pipeline.startPipeline(topicInput.trim(), pipeline.styleId);
  };

  const handleAddUrls = (urls: string[]) => {
    pipeline.addUrls(urls);
  };

  const handleContinue = () => {
    pipeline.continueAfterSearch();
  };

  const handleRewrite = (post: import("../types").ViralPost) => {
    pipeline.startRewrite(post);
  };

  const hasStarted = pipeline.sessionId != null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎬</span>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                破7学院 · 全链路脚本工作台
              </h1>
              <p className="text-xs text-gray-400">
                SOP 四步自动化：关键词 → 筛爆款 → 验证 → 二创
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 视图切换 */}
            <div className="flex rounded-lg bg-gray-100 p-0.5">
              <button
                onClick={() => setView("new")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "new"
                    ? "bg-white shadow-sm text-brand-700"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                ✨ 新建
              </button>
              <button
                onClick={() => setView("history")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "history"
                    ? "bg-white shadow-sm text-brand-700"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                📂 历史
              </button>
            </div>

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden btn-secondary p-2"
              title="历史记录"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* 主体 */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {view === "history" ? (
          <div className="card">
            <h2 className="font-semibold text-gray-800 mb-4">📂 历史会话</h2>
            <p className="text-sm text-gray-400">
              历史记录功能已集成到侧边栏，请点击右上角按钮查看。
            </p>
          </div>
        ) : (
          <div className="flex gap-6">
            {/* 左侧边栏 — 历史记录 */}
            <aside
              className={`${
                sidebarOpen ? "fixed inset-0 z-40 bg-black/50" : ""
              } lg:static lg:block lg:w-80 flex-shrink-0`}
              onClick={(e) => {
                if (e.target === e.currentTarget) setSidebarOpen(false);
              }}
            >
              <div
                className={`${
                  sidebarOpen
                    ? "absolute right-0 top-0 h-full w-80 bg-gray-50 p-4 overflow-y-auto"
                    : "hidden lg:block"
                }`}
              >
                <div className="flex items-center justify-between mb-4 lg:hidden">
                  <span className="font-semibold">历史记录</span>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
                <HistoryPanel
                  scripts={[]}
                  selectedId={null}
                  onSelect={() => {}}
                  onDelete={() => {}}
                />
              </div>
            </aside>

            {/* 右侧主区域 */}
            <div className="flex-1 min-w-0 space-y-6">
              {/* 步骤指示器 */}
              <StepIndicator steps={pipeline.steps} />

              {/* 话题输入 + 风格选择（始终显示） */}
              <div className="card space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    📝 输入雅思话题
                  </label>
                  <textarea
                    className="input-field min-h-[80px] resize-y"
                    placeholder='例如："雅思口语Part 2 描述一个喜欢的地方"、"雅思阅读判断题总是错怎么办"'
                    value={topicInput}
                    onChange={(e) => setTopicInput(e.target.value)}
                    disabled={pipeline.steps.keywords.status === "running"}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    🎨 选择脚本风格（可选）
                  </label>
                  <StyleSelector
                    styles={styles}
                    selectedId={pipeline.styleId}
                    onSelect={pipeline.setStyleId}
                  />
                </div>

                {!hasStarted && (
                  <button
                    onClick={handleStart}
                    disabled={
                      !topicInput.trim() ||
                      !pipeline.styleId ||
                      pipeline.steps.keywords.status === "running"
                    }
                    className="btn-primary flex items-center gap-2"
                  >
                    <span>🚀</span>
                    启动全链路生成
                  </button>
                )}

                {hasStarted && pipeline.steps.keywords.status === "running" && (
                  <button
                    onClick={pipeline.cancelAll}
                    className="btn-secondary !border-red-200 !text-red-600"
                  >
                    ⏹ 取消
                  </button>
                )}

                {hasStarted && (
                  <button
                    onClick={pipeline.reset}
                    className="btn-secondary text-sm"
                  >
                    🔄 重新开始
                  </button>
                )}
              </div>

              {/* Step 1: 关键词 */}
              <Step1Keywords
                topic={pipeline.topic}
                keywords={pipeline.keywords}
                relatedKeywords={pipeline.relatedKeywords}
                stepStatus={pipeline.steps.keywords.status}
                stepMessage={pipeline.steps.keywords.message}
                onGenerate={pipeline.startPipeline}
                styleId={pipeline.styleId}
                isStarted={hasStarted}
              />

              {/* Step 2: 搜索 */}
              <Step2Search
                keywords={pipeline.keywords}
                viralPosts={pipeline.viralPosts}
                stepStatus={pipeline.steps.search.status}
                stepMessage={pipeline.steps.search.message}
                onAddUrls={handleAddUrls}
                onContinue={handleContinue}
                isLoading={pipeline.steps.search.status === "running"}
              />

              {/* Step 3: 验证 */}
              <Step3Verify
                viralPosts={pipeline.viralPosts}
                verifiedPost={pipeline.verifiedPost}
                verifyResult={pipeline.verifyResult}
                stepStatus={pipeline.steps.verify.status}
                stepMessage={pipeline.steps.verify.message}
                onSelectPost={() => {}}
              />

              {/* Step 4: 改写 */}
              <Step4Rewrite
                verifiedPost={pipeline.verifiedPost}
                rewrittenScript={pipeline.rewrittenScript}
                isRewriting={pipeline.isRewriting}
                streamContent={pipeline.streamContent}
                stepStatus={pipeline.steps.rewrite.status}
                stepMessage={pipeline.steps.rewrite.message}
                onRewrite={handleRewrite}
              />

              {/* 进度日志 */}
              <ProgressPanel logs={pipeline.logs} />
            </div>
          </div>
        )}
      </main>

      {/* 页脚 */}
      <footer className="text-center py-6 text-xs text-gray-400">
        破7学院 © 2026 — SOP 全链路脚本自动化工作台
      </footer>
    </div>
  );
}
