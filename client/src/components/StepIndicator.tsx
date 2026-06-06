import type { StepState } from "../hooks/usePipeline";

interface Props {
  steps: Record<string, StepState>;
}

const STEP_ORDER = ["keywords", "search", "verify", "rewrite"];
const STEP_LABELS: Record<string, string> = {
  keywords: "关键词",
  search: "筛选",
  verify: "验证",
  rewrite: "改写",
};

function dotStyle(status: string | undefined): string {
  switch (status) {
    case "running":   return "bg-brand-500 border-brand-500 animate-pulse";
    case "completed": return "bg-green-500 border-green-500";
    case "failed":    return "bg-red-500 border-red-500";
    default:          return "bg-white border-gray-300";
  }
}

export default function StepIndicator({ steps }: Props) {
  const entries = STEP_ORDER.map((key) => [key, steps[key]] as const);

  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {entries.map(([key, step], i) => {
        const status = step?.status;
        const isDone = status === "completed";
        const isActive = status === "running";

        return (
          <div key={key} className="flex items-center">
            {/* 圆点 + 标签 */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-3.5 h-3.5 rounded-full border-2 ${dotStyle(status)} ${
                  isActive ? "ring-4 ring-brand-100" : ""
                }`}
              />
              <span
                className={`text-xs whitespace-nowrap ${
                  isDone ? "text-green-600 font-medium" :
                  isActive ? "text-brand-600 font-medium" :
                  "text-gray-400"
                }`}
              >
                {STEP_LABELS[key]}
              </span>
            </div>
            {/* 连接线 */}
            {i < entries.length - 1 && (
              <div
                className={`w-8 sm:w-16 h-0.5 mx-1 ${
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
