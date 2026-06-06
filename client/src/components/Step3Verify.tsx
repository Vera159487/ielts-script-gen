import type { VerifyResult, FilterDetail } from "../types";

interface Props {
  verifyResult: VerifyResult | null;
  stepStatus: "pending" | "running" | "completed" | "failed";
  stepMessage: string;
}

/** 匹配度样式（进度条 + 文字颜色统一阈值） */
function matchPercentStyle(pct: number): { bar: string; text: string } {
  if (pct >= 90) return { bar: "bg-green-500", text: "text-green-600" };
  if (pct >= 70) return { bar: "bg-yellow-500", text: "text-yellow-600" };
  if (pct >= 50) return { bar: "bg-orange-500", text: "text-orange-600" };
  return { bar: "bg-red-500", text: "text-red-600" };
}

/** 单个过滤维度卡片 */
function FilterRow({ label, icon, detail }: { label: string; icon: string; detail: FilterDetail }) {
  return (
    <div className="bg-white rounded-lg p-2 border border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">
          {icon} {label}
        </span>
        <span className={`text-sm font-bold ${matchPercentStyle(detail.matchPercent).text}`}>
          {detail.matchPercent}%
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1 mb-1">
        <div
          className={`h-1 rounded-full transition-all ${matchPercentStyle(detail.matchPercent).bar}`}
          style={{ width: `${detail.matchPercent}%` }}
        />
      </div>
      <div className="text-xs space-y-0.5">
        <p className="text-gray-500">
          <span className="font-medium">要求：</span>
          {detail.requirement}
        </p>
        <p className={detail.passed ? "text-green-600" : "text-red-500"}>
          <span className="font-medium">本视频：</span>
          {detail.actual}
        </p>
      </div>
    </div>
  );
}

export default function Step3Verify({
  verifyResult,
  stepStatus,
  stepMessage,
}: Props) {
  const { filterDetails } = verifyResult || {};

  if (stepStatus === "pending" && !verifyResult) {
    return (
      <div className="card space-y-2">
        <h3 className="font-semibold text-gray-800">Step 3: 数据验证</h3>
        <p className="text-sm text-gray-400">等待执行验证...</p>
      </div>
    );
  }

  return (
    <div className="card space-y-2">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        Step 3: 数据验证
        {stepStatus === "completed" && (
          <span className="text-xs text-green-600 font-normal">完成</span>
        )}
        {stepStatus === "failed" && (
          <span className="text-xs text-red-500 font-normal">失败</span>
        )}
      </h3>

      {stepStatus === "running" && (
        <div className="flex items-center gap-2 text-brand-600 text-sm">
          <span className="animate-spin">&#8987;</span>
          <span>{stepMessage}</span>
        </div>
      )}

      {stepStatus === "failed" && (
        <p className="text-sm text-red-500">{stepMessage}</p>
      )}

      {filterDetails && (
        <div className="grid grid-cols-2 gap-2">
          {filterDetails.timeliness && (
            <FilterRow label="时效性" icon="⏰" detail={filterDetails.timeliness} />
          )}
          {filterDetails.duration && (
            <FilterRow label="时长" icon="⏱" detail={filterDetails.duration} />
          )}
          {filterDetails.dataQuality && (
            <FilterRow label="数据质量" icon="📊" detail={filterDetails.dataQuality} />
          )}
          {filterDetails.authorQuality && (
            <FilterRow label="作者质量" icon="👤" detail={filterDetails.authorQuality} />
          )}
        </div>
      )}

      {!filterDetails && stepStatus === "completed" && (
        <p className="text-sm text-gray-400">暂无验证数据</p>
      )}
    </div>
  );
}
