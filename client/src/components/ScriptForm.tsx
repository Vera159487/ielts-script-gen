import { useState, useEffect } from "react";
import type { Style } from "../types";
import StyleSelector from "./StyleSelector";

interface Props {
  styles: Style[];
  isGenerating: boolean;
  onGenerate: (topic: string, styleId: string, referenceScript?: string) => void;
  onCancel: () => void;
}

export default function ScriptForm({
  styles,
  isGenerating,
  onGenerate,
  onCancel,
}: Props) {
  const [topic, setTopic] = useState("");
  const [styleId, setStyleId] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [referenceScript, setReferenceScript] = useState("");

  // 默认选中第一个风格
  useEffect(() => {
    if (styles.length > 0 && !styleId) {
      // 默认选"干货教学"
      const defaultStyle = styles.find((s) => s.name === "干货教学") || styles[0];
      setStyleId(defaultStyle.id);
    }
  }, [styles, styleId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !styleId) return;
    onGenerate(topic.trim(), styleId, referenceScript || undefined);
    // 保留话题和风格，方便微调后再生成
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-5">
      {/* 话题输入 */}
      <div>
        <label htmlFor="script-topic" className="block text-sm font-semibold text-gray-700 mb-2">
          📝 输入雅思话题
        </label>
        <textarea
          id="script-topic"
          name="script-topic"
          className="input-field min-h-[80px] resize-y"
          placeholder='例如："雅思口语Part 2 描述一个喜欢的地方"、"雅思阅读判断题总是错怎么办"、"21天雅思7分备考计划"'
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={isGenerating}
        />
      </div>

      {/* 风格选择 */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          🎨 选择脚本风格
        </label>
        <StyleSelector
          styles={styles}
          selectedId={styleId}
          onSelect={setStyleId}
        />
      </div>

      {/* 参考脚本（可折叠） */}
      <div>
        <button
          type="button"
          onClick={() => setShowReference(!showReference)}
          className="text-sm text-gray-500 hover:text-brand-600 transition-colors flex items-center gap-1"
        >
          <span>{showReference ? "🔽" : "🔼"}</span>
          粘贴参考爆款脚本（可选）
        </button>
        {showReference && (
          <textarea
            id="script-reference"
            name="script-reference"
            className="input-field min-h-[100px] resize-y mt-2"
            placeholder="粘贴小红书爆款视频的逐字稿作为参考，AI 会学习其结构和节奏..."
            value={referenceScript}
            onChange={(e) => setReferenceScript(e.target.value)}
            disabled={isGenerating}
          />
        )}
      </div>

      {/* 按钮 */}
      <div className="flex gap-3">
        {isGenerating ? (
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary !border-red-200 !text-red-600 hover:!bg-red-50"
          >
            ⏹ 取消生成
          </button>
        ) : (
          <button
            type="submit"
            disabled={!topic.trim() || !styleId}
            className="btn-primary flex items-center gap-2"
          >
            <span>✨</span>
            一键生成脚本
          </button>
        )}
      </div>
    </form>
  );
}
