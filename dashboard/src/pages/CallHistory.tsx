// dashboard/src/pages/CallHistory.tsx
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Call, CallStatus, PaginatedResponse, UrgencyLevel } from "@/types";
import { formatDatePretty, formatDuration, formatTimePretty, maskPhone } from "@/lib/format";
import Icon from "@/components/primitives/Icon";
import UrgencyBar from "@/components/primitives/UrgencyBar";
import { AGENTS } from "@/components/primitives/AgentPill";

type DateRange = "today" | "7d" | "30d" | "all";

function statusIcon(s: string): [string, string] {
  if (s === "completed") return ["check-circle-2", "var(--success)"];
  if (s === "active") return ["activity", "var(--info)"];
  if (s === "failed") return ["x-circle", "var(--danger)"];
  return ["circle", "var(--text-tertiary)"];
}

// ISO string for "N days ago at 00:00 local" — or null for "all time".
// "today" = midnight today local; 7d/30d = 7/30 days back from now.
function rangeStart(r: DateRange): string | null {
  if (r === "all") return null;
  const now = new Date();
  if (r === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }
  const days = r === "7d" ? 7 : 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

export default function CallHistory() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<Call[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [urgencyFilter, setUrgencyFilter] = useState<Set<UrgencyLevel>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<CallStatus>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [search, setSearch] = useState("");
  const pageSize = 25;

  function toggleSet<T>(set: Set<T>, setFn: (next: Set<T>) => void, key: T) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFn(next);
  }

  useEffect(() => {
    const params: Record<string, string | number> = { page, page_size: pageSize };
    if (search) params.search = search;
    // Translate the segmented UI into a start_date window the backend understands.
    // "all" sends nothing; the others send a rolling N-day window anchored to now.
    const startDate = rangeStart(dateRange);
    if (startDate) params.start_date = startDate;
    api
      .get<PaginatedResponse<Call>>("/api/calls", { params })
      .then((r) => {
        setCalls(r.data.items);
        setTotal(r.data.total);
      })
      .catch(() => {});
  }, [page, search, dateRange]);

  const filtered = calls.filter((c) => {
    if (urgencyFilter.size > 0 && (!c.urgency_level || !urgencyFilter.has(c.urgency_level)))
      return false;
    if (statusFilter.size > 0 && !statusFilter.has(c.status)) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Call History</h1>
          <div className="page-sub">
            {filtered.length} calls · filtered from {total}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary">
            <Icon name="download" size={14} /> Export CSV
          </button>
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => setPage((p) => p)}
            title="Refresh"
          >
            <Icon name="refresh-cw" size={14} />
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <Icon
            name="search"
            size={14}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-tertiary)",
            }}
          />
          <input
            className="input"
            placeholder="Search by patient, phone, SID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ paddingLeft: 34 }}
          />
        </div>
        <div className="seg">
          {(["today", "7d", "30d", "all"] as DateRange[]).map((r) => (
            <button
              key={r}
              className={dateRange === r ? "active" : ""}
              onClick={() => {
                setDateRange(r);
                setPage(1);
              }}
            >
              {r === "today" ? "Today" : r === "all" ? "All time" : r}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["low", "medium", "high", "critical"] as UrgencyLevel[]).map((u) => (
            <span
              key={u}
              className={`pill ${urgencyFilter.has(u) ? "active" : ""}`}
              onClick={() => toggleSet(urgencyFilter, setUrgencyFilter, u)}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background:
                    u === "low"
                      ? "var(--success)"
                      : u === "medium"
                        ? "var(--warning)"
                        : u === "high"
                          ? "var(--danger)"
                          : "var(--danger-intense)",
                }}
              />
              {u}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["completed", "failed", "active"] as CallStatus[]).map((s) => (
            <span
              key={s}
              className={`pill ${statusFilter.has(s) ? "active" : ""}`}
              onClick={() => toggleSet(statusFilter, setStatusFilter, s)}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Date &amp; Time</th>
                <th>Patient</th>
                <th>Agent</th>
                <th style={{ width: 90 }}>Duration</th>
                <th style={{ width: 160 }}>Urgency</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const [ico, color] = statusIcon(c.status);
                const agentInfo = AGENTS[(c.current_agent || "").toLowerCase()];
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/calls/${c.id}`)}
                    style={{
                      animation: `stagger-up 0.25s var(--ease-out) both`,
                      animationDelay: `${i * 20}ms`,
                    }}
                  >
                    <td>
                      <Icon name={ico} size={16} style={{ color }} />
                    </td>
                    <td>
                      <div className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                        {formatDatePretty(c.started_at)}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        {formatTimePretty(c.started_at)}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                        {c.patient_name ?? "Unknown"}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        {maskPhone((c as unknown as { phone?: string }).phone ?? "")}
                      </div>
                    </td>
                    <td>
                      {agentInfo ? (
                        <span
                          className="tooltip-wrap mini-chain"
                          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                        >
                          <span
                            className={`mini-agent ${(c.current_agent || "").toLowerCase()}`}
                            style={{ width: 10, height: 10 }}
                          />
                          <span style={{ fontSize: "var(--text-xs)", color: agentInfo.color }}>
                            {agentInfo.name}
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td className="mono" style={{ color: "var(--text-primary)" }}>
                      {formatDuration(c.duration_seconds)}
                    </td>
                    <td>
                      {c.urgency_level ? (
                        <UrgencyBar level={c.urgency_level} />
                      ) : (
                        <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      <Icon
                        name="chevron-right"
                        size={14}
                        style={{ color: "var(--text-tertiary)" }}
                      />
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: 60,
                      textAlign: "center",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    No calls match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
          }}
        >
          <span>
            Showing {filtered.length} of {total}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <Icon name="chevron-left" size={12} /> Prev
            </button>
            <span className="btn btn-sm btn-ghost" style={{ cursor: "default" }}>
              Page {page} / {totalPages}
            </span>
            <button
              className="btn btn-sm btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <Icon name="chevron-right" size={12} />
            </button>
          </div>
        </div>
      </div>
      {/* Suppressing fragment warning for map */}
      <Fragment />
    </div>
  );
}
