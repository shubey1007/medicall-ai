// dashboard/src/pages/Analytics.tsx
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Icon from "@/components/primitives/Icon";
import AgentPill, { AGENTS } from "@/components/primitives/AgentPill";
import { useCountUp } from "@/components/primitives/hooks";
import { formatDuration } from "@/lib/format";

interface Summary {
  total_calls: number;
  active_calls: number;
  completed_calls: number;
  average_duration_seconds: number;
  urgency_breakdown: { low: number; medium: number; high: number; critical: number };
  calls_per_day: { date: string; count: number }[];
}

interface AgentStats {
  agents: { agent_name: string; message_count: number }[];
}

interface QdrantStats {
  available: boolean;
  reason?: string;
  collections: Record<string, number | null>;
}

const COLLECTION_LABELS: Record<string, { label: string; icon: string; hint: string }> = {
  patient_memory: {
    label: "Patient memory",
    icon: "brain",
    hint: "Facts extracted from past calls",
  },
  medical_knowledge: {
    label: "Medical knowledge",
    icon: "book-open",
    hint: "Pre-seeded RAG corpus",
  },
  doctor_directory: {
    label: "Doctor directory",
    icon: "stethoscope",
    hint: "For semantic doctor search",
  },
};

const URGENCY_COLORS: Record<string, string> = {
  low: "var(--success)",
  medium: "var(--warning)",
  high: "var(--danger)",
  critical: "var(--danger-intense)",
};

function KpiCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: string;
  accent?: "active";
}) {
  const displayVal = useCountUp(typeof value === "number" ? value : 0);
  return (
    <div className={`kpi ${accent === "active" ? "active" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="label">{label}</div>
        <Icon name={icon} size={14} style={{ color: "var(--text-tertiary)" }} />
      </div>
      <div className="value">
        {typeof value === "number"
          ? typeof displayVal === "number"
            ? displayVal.toLocaleString()
            : value
          : value}
      </div>
    </div>
  );
}

function AreaChart({ data, color = "var(--brand-400)", height = 180 }: { data: number[]; color?: string; height?: number }) {
  if (data.length === 0) return <div style={{ height, color: "var(--text-tertiary)" }}>No data</div>;
  const max = Math.max(...data, 1);
  const w = 1000;
  const h = height;
  const pts = data.map((v, i) => [
    (i / Math.max(1, data.length - 1)) * w,
    h - (v / max) * (h - 20) - 10,
  ]);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const fillPath = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1="0" y1={h * g} x2={w} y2={h * g} stroke="var(--border-subtle)" strokeDasharray="3 4" />
      ))}
      <path d={fillPath} fill="url(#areaFill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {pts.length > 0 && (
        <circle
          cx={pts[pts.length - 1][0]}
          cy={pts[pts.length - 1][1]}
          r="4"
          fill={color}
          stroke="var(--bg-surface)"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

function Donut({ data, size = 180 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}>
        No data
      </div>
    );
  }
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;
  const segs = data.map((d, i) => {
    const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    return { d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`, color: d.color, idx: i };
  });
  return (
    <svg width={size} height={size}>
      {segs.map((s) => (
        <path
          key={s.idx}
          d={s.d}
          fill="none"
          stroke={s.color}
          strokeWidth="18"
          strokeLinecap="round"
          style={{ opacity: 0.9 }}
        />
      ))}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 28, fill: "var(--text-primary)" }}
      >
        {total.toLocaleString()}
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        style={{ fontSize: 10, fill: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        Total
      </text>
    </svg>
  );
}

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [qdrant, setQdrant] = useState<QdrantStats | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const loadQdrant = () => {
    api
      .get<QdrantStats>("/api/admin/qdrant/stats")
      .then((r) => setQdrant(r.data))
      .catch(() => setQdrant({ available: false, reason: "stats endpoint unreachable", collections: {} }));
  };

  useEffect(() => {
    api.get<Summary>("/api/analytics/summary").then((r) => setSummary(r.data)).catch(() => {});
    api.get<AgentStats>("/api/analytics/agents").then((r) => setAgentStats(r.data)).catch(() => {});
    loadQdrant();
  }, []);

  async function backfillDoctors() {
    setBackfilling(true);
    setBackfillMsg(null);
    try {
      const r = await api.post<{ status: string; synced: number; total: number }>(
        "/api/admin/qdrant/backfill-doctors",
      );
      setBackfillMsg(
        r.data.status === "skipped"
          ? "Qdrant not available — check Settings → Qdrant."
          : `Synced ${r.data.synced}/${r.data.total} doctors.`,
      );
      loadQdrant();
    } catch {
      setBackfillMsg("Backfill failed.");
    } finally {
      setBackfilling(false);
      setTimeout(() => setBackfillMsg(null), 4000);
    }
  }

  if (!summary || !agentStats) {
    return (
      <div className="page">
        <div className="empty">
          <Icon name="loader" size={24} />
          Loading analytics…
        </div>
      </div>
    );
  }

  const callsSeries = summary.calls_per_day.map((d) => d.count);
  const urgencyData = [
    { label: "Low", value: summary.urgency_breakdown.low, color: URGENCY_COLORS.low },
    { label: "Medium", value: summary.urgency_breakdown.medium, color: URGENCY_COLORS.medium },
    { label: "High", value: summary.urgency_breakdown.high, color: URGENCY_COLORS.high },
    { label: "Critical", value: summary.urgency_breakdown.critical, color: URGENCY_COLORS.critical },
  ];

  const total = summary.total_calls || 1;
  const completionRate = Math.round((summary.completed_calls / total) * 100);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <div className="page-sub">
            Updated{" "}
            {new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
        <div className="page-actions">
          <div className="seg">
            <button>7d</button>
            <button className="active">30d</button>
            <button>90d</button>
          </div>
          <button className="btn btn-secondary">
            <Icon name="download" size={14} /> Export
          </button>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Total Calls" value={summary.total_calls} icon="phone" />
        <KpiCard
          label="Avg Duration"
          value={formatDuration(Math.floor(summary.average_duration_seconds))}
          icon="clock"
        />
        <KpiCard label="Resolution Rate" value={`${completionRate}%`} icon="check-circle-2" />
        <KpiCard label="Active Today" value={summary.active_calls} accent="active" icon="activity" />
      </div>

      <div className="chart-grid" style={{ marginBottom: 16 }}>
        <div className="chart-card">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <h3>Calls per day</h3>
              <div className="sub">
                {summary.calls_per_day.length} days · total {callsSeries.reduce((a, b) => a + b, 0)} calls
              </div>
            </div>
            <span className="badge badge-success">Live</span>
          </div>
          <AreaChart data={callsSeries} />
          {summary.calls_per_day.length >= 2 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
                marginTop: 6,
              }}
            >
              <span>{summary.calls_per_day[0].date.slice(5)}</span>
              <span>{summary.calls_per_day[summary.calls_per_day.length - 1].date.slice(5)}</span>
            </div>
          )}
        </div>
        <div className="chart-card">
          <h3>Urgency breakdown</h3>
          <div className="sub">Across all completed calls</div>
          <div className="donut-wrap">
            <Donut data={urgencyData} />
            <div className="donut-legend">
              {urgencyData.map((u, i) => (
                <div key={i} className="lg-row">
                  <span className="sw" style={{ background: u.color }} />
                  <span style={{ color: "var(--text-secondary)", width: 60 }}>{u.label}</span>
                  <span className="mono" style={{ color: "var(--text-primary)" }}>
                    {u.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h3>Memory health</h3>
            <div className="sub">
              Qdrant vector store — where patient memory and medical knowledge live
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {backfillMsg && (
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                {backfillMsg}
              </span>
            )}
            <button
              className="btn btn-sm btn-secondary"
              onClick={backfillDoctors}
              disabled={backfilling || !qdrant?.available}
            >
              <Icon name="refresh-cw" size={12} />
              {backfilling ? "Syncing…" : "Backfill doctors"}
            </button>
          </div>
        </div>

        {qdrant?.available === false && (
          <div
            style={{
              padding: 12,
              marginTop: 12,
              background: "var(--warning-subtle)",
              border: "1px solid rgba(251,191,36,0.25)",
              color: "var(--warning)",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-sm)",
            }}
          >
            Qdrant is not available — {qdrant.reason ?? "reason unknown"}. Patient memory and
            semantic doctor search will silently degrade until this is fixed in Settings.
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
            marginTop: 14,
          }}
        >
          {Object.entries(COLLECTION_LABELS).map(([key, meta]) => {
            const count = qdrant?.collections[key];
            const isEmpty = count === 0;
            return (
              <div
                key={key}
                style={{
                  padding: 14,
                  background: "var(--bg-elevated)",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${isEmpty ? "rgba(251,191,36,0.25)" : "var(--border-subtle)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Icon
                    name={meta.icon}
                    size={14}
                    style={{ color: isEmpty ? "var(--warning)" : "var(--brand-400)" }}
                  />
                  <span className="overline">{meta.label}</span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 24,
                    fontWeight: 900,
                    color: count == null ? "var(--text-tertiary)" : "var(--text-primary)",
                  }}
                >
                  {count == null ? "—" : count.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-tertiary)",
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}
                >
                  {meta.hint}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="chart-card">
        <h3>Agent activity</h3>
        <div className="sub">Transcript message counts per agent</div>
        {agentStats.agents.length === 0 ? (
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)", padding: 20 }}>
            No data yet.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
              marginTop: 14,
            }}
          >
            {agentStats.agents.map((a) => {
              const info = AGENTS[a.agent_name.toLowerCase()];
              return (
                <div
                  key={a.agent_name}
                  style={{
                    padding: 16,
                    background: "var(--bg-elevated)",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${info?.subtle ?? "var(--border-subtle)"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    {info && <Icon name={info.icon} size={14} style={{ color: info.color }} />}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "var(--tracking-wide)",
                        color: info?.color ?? "var(--text-secondary)",
                      }}
                    >
                      {info?.name ?? a.agent_name}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 900,
                      fontSize: 28,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {a.message_count.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                    messages
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="chart-card" style={{ marginTop: 16 }}>
        <h3>Summary stats</h3>
        <div className="sub">Overall activity since inception</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
            marginTop: 14,
          }}
        >
          {[
            { label: "Total", value: summary.total_calls },
            { label: "Active", value: summary.active_calls },
            { label: "Completed", value: summary.completed_calls },
            {
              label: "Avg duration",
              value: formatDuration(Math.floor(summary.average_duration_seconds)),
            },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                padding: 14,
                background: "var(--bg-elevated)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div className="overline" style={{ marginBottom: 6 }}>
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 24,
                  fontWeight: 900,
                  color: "var(--text-primary)",
                }}
              >
                {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {agentStats.agents.slice(0, 4).map((a) => (
            <AgentPill key={a.agent_name} agent={a.agent_name.toLowerCase()} size="sm" />
          ))}
        </div>
      </div>
    </div>
  );
}
