import { useEffect, useState } from "react";
import { useScripts } from "./hooks/useScripts";
import ScriptForm from "./components/ScriptForm";
import ScriptPreview from "./components/ScriptPreview";
import HistoryPanel from "./components/HistoryPanel";
import ExportMenu from "./components/ExportMenu";

export default function App() {
  const {
    styles,
    scripts,
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
  } = useScripts();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    loadStyles();
    loadScripts();
  }, [loadStyles, loadScripts]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎬</span>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                破7学院 · 脚本生成器
              </h1>
              <p className="text-xs text-gray-400">
                小红书雅思视频脚本 · AI 一键生成
              </p>
            </div>
          </div>

          {/* 移动端菜单按钮 */}
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
      </header>

      {/* 主体 */}
      <main className="max-w-7xl mx-auto px-4 py-6">
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
                scripts={scripts}
                selectedId={selectedScript?.id || null}
                onSelect={(id) => {
                  selectScript(id);
                  setSidebarOpen(false);
                }}
                onDelete={deleteScript}
              />
            </div>
          </aside>

          {/* 右侧主区域 */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* 输入表单 */}
            <ScriptForm
              styles={styles}
              isGenerating={isGenerating}
              onGenerate={generate}
              onCancel={cancelGeneration}
            />

            {/* 脚本预览 */}
            <ScriptPreview
              script={selectedScript}
              streamContent={streamContent}
              isGenerating={isGenerating}
              onSave={saveScript}
            />

            {/* 导出 */}
            <ExportMenu
              script={selectedScript}
              disabled={isGenerating}
            />
          </div>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="text-center py-6 text-xs text-gray-400">
        破7学院 © 2026 — 小红书视频脚本 AI 生成工具
      </footer>
    </div>
  );
}
