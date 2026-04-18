// dashboard/src/pages/CallDetail.tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { CallDetail, Patient } from "@/types";
import Icon from "@/components/primitives/Icon";
import UrgencyBar from "@/components/primitives/UrgencyBar";
import { AGENTS } from "@/components/primitives/AgentPill";
import { formatDatePretty, formatDuration, formatTimePretty, maskPhone } from "@/lib/format";

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<CallDetail>(`/api/calls/${id}`)
      .then((r) => {
        setCall(r.data);
        if (r.data.patient_id) {
          api
            .get<Patient>(`/api/patients/${r.data.patient_id}`)
            .then((res) => setPatient(res.data))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [id]);

  if (!call) {
    return (
      <div className="page">
        <div className="empty">
          <Icon name="loader" size={24} />
          Loading call…
        </div>
      </div>
    );
  }

  const summary = call.summary;
  const agentPath = Array.from(
    new Set([
      call.current_agent,
      ...call.transcript_entries
        .filter((t) => t.role === "agent" && t.agent_name)
        .map((t) => t.agent_name as string),
    ]),
  );
  const ctx = (patient?.medical_context ?? {}) as {
    allergies?: string[];
    conditions?: string[];
    medications?: string[];
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => navigate("/calls")}
            style={{ marginBottom: 8 }}
          >
            <Icon name="chevron-left" size={14} /> Back to history
          </button>
          <h1 className="page-title">Call {call.call_sid}</h1>
          <div className="page-sub">
            {formatDatePretty(call.started_at)} · {formatTimePretty(call.started_at)} ·{" "}
            {formatDuration(call.duration_seconds)}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary">
            <Icon name="download" size={14} /> Audio
          </button>
          <button className="btn btn-secondary">
            <Icon name="share-2" size={14} /> Share
          </button>
          <button className="btn btn-primary">
            <Icon name="flag" size={14} /> Flag for review
          </button>
        </div>
      </div>

      <div className="detail-grid">
        {/* Left: metadata + agent timeline */}
        <div className="panel-card">
          <div>
            <div className="overline" style={{ marginBottom: 10 }}>
              Status
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon
                name={
                  call.status === "completed"
                    ? "check-circle-2"
                    : call.status === "failed"
                      ? "x-circle"
                      : "activity"
                }
                size={16}
                style={{
                  color:
                    call.status === "completed"
                      ? "var(--success)"
                      : call.status === "failed"
                        ? "var(--danger)"
                        : "var(--info)",
                }}
              />
              <span
                style={{
                  fontSize: "var(--text-md)",
                  fontWeight: 600,
                  textTransform: "capitalize",
                }}
              >
                {call.status}
              </span>
            </div>
          </div>
          <div className="divider" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="meta-row">
              <span className="k">Duration</span>
              <span className="v">{formatDuration(call.duration_seconds)}</span>
            </div>
            <div className="meta-row">
              <span className="k">Started</span>
              <span className="v">{formatTimePretty(call.started_at)}</span>
            </div>
            {call.ended_at && (
              <div className="meta-row">
                <span className="k">Ended</span>
                <span className="v">{formatTimePretty(call.ended_at)}</span>
              </div>
            )}
            <div className="meta-row">
              <span className="k">Patient</span>
              <span className="v">{patient?.name ?? call.patient_name ?? "—"}</span>
            </div>
            {patient && (
              <div className="meta-row">
                <span className="k">Phone</span>
                <span className="v">{maskPhone(patient.phone)}</span>
              </div>
            )}
            <div className="meta-row">
              <span className="k">Call SID</span>
              <span className="v" style={{ fontSize: 11 }}>
                {call.call_sid}
              </span>
            </div>
          </div>

          {agentPath.length > 0 && (
            <>
              <div className="divider" />
              <div>
                <div className="overline" style={{ marginBottom: 14 }}>
                  Agent timeline
                </div>
                <div className="agent-timeline">
                  {agentPath.map((a, i) => {
                    const info = AGENTS[a?.toLowerCase() ?? ""];
                    return (
                      <div
                        key={`${a}-${i}`}
                        className="atl-step"
                        style={{ color: info?.color ?? "var(--text-secondary)" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {info && <Icon name={info.icon} size={14} />}
                          <span className="lbl">{info?.name ?? a}</span>
                        </div>
                        <div className="dur">
                          {i === 0
                            ? "greeting + intake"
                            : i === agentPath.length - 1
                              ? "resolution"
                              : "handoff"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {(ctx.allergies?.length ||
            ctx.conditions?.length ||
            ctx.medications?.length) && (
            <>
              <div className="divider" />
              <div>
                <div className="overline" style={{ marginBottom: 10 }}>
                  Medical context
                </div>
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {ctx.allergies && ctx.allergies.length > 0 && (
                    <div>
                      <span style={{ color: "var(--warning)" }}>Allergies:</span>{" "}
                      {ctx.allergies.join(", ")}
                    </div>
                  )}
                  {ctx.conditions && ctx.conditions.length > 0 && (
                    <div>
                      <span style={{ color: "var(--text-primary)" }}>Conditions:</span>{" "}
                      {ctx.conditions.join(", ")}
                    </div>
                  )}
                  {ctx.medications && ctx.medications.length > 0 && (
                    <div>
                      <span style={{ color: "var(--text-primary)" }}>Medications:</span>{" "}
                      {ctx.medications.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Center: transcript */}
        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Icon name="message-square" size={15} style={{ color: "var(--text-secondary)" }} />
            <span style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Transcript</span>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
                marginLeft: "auto",
              }}
            >
              {call.transcript_entries.length} messages
            </span>
            <button className="icon-btn" title="Copy">
              <Icon name="copy" size={14} />
            </button>
          </div>
          <div className="transcript-body" style={{ maxHeight: 620 }}>
            {call.transcript_entries.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-tertiary)",
                  fontSize: "var(--text-sm)",
                }}
              >
                No transcript recorded.
              </div>
            ) : (
              call.transcript_entries.map((m, i) => {
                if (m.role === "system") {
                  return (
                    <div key={m.id || i} className="switch-divider" style={{ margin: "14px 0" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Icon name="shuffle" size={11} /> {m.content}
                      </span>
                    </div>
                  );
                }
                const isAgent = m.role === "agent";
                const agent = AGENTS[(m.agent_name || "").toLowerCase()];
                return (
                  <div
                    key={m.id || i}
                    className={`bubble-col ${isAgent ? "agent" : "patient"}`}
                    style={{
                      alignSelf: isAgent ? "flex-start" : "flex-end",
                      marginBottom: 12,
                    }}
                  >
                    {isAgent && agent && (
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "var(--tracking-wide)",
                          textTransform: "uppercase",
                          color: agent.color,
                          marginBottom: 4,
                          paddingLeft: 4,
                        }}
                      >
                        {agent.name}
                      </div>
                    )}
                    <div className={`bubble ${isAgent ? "bubble-agent" : "bubble-patient"}`}>
                      {m.content}
                    </div>
                    <div className="bubble-stamp">
                      {new Date(m.timestamp).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: AI Summary */}
        <div className="panel-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "var(--brand-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="sparkles" size={13} style={{ color: "var(--brand-400)" }} />
            </div>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>AI Summary</div>
            <span className="badge badge-neutral" style={{ marginLeft: "auto", fontSize: 9 }}>
              GPT-4o-mini
            </span>
          </div>

          {summary ? (
            <>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-primary)",
                  lineHeight: 1.6,
                }}
              >
                {summary.summary_text}
              </div>

              <div className="divider" />

              <div>
                <div className="overline" style={{ marginBottom: 10 }}>
                  Extracted symptoms
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {summary.extracted_symptoms.length === 0 ? (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                      None detected
                    </span>
                  ) : (
                    summary.extracted_symptoms.map((s, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 11,
                          background: "var(--danger-subtle)",
                          color: "var(--danger)",
                          padding: "3px 10px",
                          borderRadius: "var(--radius-full)",
                          border: "1px solid rgba(248,113,113,0.2)",
                          fontWeight: 500,
                        }}
                      >
                        {s}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="overline" style={{ marginBottom: 10 }}>
                  Urgency assessment
                </div>
                <UrgencyBar level={summary.urgency_level} />
              </div>

              <div className="divider" />

              <div>
                <div className="overline" style={{ marginBottom: 10 }}>
                  Recommended actions
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {summary.recommended_actions.length === 0 ? (
                    <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
                      No actions.
                    </div>
                  ) : (
                    summary.recommended_actions.map((a, i) => (
                      <label
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          fontSize: "var(--text-sm)",
                          cursor: "pointer",
                          padding: "6px 8px",
                          margin: "-6px -8px",
                          borderRadius: 6,
                        }}
                      >
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 4,
                            border: "1.5px solid var(--border-strong)",
                            flexShrink: 0,
                            marginTop: 2,
                          }}
                        />
                        <span style={{ color: "var(--text-primary)" }}>{a}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                color: "var(--text-tertiary)",
                fontSize: "var(--text-sm)",
                textAlign: "center",
                padding: 24,
              }}
            >
              Summary will generate once the call ends.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
