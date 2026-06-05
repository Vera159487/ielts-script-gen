import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Script } from "../types";

interface Props {
  script: Script | null;
  streamContent: string;
  isGenerating: boolean;
  onSave: (id: string, content: string) => void;
}

export default function ScriptPreview({
  script,
  streamContent,
  isGenerating,
  onSave,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  // 统一内容：流式生成中显示 streamContent，否则显示 script.content
  const displayContent = isGenerating
    ? streamContent
    : script?.content || "";
  const canEdit = !isGenerating && script;

  const handleStartEdit = () => {
    if (!script) return;
    setEditContent(script.content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent("");
  };

  const handleSave = () => {
    if (!script) return;
    onSave(script.id, editContent);
    setIsEditing(false);
  };

  // 空状态
  if (!displayContent && !isGenerating) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-gray-400">
        <span className="text-6xl mb-4">🎬</span>
        <p className="text-lg font-medium">等待生成脚本</p>
        <p className="text-sm mt-1">输入话题并选择风格，点击"一键生成脚本"</p>
      </div>
    );
  }

  return (
    <div className="card">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <span>📄</span>
          {isGenerating ? (
            <span className="streaming-cursor text-brand-600">正在生成脚本...</span>
          ) : (
            <>脚本预览 — {script?.topic}</>
          )}
        </h3>

        {canEdit && !isEditing && (
          <div className="flex gap-2">
            <button onClick={handleStartEdit} className="btn-secondary text-sm">
              ✏️ 编辑
            </button>
          </div>
        )}

        {isEditing && (
          <div className="flex gap-2">
            <button onClick={handleCancelEdit} className="btn-secondary text-sm">
              取消
            </button>
            <button onClick={handleSave} className="btn-primary text-sm">
              💾 保存
            </button>
          </div>
        )}
      </div>

      {/* 内容区 */}
      {isEditing ? (
        <textarea
          className="input-field min-h-[500px] font-mono text-sm resize-y"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
        />
      ) : (
        <div
          className={`markdown-preview prose max-w-none ${
            isGenerating ? "streaming-cursor" : ""
          }`}
        >
          <ReactMarkdown>{displayContent}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
