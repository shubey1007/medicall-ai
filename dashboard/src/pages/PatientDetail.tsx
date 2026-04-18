// dashboard/src/pages/PatientDetail.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Appointment, Call, PaginatedResponse, Patient } from "@/types";
import Icon from "@/components/primitives/Icon";
import UrgencyBar from "@/components/primitives/UrgencyBar";
import AgentPill, { AGENTS } from "@/components/primitives/AgentPill";
import { formatDatePretty, formatDuration, formatTimePretty, initialsFrom, maskPhone } from "@/lib/format";
import { useConfirm } from "@/components/Confirm/ConfirmProvider";
import AppointmentStatusSelect from "@/components/AppointmentStatusSelect";

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [calling, setCalling] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [doctorName, setDoctorName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<Patient>(`/api/patients/${id}`),
      api.get<PaginatedResponse<Call>>(`/api/calls`, { params: { page_size: 20 } }),
      api.get<PaginatedResponse<Appointment>>(`/api/appointments`, { params: { patient_id: id, page_size: 20 } }),
    ])
      .then(([pRes, cRes, aRes]) => {
        setPatient(pRes.data);
        setCalls(cRes.data.items.filter((c) => c.patient_id === id));
        setAppointments(aRes.data.items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleCall() {
    if (!patient) return;
    const label = patient.name ?? patient.phone;
    const ok = await confirm({
      title: `Call ${label}?`,
      body: `MediCall will place an outbound call to ${patient.phone}.`,
      confirmLabel: "Place call",
    });
    if (!ok) return;
    setCalling(true);
    try {
      await api.post("/api/calls/initiate", { to_phone: patient.phone });
    } finally {
      setCalling(false);
    }
  }

  function openScheduleModal() {
    setDoctorName("");
    setScheduledAt("");
    setNotes("");
    setScheduleError("");
    setShowSchedule(true);
  }

  async function submitSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!patient) return;
    if (!doctorName.trim() || !scheduledAt) {
      setScheduleError("Doctor name and date/time are required.");
      return;
    }
    setScheduling(true);
    setScheduleError("");
    try {
      const res = await api.post<Appointment>("/api/appointments", {
        patient_id: patient.id,
        doctor_name: doctorName.trim(),
        scheduled_at: new Date(scheduledAt).toISOString(),
        notes: notes.trim() || null,
      });
      setAppointments((prev) => [res.data, ...prev]);
      setShowSchedule(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to schedule appointment.";
      setScheduleError(msg);
    } finally {
      setScheduling(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="empty">
          <Icon name="loader" size={24} />
          Loading patient…
        </div>
      </div>
    );
  }
  if (!patient) {
    return (
      <div className="page">
        <div className="empty" style={{ color: "var(--danger)" }}>
          Patient not found.
        </div>
      </div>
    );
  }

  const ctx = patient.medical_context as {
    allergies?: string[];
    conditions?: string[];
    medications?: string[];
    age?: number | string;
    bloodType?: string;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => navigate("/patients")}
            style={{ marginBottom: 8 }}
          >
            <Icon name="chevron-left" size={14} /> Back to patients
          </button>
          <h1 className="page-title">{patient.name ?? "Unknown"}</h1>
          <div className="page-sub mono">
            {maskPhone(patient.phone)} · patient since {formatDatePretty(patient.created_at)}
          </div>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setDetailsOpen(true)}
          >
            <Icon name="info" size={14} /> View details
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => navigate(`/patients/${patient.id}/edit`)}
          >
            <Icon name="edit-3" size={14} /> Edit
          </button>
          <button className="btn btn-secondary" onClick={openScheduleModal}>
            <Icon name="calendar-plus" size={14} /> Schedule
          </button>
          <button className="btn btn-primary" onClick={handleCall} disabled={calling}>
            <Icon name="phone-outgoing" size={14} /> {calling ? "Calling…" : "Outbound call"}
          </button>
        </div>
      </div>

      {detailsOpen && (
        <>
          <div className="panel-backdrop" onClick={() => setDetailsOpen(false)} />
          <div className="panel">
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button className="icon-btn" onClick={() => setDetailsOpen(false)} title="Close">
                <Icon name="chevron-left" size={18} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
                  Patient details
                </div>
                <div
                  style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}
                >
                  Read-only view · click Edit to change
                </div>
              </div>
            </div>
            <div
              style={{
                overflowY: "auto",
                padding: 20,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                flex: 1,
              }}
            >
        <div className="panel-card" style={{ padding: 0, border: 0, background: "transparent", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="patient-avatar">{initialsFrom(patient.name, "??")}</div>
            <div>
              <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
                {patient.name ?? "Unknown"}
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                ID · {patient.id.slice(0, 12)}
              </div>
            </div>
          </div>

          <div className="divider" />

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="meta-row">
              <span className="k">Phone</span>
              <span className="v">{maskPhone(patient.phone)}</span>
            </div>
            <div className="meta-row">
              <span className="k">Age</span>
              <span className="v">{ctx.age ?? "—"}</span>
            </div>
            <div className="meta-row">
              <span className="k">Blood type</span>
              <span className="v">{ctx.bloodType ?? "—"}</span>
            </div>
            <div className="meta-row">
              <span className="k">Total calls</span>
              <span className="v">{calls.length}</span>
            </div>
            <div className="meta-row">
              <span className="k">Last call</span>
              <span className="v">
                {calls[0] ? formatDatePretty(calls[0].started_at) : "—"}
              </span>
            </div>
          </div>

          <div className="divider" />

          <div>
            <div className="overline" style={{ marginBottom: 8 }}>
              Allergies
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(ctx.allergies?.length ?? 0) === 0 ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  None reported
                </span>
              ) : (
                ctx.allergies!.map((a, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 11,
                      background: "var(--warning-subtle)",
                      color: "var(--warning)",
                      padding: "3px 10px",
                      borderRadius: "var(--radius-full)",
                      border: "1px solid rgba(251,191,36,0.25)",
                    }}
                  >
                    ⚠ {a}
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="overline" style={{ marginBottom: 8 }}>
              Conditions
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(ctx.conditions?.length ?? 0) === 0 ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  None reported
                </span>
              ) : (
                ctx.conditions!.map((a, i) => (
                  <span key={i} className="badge badge-neutral">
                    {a}
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="overline" style={{ marginBottom: 8 }}>
              Medications
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(ctx.medications?.length ?? 0) === 0 ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  None reported
                </span>
              ) : (
                ctx.medications!.map((a, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 11,
                      background: "var(--success-subtle)",
                      color: "var(--success)",
                      padding: "3px 10px",
                      borderRadius: "var(--radius-full)",
                      border: "1px solid rgba(52,211,153,0.25)",
                    }}
                  >
                    {a}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
            </div>
          </div>
        </>
      )}

      {/* Main content — timeline + appointments take the full width now. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Call timeline */}
          <div>
            <div className="overline" style={{ marginBottom: 14 }}>
              Call timeline · {calls.length}
            </div>
            {calls.length === 0 ? (
              <div className="empty">
                <Icon name="phone-off" size={32} style={{ color: "var(--text-tertiary)" }} />
                <div style={{ fontSize: "var(--text-md)", color: "var(--text-primary)", fontWeight: 600 }}>
                  No calls yet
                </div>
                <div>This patient has not contacted MediCall.</div>
              </div>
            ) : (
              <div className="ctl">
                {calls.map((c, i) => {
                  const lastAgent = AGENTS[(c.current_agent || "").toLowerCase()];
                  return (
                    <Link
                      to={`/calls/${c.id}`}
                      key={c.id}
                      className="ctl-item"
                      style={{
                        color: lastAgent?.color ?? "var(--text-secondary)",
                        animation: "stagger-up 0.3s var(--ease-out) both",
                        animationDelay: `${i * 50}ms`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          color: "var(--text-primary)",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
                            {c.status === "failed" ? "Call failed" : "Call completed"}
                          </div>
                          <div
                            style={{
                              fontSize: "var(--text-xs)",
                              color: "var(--text-tertiary)",
                              marginTop: 2,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {formatDatePretty(c.started_at)} · {formatTimePretty(c.started_at)} ·{" "}
                            {formatDuration(c.duration_seconds)}
                          </div>
                        </div>
                        {c.urgency_level && <UrgencyBar level={c.urgency_level} />}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                        <AgentPill agent={c.current_agent} size="sm" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Appointments */}
          <div>
            <div className="overline" style={{ marginBottom: 14 }}>
              Appointments · {appointments.length}
            </div>
            {appointments.length === 0 ? (
              <div
                className="empty"
                style={{ padding: "28px 16px", fontSize: "var(--text-sm)" }}
              >
                No appointments on record.
              </div>
            ) : (
              <div className="card" style={{ overflow: "hidden" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Doctor</th>
                      <th>Date &amp; Time</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((a) => (
                      <tr key={a.id} style={{ cursor: "default" }}>
                        <td style={{ fontWeight: 500 }}>{a.doctor_name}</td>
                        <td className="mono">
                          {formatDatePretty(a.scheduled_at)} · {formatTimePretty(a.scheduled_at)}
                        </td>
                        <td>
                          <AppointmentStatusSelect
                            appointmentId={a.id}
                            status={a.status}
                            onChange={(next) =>
                              setAppointments((prev) =>
                                prev.map((x) => (x.id === a.id ? { ...x, status: next } : x)),
                              )
                            }
                          />
                        </td>
                        <td style={{ color: "var(--text-tertiary)" }}>{a.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      {showSchedule && (
        <div className="modal-backdrop" onClick={() => setShowSchedule(false)}>
          <div
            className="modal"
            style={{ width: 460, padding: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: 20,
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>
                Schedule appointment
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 4 }}>
                For {patient.name ?? patient.phone}
              </div>
            </div>
            <form
              onSubmit={submitSchedule}
              style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div>
                <div className="overline" style={{ marginBottom: 6 }}>
                  Doctor name *
                </div>
                <input
                  className="input"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="Dr. Patel"
                  required
                />
              </div>
              <div>
                <div className="overline" style={{ marginBottom: 6 }}>
                  Date &amp; time *
                </div>
                <input
                  className="input"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                />
              </div>
              <div>
                <div className="overline" style={{ marginBottom: 6 }}>
                  Notes
                </div>
                <textarea
                  className="input"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes"
                />
              </div>
              {scheduleError && (
                <div style={{ color: "var(--danger)", fontSize: "var(--text-sm)" }}>
                  {scheduleError}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowSchedule(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={scheduling}>
                  {scheduling ? "Scheduling…" : "Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
