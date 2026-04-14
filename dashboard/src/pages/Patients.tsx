// dashboard/src/pages/Patients.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { PaginatedResponse, Patient } from "@/types";
import { maskPhone, formatDate } from "@/lib/format";

export default function Patients() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [calling, setCalling] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Patient | null>(null);
  const [doctorName, setDoctorName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .get<PaginatedResponse<Patient>>("/api/patients", { params: { search } })
        .then((r) => setPatients(r.data.items));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleCall(p: Patient) {
    const label = p.name ?? p.phone;
    if (!window.confirm(`Call ${label} at ${p.phone}?`)) return;
    setCalling(p.id);
    try {
      await api.post("/api/calls/initiate", { to_phone: p.phone });
    } catch {
      // silent
    } finally {
      setCalling(null);
    }
  }

  function openScheduleModal(p: Patient) {
    setScheduleFor(p);
    setDoctorName("");
    setScheduledAt("");
    setNotes("");
    setScheduleError("");
  }

  function closeScheduleModal() {
    setScheduleFor(null);
  }

  async function submitSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleFor) return;
    if (!doctorName.trim() || !scheduledAt) {
      setScheduleError("Doctor name and date/time are required.");
      return;
    }
    setScheduling(true);
    setScheduleError("");
    try {
      await api.post("/api/appointments", {
        patient_id: scheduleFor.id,
        doctor_name: doctorName.trim(),
        scheduled_at: new Date(scheduledAt).toISOString(),
        notes: notes.trim() || null,
      });
      closeScheduleModal();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to schedule appointment.";
      setScheduleError(msg);
    } finally {
      setScheduling(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
        <button
          onClick={() => navigate("/patients/add")}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
        >
          Add Patient
        </button>
      </div>

      <input
        type="text"
        placeholder="Search by name or phone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-md px-4 py-2 border border-slate-300 rounded"
      />

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-left">Medical Context</th>
              <th className="px-4 py-3 text-left">Since</th>
              <th className="px-4 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/patients/${p.id}`} className="text-blue-600 hover:underline font-medium">
                    {p.name || "—"}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-sm">{maskPhone(p.phone)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {Object.keys(p.medical_context).length === 0
                    ? "—"
                    : Object.keys(p.medical_context).join(", ")}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{formatDate(p.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleCall(p)}
                      disabled={calling === p.id}
                      className="text-xs text-green-600 hover:text-green-800 font-medium disabled:opacity-50"
                    >
                      {calling === p.id ? "Calling..." : "Call"}
                    </button>
                    <button
                      onClick={() => openScheduleModal(p)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Schedule
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scheduleFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Schedule Appointment</h2>
            <p className="text-sm text-slate-500 mb-4">
              For {scheduleFor.name ?? scheduleFor.phone}
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
                  onClick={closeScheduleModal}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
