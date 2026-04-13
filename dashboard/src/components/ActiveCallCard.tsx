// dashboard/src/components/ActiveCallCard.tsx
import { useEffect, useState } from "react";
import type { ActiveCall } from "@/types";
import AgentStatusBadge from "./AgentStatusBadge";
import { formatDuration } from "@/lib/format";

export default function ActiveCallCard({ call }: { call: ActiveCall }) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(call.startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [call.startedAt]);

  return (
    <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <div className="text-left">
            <div className="font-mono text-sm">{call.patientPhone}</div>
            <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
              <AgentStatusBadge agent={call.agent} />
              <span>{formatDuration(elapsed)}</span>
            </div>
          </div>
        </div>
        <span className="text-slate-400">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 p-4 max-h-80 overflow-y-auto bg-slate-50">
          {call.transcript.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-4">
              Waiting for conversation...
            </div>
          ) : (
            <div className="space-y-2">
              {call.transcript.map((entry) => (
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
                    className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                      entry.role === "patient"
                        ? "bg-slate-200 text-slate-900"
                        : entry.role === "agent"
                        ? "bg-blue-500 text-white"
                        : "bg-transparent text-slate-500 italic text-xs"
                    }`}
                  >
                    {entry.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
