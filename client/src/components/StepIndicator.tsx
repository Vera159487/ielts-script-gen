import type { StepState } from "../hooks/usePipeline";

interface Props {
  steps: Record<string, StepState>;
}

const STEP_LABELS: Record<string, { num: string; label: string }> = {
  keywords: { num: "❶", label: "关键词" },
  search: { num: "❷", label: "筛爆款" },
  verify: { num: "❸", label: "验证" },
  rewrite: { num: "❹", label: "二创" },
};

export default function StepIndicator({ steps }: Props) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Object.entries(STEP_LABELS).map(([key, { num, label }], i) => {
        const step = steps[key];
        const isActive = step?.status === "running";
        const isDone = step?.status === "completed";
        const isFailed = step?.status === "failed";

        return (
          <div key={key} className="flex items-center gap-2">
            {/* 步骤圆点 */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                isActive
                  ? "bg-brand-100 text-brand-700 shadow-sm"
                  : isDone
                  ? "bg-green-50 text-green-600"
                  : isFailed
                  ? "bg-red-50 text-red-500"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              <span className={isActive ? "animate-pulse" : ""}>{num}</span>
              <span className="hidden sm:inline">{label}</span>
              {isDone && <span>✓</span>}
              {isFailed && <span>⚠</span>}
            </div>
            {/* 连接线 */}
            {i < Object.keys(STEP_LABELS).length - 1 && (
              <span
                className={`hidden sm:block w-6 h-0.5 ${
                  isDone ? "bg-green-300" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
