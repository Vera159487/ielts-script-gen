/**
 * 匹配度百分比 → 文字颜色 class（统一阈值）
 * >=90 绿色, >=70 黄色/amber, >=50 橙色, <50 红色
 */
export function getMatchColor(pct: number): string {
  if (pct >= 90) return "text-green-600";
  if (pct >= 70) return "text-amber-500";
  if (pct >= 50) return "text-orange-500";
  return "text-red-500";
}

/**
 * 匹配度百分比 → 浅色背景 class（用于标签/徽章）
 * 阈值同上
 */
export function getMatchBgColor(pct: number): string {
  if (pct >= 90) return "bg-green-50";
  if (pct >= 70) return "bg-amber-50";
  if (pct >= 50) return "bg-orange-50";
  return "bg-red-50";
}

/**
 * 去除 URL 查询参数，用于 URL 去重比较
 * 客户端和搜索端各有一份，统一至此
 */
export function stripQs(url: string): string {
  const noQs = url.split("?")[0];
  return noQs.split("#")[0];
}

/**
 * 数字格式化工具
 * 用于统一显示点赞、收藏、粉丝等数据
 */
export function formatNumber(n?: number | null): string {
  if (n == null) return "?";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * 复制文本到剪贴板（含降级方案）
 * @returns 是否成功
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 降级方案：textarea + execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

/**
 * 构建三件套文本：原链接 + 原脚本 + 终稿
 */
export function buildFullText(
  displayContent: string,
  sourceUrl?: string | null,
  originalScript?: string | null
): string {
  return [
    `原链接：${sourceUrl || ""}`,
    "",
    "--- 原脚本 ---",
    originalScript || "",
    "",
    "--- 二创终稿 ---",
    displayContent,
  ].join("\n");
}

/**
 * 触发文件下载
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
