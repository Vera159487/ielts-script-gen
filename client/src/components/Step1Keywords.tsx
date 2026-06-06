interface Props {
  keywords: string[];
  relatedKeywords: string[];
  stepStatus: "pending" | "running" | "completed" | "failed";
  stepMessage: string;
}

export default function Step1Keywords({
  keywords,
  relatedKeywords,
  stepStatus,
  stepMessage,
}: Props) {
  const isEmpty = keywords.length === 0 && relatedKeywords.length === 0;
  const isLoading = stepStatus === "running";

  return (
    <div className="card space-y-2">
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        Step 1: 关键词生成
        {stepStatus === "completed" && (
          <span className="text-xs text-green-600 font-normal">完成</span>
        )}
        {stepStatus === "failed" && (
          <span className="text-xs text-red-500 font-normal">失败</span>
        )}
      </h3>

      {isLoading && (
        <div className="flex items-center gap-2 text-brand-600 text-sm">
          <span className="animate-spin">&#8987;</span>
          <span>{stepMessage}</span>
        </div>
      )}

      {stepStatus === "failed" && (
        <p className="text-sm text-red-500">{stepMessage}</p>
      )}

      {isEmpty && !isLoading && stepStatus !== "failed" && (
        <p className="text-sm text-gray-400">
          输入话题后点击生成，AI 将自动生成小红书搜索关键词
        </p>
      )}

      {keywords.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-600 mb-1">核心搜索词</p>
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-sm"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {relatedKeywords.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-600 mb-1">联想词 / 长尾词</p>
          <div className="flex flex-wrap gap-2">
            {relatedKeywords.map((kw, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-sm"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
