// dashboard/src/pages/Appointments.tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { Appointment, PaginatedResponse, Patient } from "@/types";
import Icon from "@/components/primitives/Icon";
import { formatDatePretty, formatTimePretty } from "@/lib/format";
import { dashboardSocket } from "@/lib/socket";
import { useConfirm } from "@/components/Confirm/ConfirmProvider";
import AppointmentStatusSelect from "@/components/AppointmentStatusSelect";

export default function Appointments() {
  const confirm = useConfirm();
  const [items, setItems] = useState<Appointment[]>([]);
  const [total, setTotal] = useState(0);
  const [reminding, setReminding] = useState<string | null>(null);
  const [patientsById, setPatientsById] = useState<Record<string, Patient>>({});
  const [statusFilter, setStatusFilter] = useState<string>("");

  async function load() {
    const params: Record<string, string | number> = { page_size: 50 };
    if (statusFilter) params.status = statusFilter;
    try {
      const r = await api.get<PaginatedResponse<Appointment>>("/api/appointments", { params });
      setItems(r.data.items);
      setTotal(r.data.total);
      // Load unique patient names
      const uniquePatientIds = Array.from(new Set(r.data.items.map((a) => a.patient_id)));
      const missing = uniquePatientIds.filter((id) => !patientsById[id]);
      if (missing.length > 0) {
        const results = await Promise.all(
          missing.map((id) =>
            api
              .get<Patient>(`/api/patients/${id}`)
              .then((res) => [id, res.data] as const)
              .catch(() => [id, null] as const),
          ),
        );
        setPatientsById((prev) => {
          const next = { ...prev };
          for (const [id, p] of results) if (p) next[id] = p;
          return next;
        });
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // Listen for live appointment:created events from the backend — fired when
  // the Scheduling agent books during a call. Without this, the booking is
  // in the DB but the page shows stale data until manual refresh.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const handler = () => {
      void loadRef.current();
    };
    dashboardSocket.on("appointment:created", handler);
    return () => {
      dashboardSocket.off("appointment:created", handler);
    };
  }, []);

  async function sendReminder(id: string) {
    setReminding(id);
    try {
      await api.post(`/api/appointments/${id}/remind`);
    } finally {
      setReminding(null);
    }
  }

  async function cancel(id: string) {
    const ok = await confirm({
      title: "Cancel this appointment?",
      body: "The patient will not be reminded. You can re-book from the Schedule page.",
      confirmLabel: "Cancel appointment",
      cancelLabel: "Keep",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/api/appointments/${id}`);
    await load();
  }

  function patchLocally(id: string, next: Partial<Appointment>) {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...next } : a)));
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Appointments</h1>
          <div className="page-sub">
            {total} total · auto-booked by Scheduling Agent
          </div>
        </div>
        <div className="page-actions">
          <div className="seg">
            {[
              { v: "", label: "All" },
              { v: "pending", label: "Pending" },
              { v: "confirmed", label: "Confirmed" },
              { v: "completed", label: "Completed" },
              { v: "cancelled", label: "Cancelled" },
            ].map((f) => (
              <button
                key={f.v}
                className={statusFilter === f.v ? "active" : ""}
                onClick={() => setStatusFilter(f.v)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary" onClick={() => load()}>
            <Icon name="refresh-cw" size={14} /> Refresh
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <Icon name="calendar-x" size={32} style={{ color: "var(--text-tertiary)" }} />
          <div style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-primary)" }}>
            No appointments yet
          </div>
          <div>Scheduling Agent can book slots during inbound calls.</div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Doctor</th>
                <th>When</th>
                <th>Status</th>
                <th>Notes</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const patient = patientsById[a.patient_id];
                return (
                  <tr key={a.id} style={{ cursor: "default" }}>
                    <td>
                      {patient ? (
                        <Link
                          to={`/patients/${patient.id}`}
                          style={{ color: "var(--text-primary)", fontWeight: 500 }}
                        >
                          {patient.name ?? patient.phone}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--text-tertiary)" }}>Loading…</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 500 }}>{a.doctor_name}</td>
                    <td className="mono">
                      {formatDatePretty(a.scheduled_at)} · {formatTimePretty(a.scheduled_at)}
                    </td>
                    <td>
                      <AppointmentStatusSelect
                        appointmentId={a.id}
                        status={a.status}
                        onChange={(next) => patchLocally(a.id, { status: next })}
                      />
                    </td>
                    <td style={{ color: "var(--text-secondary)", maxWidth: 300 }}>
                      {a.notes ?? "—"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => sendReminder(a.id)}
                          disabled={reminding === a.id || a.status === "cancelled"}
                        >
                          <Icon name="bell" size={12} />
                          {reminding === a.id ? "Calling…" : "Remind"}
                        </button>
                        {a.status !== "cancelled" && (
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => cancel(a.id)}
                            style={{ color: "var(--danger)" }}
                          >
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
