// dashboard/src/pages/PatientDetail.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { formatDate, formatDatePretty, formatDuration, formatTimePretty } from "@/lib/format";
import type { Patient, Call, Appointment, PaginatedResponse } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  ringing: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-slate-100 text-slate-700",
  failed: "bg-red-100 text-red-800",
};

const APPT_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  cancelled: "bg-slate-100 text-slate-500 line-through",
  completed: "bg-green-100 text-green-800",
};

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

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
    ]).then(([pRes, cRes, aRes]) => {
      setPatient(pRes.data);
      setEditName(pRes.data.name ?? "");
      // filter calls that belong to this patient
      setCalls(cRes.data.items.filter((c) => c.patient_id === id));
      setAppointments(aRes.data.items);
    }).finally(() => setLoading(false));
  }, [id]);

  async function handleSaveName() {
    if (!patient) return;
    setSaving(true);
    try {
      const res = await api.put<Patient>(`/api/patients/${patient.id}`, { name: editName });
      setPatient(res.data);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleCall() {
    if (!patient) return;
    const label = patient.name ?? patient.phone;
    if (!window.confirm(`Call ${label} at ${patient.phone}?`)) return;
    setCalling(true);
    try {
      await api.post("/api/calls/initiate", { to_phone: patient.phone });
    } catch {
      // silent
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

  if (loading) return <div className="p-8 text-slate-500">Loading...</div>;
  if (!patient) return <div className="p-8 text-red-500">Patient not found.</div>;

  const ctx = patient.medical_context as Record<string, string[]>;
  const allergies: string[] = ctx.allergies ?? [];
  const conditions: string[] = ctx.conditions ?? [];
  const medications: string[] = ctx.medications ?? [];

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link to="/patients" className="text-blue-600 text-sm hover:underline">
        &larr; Back to Patients
      </Link>

      {/* Patient header */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xl font-bold">
                {(patient.name ?? patient.phone).charAt(0).toUpperCase()}
              </div>
              <div>
                {editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="border border-slate-300 rounded px-2 py-1 text-lg font-semibold"
                      autoFocus
                    />
                    <button onClick={handleSaveName} disabled={saving}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded disabled:opacity-50">
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button onClick={() => setEditing(false)} className="px-3 py-1 bg-slate-200 text-slate-700 text-sm rounded">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold text-slate-900">{patient.name ?? "—"}</h1>
                    <button onClick={() => setEditing(true)}
                      className="text-xs text-blue-600 hover:underline">Edit</button>
                  </div>
                )}
                <p className="text-slate-500 font-mono text-sm mt-0.5">{patient.phone}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex gap-2">
              <button
                onClick={handleCall}
                disabled={calling}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {calling ? "Calling..." : "📞 Call"}
              </button>
              <button
                onClick={openScheduleModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
              >
                📅 Schedule Call
              </button>
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>Patient since</div>
              <div className="font-medium text-slate-600">{formatDate(patient.created_at)}</div>
            </div>
          </div>
        </div>

        {/* Medical context */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <MedSection title="Allergies" items={allergies} color="red" />
          <MedSection title="Conditions" items={conditions} color="yellow" />
          <MedSection title="Medications" items={medications} color="blue" />
        </div>
      </div>

      {/* Appointments */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Appointments</h2>
        {appointments.length === 0 ? (
          <Empty text="No appointments on record." />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Doctor</th>
                  <th className="px-4 py-3 text-left">Date &amp; Time</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{a.doctor_name}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{formatDatePretty(a.scheduled_at)}</div>
                      <div className="text-xs text-slate-500">{formatTimePretty(a.scheduled_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${APPT_COLORS[a.status] ?? ""}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{a.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Schedule Appointment</h2>
            <p className="text-sm text-slate-500 mb-4">
              For {patient.name ?? patient.phone}
            </p>
            <form onSubmit={submitSchedule} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 uppercase mb-1">Doctor Name *</label>
                <input
                  type="text"
                  placeholder="Dr. Patel"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  required
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 uppercase mb-1">Date &amp; Time *</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 uppercase mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm resize-none"
                />
              </div>

              {scheduleError && <p className="text-red-600 text-sm">{scheduleError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={scheduling}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
                >
                  {scheduling ? "Scheduling..." : "Schedule"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSchedule(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Call history */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Call History</h2>
        {calls.length === 0 ? (
          <Empty text="No calls for this patient yet." />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Duration</th>
                  <th className="px-4 py-3 text-left">Agent</th>
                  <th className="px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{formatDatePretty(c.started_at)}</div>
                      <div className="text-xs text-slate-500">{formatTimePretty(c.started_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[c.status] ?? ""}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{c.duration_seconds != null ? formatDuration(c.duration_seconds) : "—"}</td>
                    <td className="px-4 py-3 capitalize">{c.current_agent}</td>
                    <td className="px-4 py-3">
                      <Link to={`/calls/${c.id}`} className="text-blue-600 hover:underline text-xs">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MedSection({ title, items, color }: { title: string; items: string[]; color: "red" | "yellow" | "blue" }) {
  const bg = { red: "bg-red-50 border-red-200", yellow: "bg-yellow-50 border-yellow-200", blue: "bg-blue-50 border-blue-200" }[color];
  const badge = { red: "bg-red-100 text-red-800", yellow: "bg-yellow-100 text-yellow-800", blue: "bg-blue-100 text-blue-800" }[color];
  return (
    <div className={`border rounded-lg p-3 ${bg}`}>
      <div className="text-xs font-semibold uppercase text-slate-500 mb-2">{title}</div>
      {items.length === 0 ? (
        <span className="text-xs text-slate-400">None recorded</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <span key={item} className={`px-2 py-0.5 rounded-full text-xs ${badge}`}>{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="bg-white border border-dashed border-slate-200 rounded-lg p-6 text-center text-slate-400 text-sm">
      {text}
    </div>
  );
}
