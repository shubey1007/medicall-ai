// dashboard/src/pages/CallDetail.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { CallDetail } from "@/types";
import TranscriptViewer from "@/components/TranscriptViewer";
import UrgencyBadge from "@/components/UrgencyBadge";
import AgentStatusBadge from "@/components/AgentStatusBadge";
import { formatDateTime, formatDuration } from "@/lib/format";

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [call, setCall] = useState<CallDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<CallDetail>(`/api/calls/${id}`).then((r) => setCall(r.data));
  }, [id]);

  if (!call) return <div className="text-slate-500">Loading...</div>;

  return (
    <div className="space-y-4">
      <Link to="/calls" className="text-blue-600 text-sm hover:underline">← Back</Link>
      <h1 className="text-2xl font-bold text-slate-900">Call Detail</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase mb-2">Metadata</div>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">Started</dt>
              <dd>{formatDateTime(call.started_at)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Duration</dt>
              <dd>{formatDuration(call.duration_seconds)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Current Agent</dt>
              <dd><AgentStatusBadge agent={call.current_agent} /></dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd>{call.status}</dd>
            </div>
            {call.summary && (
              <div>
                <dt className="text-slate-500">Urgency</dt>
                <dd><UrgencyBadge level={call.summary.urgency_level} /></dd>
              </div>
            )}
          </dl>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4 lg:col-span-1">
          <div className="text-xs text-slate-500 uppercase mb-2">Transcript</div>
          <div className="max-h-[500px] overflow-y-auto">
            <TranscriptViewer entries={call.transcript_entries} />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase mb-2">AI Summary</div>
          {call.summary ? (
            <div className="space-y-3 text-sm">
              <p className="text-slate-800">{call.summary.summary_text}</p>
              {call.summary.extracted_symptoms.length > 0 && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Symptoms</div>
                  <div className="flex flex-wrap gap-1">
                    {call.summary.extracted_symptoms.map((s) => (
                      <span key={s} className="px-2 py-0.5 bg-slate-100 rounded text-xs">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {call.summary.recommended_actions.length > 0 && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Recommended Actions</div>
                  <ul className="list-disc list-inside text-slate-700 text-sm">
                    {call.summary.recommended_actions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-slate-400 text-sm">No summary available</div>
          )}
        </div>
      </div>
    </div>
  );
}
