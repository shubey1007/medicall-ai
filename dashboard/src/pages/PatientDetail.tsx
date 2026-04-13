// dashboard/src/pages/PatientDetail.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { formatDate, formatDuration } from "@/lib/format";
import type { Patient, Call, Appointment, PaginatedResponse } from "@/types";

const URGENCY_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-red-100 text-red-800",
  critical: "bg-red-200 text-red-900 font-semibold",
};

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
          <div className="text-right text-xs text-slate-400">
            <div>Patient since</div>
            <div className="font-medium text-slate-600">{formatDate(patient.created_at)}</div>
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
                    <td className="px-4 py-3 text-slate-600">{formatDate(a.scheduled_at)}</td>
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
                    <td className="px-4 py-3 text-slate-600">{formatDate(c.started_at)}</td>
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
