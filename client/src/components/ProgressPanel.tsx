interface Props {
  logs: string[];
}

export default function ProgressPanel({ logs }: Props) {
  if (logs.length === 0) return null;

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
        <span>📋</span> 执行日志
      </h3>
      <div className="bg-gray-900 text-green-400 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-0.5">
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  );
}
