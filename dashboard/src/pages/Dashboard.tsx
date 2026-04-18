// dashboard/src/pages/Dashboard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAppSelector } from "@/store";
import { callStarted } from "@/store/callSlice";
import ActiveCallCard from "@/components/ActiveCallCard";
import TranscriptPanel from "@/components/TranscriptPanel";
import Icon from "@/components/primitives/Icon";
import AgentPill, { AGENTS } from "@/components/primitives/AgentPill";
import { useCountUp } from "@/components/primitives/hooks";
import type {
  ActiveCall,
  Appointment,
  Call,
  PaginatedResponse,
  Patient,
} from "@/types";
import {
  formatDatePretty,
  formatDuration,
  formatTimePretty,
} from "@/lib/format";
import { dashboardSocket } from "@/lib/socket";

interface Stats {
  total_calls: number;
  active_calls: number;
  completed_calls: number;
  average_duration_seconds: number;
}

function KpiCard({
  label,
  value,
  trend,
  accent,
  icon,
}: {
  label: string;
  value: string | number;
  trend?: number;
  accent?: "active";
  icon?: string;
}) {
  const displayVal = useCountUp(typeof value === "number" ? value : 0);
  return (
    <div className={`kpi ${accent === "active" ? "active" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="label">{label}</div>
        {icon && <Icon name={icon} size={14} style={{ color: "var(--text-tertiary)" }} />}
      </div>
      <div className="value">
        {typeof value === "number"
          ? typeof displayVal === "number"
            ? displayVal.toLocaleString()
            : value
          : value}
      </div>
      {typeof trend === "number" && (
        <div className={`trend ${trend < 0 ? "down" : ""}`}>
          <Icon name={trend < 0 ? "trending-down" : "trending-up"} size={12} strokeWidth={2.4} />
          {Math.abs(trend)}%<span className="sep">vs last week</span>
        </div>
      )}
      <svg className="spark" viewBox="0 0 80 32" preserveAspectRatio="none">
        <path
          d="M0,24 L10,18 L20,22 L30,14 L40,16 L50,10 L60,12 L70,6 L80,8"
          fill="none"
          stroke={accent === "active" ? "var(--success)" : "var(--brand-400)"}
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

function AgentLoad({ active }: { active: ActiveCall[] }) {
  const counts = useMemo(() => {
    const map: Record<string, number> = { triage: 0, scheduling: 0, medication: 0, emergency: 0 };
    for (const c of active) {
      const key = (c.agent || "triage").toLowerCase();
      if (map[key] != null) map[key]++;
    }
    return map;
  }, [active]);
  return (
    <div className="agents-row">
      {Object.entries(AGENTS).map(([k, a]) => (
        <div key={k} className="agent-card" style={{ padding: 10 }}>
          <div className="ag-icon-bg" style={{ color: a.color }}>
            <Icon name={a.icon} size={32} />
          </div>
          <div className="ag-name" style={{ color: a.color, fontSize: 10 }}>
            {a.short}
          </div>
          <div className="ag-count" style={{ fontSize: 18 }}>
            {counts[k] ?? 0}
          </div>
          <div className="ag-stat" style={{ fontSize: 10 }}>
            active
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentLoadPanel({ active }: { active: ActiveCall[] }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="overline" style={{ marginBottom: 10 }}>
        Agent load
      </div>
      <AgentLoad active={active} />
    </div>
  );
}

function RecentCallsPanel({ calls }: { calls: Call[] }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div className="overline">Recent calls</div>
        <Link
          to="/calls"
          style={{ fontSize: 11, color: "var(--brand-400)" }}
          title="See all"
        >
          See all →
        </Link>
      </div>
      {calls.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
          No calls yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {calls.slice(0, 6).map((c, i) => (
            <Link
              key={c.id}
              to={`/calls/${c.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 4px",
                borderBottom:
                  i < Math.min(calls.length, 6) - 1
                    ? "1px solid var(--border-subtle)"
                    : "none",
                transition: "background var(--duration-fast)",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "transparent")
              }
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    c.status === "completed"
                      ? "var(--success)"
                      : c.status === "failed"
                        ? "var(--danger)"
                        : c.status === "active"
                          ? "var(--info)"
                          : "var(--text-tertiary)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "var(--text-primary)",
                  }}
                >
                  {c.patient_name ?? "Unknown"}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-tertiary)" }}
                >
                  {formatDatePretty(c.started_at)} · {formatTimePretty(c.started_at)}
                </div>
              </div>
              <AgentPill agent={c.current_agent} size="sm" showIcon={false} />
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--text-secondary)", width: 42, textAlign: "right" }}
              >
                {formatDuration(c.duration_seconds)}
              </span>
              <Icon name="chevron-right" size={12} style={{ color: "var(--text-tertiary)" }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UpcomingAppointmentsPanel({
  appointments,
  patientsById,
}: {
  appointments: Appointment[];
  patientsById: Record<string, Patient>;
}) {
  const navigate = useNavigate();
  const upcoming = useMemo(() => {
    const now = Date.now();
    return appointments
      .filter(
        (a) => a.status !== "cancelled" && new Date(a.scheduled_at).getTime() >= now - 3600_000,
      )
      .sort(
        (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
      )
      .slice(0, 6);
  }, [appointments]);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div className="overline">Upcoming appointments</div>
        <Link
          to="/appointments"
          style={{ fontSize: 11, color: "var(--brand-400)" }}
        >
          See all →
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
          Nothing scheduled.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {upcoming.map((a, i) => {
            const p = patientsById[a.patient_id];
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate(p ? `/patients/${p.id}` : "/appointments")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 4px",
                  borderBottom:
                    i < upcoming.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  textAlign: "left",
                  transition: "background var(--duration-fast)",
                  width: "100%",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "transparent")
                }
              >
                <Icon name="calendar-check" size={14} style={{ color: "var(--agent-scheduling)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p?.name ?? "Unknown"} · {a.doctor_name}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: "var(--text-tertiary)" }}
                  >
                    {formatDatePretty(a.scheduled_at)} · {formatTimePretty(a.scheduled_at)}
                  </div>
                </div>
                <Icon name="chevron-right" size={12} style={{ color: "var(--text-tertiary)" }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const dispatch = useDispatch();
  const activeCalls = useAppSelector((s) => Object.values(s.calls.activeCalls));
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentCalls, setRecentCalls] = useState<Call[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, Patient>>({});
  // We store callSid (not the call object) so the panel can read the
  // *live* call from Redux — otherwise new transcripts update the store but
  // not the stale snapshot captured at click time.
  const [openCallSid, setOpenCallSid] = useState<string | null>(null);
  const openCall = useAppSelector((s) =>
    openCallSid ? s.calls.activeCalls[openCallSid] ?? null : null,
  );

  // Make call form
  const [showCallForm, setShowCallForm] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "success" | "error">("idle");
  const [callError, setCallError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Pull stats, recent calls, and upcoming appointments. Appointments also
  // re-fetch on the appointment:created socket event so bookings made during
  // an in-flight call land in the sidebar without a manual refresh.
  const loadAppointments = async () => {
    try {
      const r = await api.get<PaginatedResponse<Appointment>>("/api/appointments", {
        params: { page_size: 30 },
      });
      setAppointments(r.data.items);
      const missing = Array.from(new Set(r.data.items.map((a) => a.patient_id))).filter(
        (pid) => !patientsById[pid],
      );
      if (missing.length > 0) {
        const results = await Promise.all(
          missing.map((pid) =>
            api
              .get<Patient>(`/api/patients/${pid}`)
              .then((res) => [pid, res.data] as const)
              .catch(() => [pid, null] as const),
          ),
        );
        setPatientsById((prev) => {
          const next = { ...prev };
          for (const [pid, p] of results) if (p) next[pid] = p;
          return next;
        });
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const load = () => {
      api
        .get<Stats>("/api/analytics/summary")
        .then((r) => setStats(r.data))
        .catch(() => {});
      api
        .get<PaginatedResponse<Call>>("/api/calls", { params: { page_size: 10 } })
        .then((r) => setRecentCalls(r.data.items))
        .catch(() => {});
      void loadAppointments();
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live rehydrate when an agent books during a call.
  const loadApptsRef = useRef(loadAppointments);
  loadApptsRef.current = loadAppointments;
  useEffect(() => {
    const handler = () => void loadApptsRef.current();
    dashboardSocket.on("appointment:created", handler);
    return () => {
      dashboardSocket.off("appointment:created", handler);
    };
  }, []);

  // Restore active calls on mount
  useEffect(() => {
    api
      .get<Call[]>("/api/calls/active")
      .then((r) => {
        for (const call of r.data) {
          dispatch(
            callStarted({
              callSid: call.call_sid,
              patientPhone: "",
              patientName: call.patient_name,
              agent: call.current_agent,
              startedAt: call.started_at,
            }),
          );
        }
      })
      .catch(() => {});
  }, [dispatch]);

  useEffect(() => {
    if (showCallForm) searchRef.current?.focus();
  }, [showCallForm]);

  useEffect(() => {
    if (!showCallForm) return;
    const timer = setTimeout(() => {
      api
        .get<PaginatedResponse<Patient>>("/api/patients", {
          params: { search: patientSearch, page_size: 10 },
        })
        .then((r) => setPatients(r.data.items))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [patientSearch, showCallForm]);

  function openCallForm() {
    setShowCallForm(true);
    setSelectedPatient(null);
    setPatientSearch("");
    setCallStatus("idle");
    setCallError("");
    setShowDropdown(false);
  }

  function selectPatient(p: Patient) {
    setSelectedPatient(p);
    setPatientSearch(p.name ?? p.phone);
    setShowDropdown(false);
  }

  async function handleInitiateCall() {
    const phone = selectedPatient?.phone;
    if (!phone) return;
    setCallStatus("calling");
    setCallError("");
    try {
      await api.post("/api/calls/initiate", { to_phone: phone });
      setCallStatus("success");
      setTimeout(() => {
        setShowCallForm(false);
        setCallStatus("idle");
      }, 2000);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to initiate call";
      setCallError(msg);
      setCallStatus("error");
    }
  }

  const avgDurationLabel = stats ? formatDuration(Math.floor(stats.average_duration_seconds)) : "—";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Dashboard</h1>
          <div className="page-sub">
            Real-time monitoring · {activeCalls.length} active · {stats?.total_calls ?? 0} total
          </div>
        </div>
        <div className="page-actions">
          <div className="seg">
            <button className="active">Live</button>
            <button>24h</button>
            <button>7d</button>
          </div>
          <button className="btn btn-secondary" title="Export coming soon">
            <Icon name="download" size={14} />
            Export
          </button>
          <button
            className="btn btn-primary"
            onClick={showCallForm ? () => setShowCallForm(false) : openCallForm}
          >
            <Icon name={showCallForm ? "x" : "phone-outgoing"} size={14} />
            {showCallForm ? "Cancel" : "New Call"}
          </button>
        </div>
      </div>

      {showCallForm && (
        <div
          className="card"
          style={{ padding: 16, marginBottom: 16 }}
        >
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 10 }}>
            Select a patient to call
          </div>
          <div style={{ position: "relative" }}>
            <input
              ref={searchRef}
              type="text"
              className="input"
              placeholder="Search by name or phone..."
              value={patientSearch}
              onChange={(e) => {
                setPatientSearch(e.target.value);
                setSelectedPatient(null);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              disabled={callStatus === "calling"}
            />
            {showDropdown && patients.length > 0 && (
              <ul
                style={{
                  position: "absolute",
                  zIndex: 10,
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-md)",
                  maxHeight: 240,
                  overflow: "auto",
                  padding: 4,
                  listStyle: "none",
                }}
              >
                {patients.map((p) => (
                  <li
                    key={p.id}
                    onMouseDown={() => selectPatient(p)}
                    style={{
                      padding: "8px 10px",
                      display: "flex",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "var(--text-sm)",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "transparent")
                    }
                  >
                    <span style={{ fontWeight: 500 }}>{p.name ?? "—"}</span>
                    <span className="mono" style={{ color: "var(--text-tertiary)" }}>
                      {p.phone}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selectedPatient && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 10,
                padding: "10px 12px",
                background: "var(--brand-subtle)",
                border: "1px solid rgba(0, 229, 208, 0.25)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>{selectedPatient.name ?? "Unknown"}</span>
                <span
                  className="mono"
                  style={{ marginLeft: 10, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}
                >
                  {selectedPatient.phone}
                </span>
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleInitiateCall}
                disabled={callStatus === "calling"}
              >
                {callStatus === "calling" ? "Calling..." : "Call now"}
              </button>
            </div>
          )}
          {callStatus === "success" && (
            <div style={{ marginTop: 10, color: "var(--success)", fontSize: "var(--text-sm)" }}>
              Call initiated successfully.
            </div>
          )}
          {callStatus === "error" && (
            <div style={{ marginTop: 10, color: "var(--danger)", fontSize: "var(--text-sm)" }}>
              {callError}
            </div>
          )}
        </div>
      )}

      <div className="kpi-row">
        <KpiCard label="Active Calls" value={activeCalls.length} accent="active" icon="activity" />
        <KpiCard label="Total Calls" value={stats?.total_calls ?? 0} icon="phone" />
        <KpiCard label="Completed" value={stats?.completed_calls ?? 0} icon="check-circle-2" />
        <KpiCard label="Avg Handle Time" value={avgDurationLabel} icon="clock" />
      </div>

      {/* Active Calls — stacked on top, full width. Cards flow side-by-side
          when multiple; when there's only one, we keep it at half-width so
          the section doesn't balloon a single card across the whole row. */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div className="overline">Active calls · {activeCalls.length}</div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                background: "var(--success)",
                borderRadius: "50%",
                boxShadow: "0 0 6px var(--success)",
              }}
            />
            Real-time
          </span>
        </div>

        {activeCalls.length === 0 ? (
          <div
            className="empty"
            style={{ padding: "28px 16px", minHeight: 0 }}
          >
            <Icon name="phone-off" size={24} style={{ color: "var(--text-tertiary)" }} />
            <div
              style={{
                fontSize: "var(--text-md)",
                color: "var(--text-primary)",
                fontWeight: 600,
              }}
            >
              No active calls
            </div>
            <div style={{ fontSize: "var(--text-sm)" }}>
              Calls will appear here as they connect.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
              gap: "var(--space-4)",
            }}
          >
            {activeCalls.map((call) => (
              <ActiveCallCard
                key={call.callSid}
                call={call}
                onOpen={(c) => setOpenCallSid(c.callSid)}
                agentPath={[call.agent]}
                action={`${AGENTS[call.agent]?.name ?? "Agent"} active`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Secondary panels — 3 equal columns. Grows horizontally, not
          vertically, so no single column towers over the others. */}
      <div className="dash-secondary">
        <AgentLoadPanel active={activeCalls} />
        <UpcomingAppointmentsPanel
          appointments={appointments}
          patientsById={patientsById}
        />
        <RecentCallsPanel calls={recentCalls} />
      </div>

      {openCall && (
        <TranscriptPanel call={openCall} onClose={() => setOpenCallSid(null)} />
      )}
    </div>
  );
}
