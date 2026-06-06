import type { Style } from "../types";

interface Props {
  styles: Style[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function StyleSelector({ styles, selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {styles.map((style) => {
        const isSelected = selectedId === style.id;
        return (
          <button
            key={style.id}
            onClick={() => onSelect(style.id)}
            className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
              isSelected
                ? "border-brand-500 bg-brand-50"
                : "border-gray-100 bg-white hover:border-gray-300"
            }`}
          >
            <span className="text-2xl">{style.icon}</span>
            <span
              className={`text-sm font-semibold ${
                isSelected ? "text-brand-700" : "text-gray-700"
              }`}
            >
              {style.name}
            </span>
            <span className="text-xs text-gray-400 text-center leading-tight">
              {style.description}
            </span>
            {isSelected && (
              <span className="absolute top-2 right-2 w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center">
                <svg
                  className="w-3 h-3 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
