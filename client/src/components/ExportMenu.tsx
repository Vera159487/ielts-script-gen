import { useState } from "react";
import type { Script } from "../types";

interface Props {
  script: Script | null;
  disabled: boolean;
}

export default function ExportMenu({ script, disabled }: Props) {
  const [copied, setCopied] = useState(false);

  const content = script?.content || "";

  // 提取纯文本（去掉 Markdown 标记）
  const getPlainText = () => {
    return content
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/^>\s?/gm, "")
      .replace(/^- /gm, "• ")
      .replace(/\n{3,}/g, "\n\n");
  };

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 降级方案
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = (format: "md" | "txt") => {
    if (!content) return;
    const text = format === "md" ? content : getPlainText();
    const ext = format === "md" ? ".md" : ".txt";
    const mime = format === "md" ? "text/markdown" : "text/plain";
    const filename = `${script?.topic || "脚本"}_${Date.now()}${ext}`;

    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!content && !disabled) return null;

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
        <span>📤</span> 导出脚本
      </h3>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleCopy}
          disabled={disabled || !content}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          {copied ? "✅ 已复制" : "📋 复制到剪贴板"}
        </button>
        <button
          onClick={() => handleDownload("md")}
          disabled={disabled || !content}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          📥 下载 Markdown
        </button>
        <button
          onClick={() => handleDownload("txt")}
          disabled={disabled || !content}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          📄 下载 TXT
        </button>
      </div>
    </div>
  );
}
