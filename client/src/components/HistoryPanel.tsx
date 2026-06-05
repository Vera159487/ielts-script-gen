import type { Script } from "../types";

interface Props {
  scripts: Script[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function HistoryPanel({
  scripts,
  selectedId,
  onSelect,
  onDelete,
}: Props) {
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return d.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (scripts.length === 0) {
    return (
      <div className="card">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <span>📂</span> 历史记录
        </h3>
        <p className="text-sm text-gray-400 text-center py-8">
          还没有生成过脚本
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
        <span>📂</span> 历史记录
        <span className="text-xs text-gray-400 font-normal ml-auto">
          {scripts.length} 条
        </span>
      </h3>

      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {scripts.map((script) => {
          const isActive = selectedId === script.id;
          return (
            <div
              key={script.id}
              className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-150 ${
                isActive
                  ? "bg-brand-50 border border-brand-200"
                  : "hover:bg-gray-50 border border-transparent"
              }`}
              onClick={() => onSelect(script.id)}
            >
              {/* 内容预览 */}
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm font-medium truncate ${
                    isActive ? "text-brand-700" : "text-gray-700"
                  }`}
                >
                  {script.topic}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                  <span>{script.style_name}</span>
                  <span>·</span>
                  <span>{formatTime(script.created_at)}</span>
                </div>
              </div>

              {/* 删除按钮 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("确定删除这条脚本吗？")) {
                    onDelete(script.id);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1"
                title="删除"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
