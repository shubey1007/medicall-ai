// dashboard/src/pages/CallHistory.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Call, CallStatus, PaginatedResponse, UrgencyLevel } from "@/types";
import { formatDateTime, formatDuration } from "@/lib/format";

const URGENCY_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-600",
  failed: "bg-red-100 text-red-600",
  ringing: "bg-blue-100 text-blue-600",
};

export default function CallHistory() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<CallStatus | "">("");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyLevel | "">("");
  const pageSize = 25;

  useEffect(() => {
    const params: Record<string, string | number> = { page, page_size: pageSize };
    if (statusFilter) params.status = statusFilter;
    if (urgencyFilter) params.urgency = urgencyFilter;
    api.get<PaginatedResponse<Call>>("/api/calls", { params }).then((r) => {
      setCalls(r.data.items);
      setTotal(r.data.total);
    });
  }, [page, statusFilter, urgencyFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Call History</h1>
        <div className="flex gap-2">
          <select value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as CallStatus | ""); setPage(1); }}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <select value={urgencyFilter}
            onChange={(e) => { setUrgencyFilter(e.target.value as UrgencyLevel | ""); setPage(1); }}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm">
            <option value="">All urgencies</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Patient Name</th>
              <th className="px-4 py-3 text-left">Date &amp; Time</th>
              <th className="px-4 py-3 text-left">Duration</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Urgency</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}
                onClick={() => navigate(`/calls/${c.id}`)}
                className="border-t border-slate-100 hover:bg-blue-50 cursor-pointer">
                <td className="px-4 py-3 font-medium text-sm text-slate-900">
                  {c.patient_name ?? <span className="text-slate-400 font-normal">Unknown</span>}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {formatDateTime(c.started_at)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {formatDuration(c.duration_seconds)}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[c.status] ?? "bg-slate-100 text-slate-500"}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {c.urgency_level ? (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${URGENCY_COLORS[c.urgency_level] ?? "bg-slate-100 text-slate-500"}`}>
                      {c.urgency_level}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
            {calls.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No calls found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Showing {calls.length} of {total}</div>
        <div className="flex gap-2">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}
            className="px-3 py-1 border border-slate-300 rounded disabled:opacity-50 text-sm">
            Prev
          </button>
          <span className="px-3 py-1 text-sm">Page {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="px-3 py-1 border border-slate-300 rounded disabled:opacity-50 text-sm">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
