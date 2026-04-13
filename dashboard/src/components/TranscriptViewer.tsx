// dashboard/src/components/TranscriptViewer.tsx
import type { TranscriptEntry } from "@/types";

export default function TranscriptViewer({ entries }: { entries: TranscriptEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-slate-400 text-center py-8">No transcript available</div>;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex ${
            entry.role === "patient"
              ? "justify-start"
              : entry.role === "agent"
              ? "justify-end"
              : "justify-center"
          }`}
        >
          <div
            className={`max-w-[70%] px-4 py-2 rounded-lg ${
              entry.role === "patient"
                ? "bg-slate-200 text-slate-900"
                : entry.role === "agent"
                ? "bg-blue-500 text-white"
                : "bg-transparent text-slate-500 italic text-xs"
            }`}
          >
            {entry.agent_name && entry.role === "agent" && (
              <div className="text-xs opacity-70 mb-0.5">{entry.agent_name}</div>
            )}
            {entry.content}
          </div>
        </div>
      ))}
    </div>
  );
}
