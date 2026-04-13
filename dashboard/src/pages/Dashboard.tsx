// dashboard/src/pages/Dashboard.tsx
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAppSelector } from "@/store";
import ActiveCallCard from "@/components/ActiveCallCard";
import type { Patient, PaginatedResponse } from "@/types";

interface Stats {
  total_calls: number;
  active_calls: number;
  completed_calls: number;
  average_duration_seconds: number;
}

export default function Dashboard() {
  const activeCalls = useAppSelector((s) => Object.values(s.calls.activeCalls));
  const [stats, setStats] = useState<Stats | null>(null);

  // Make Call form state
  const [showCallForm, setShowCallForm] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "success" | "error">("idle");
  const [callError, setCallError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ total_calls: number; active_calls: number; completed_calls: number; average_duration_seconds: number }>("/api/analytics/summary").then((r) => setStats(r.data));
    const interval = setInterval(() => {
      api.get<{ total_calls: number; active_calls: number; completed_calls: number; average_duration_seconds: number }>("/api/analytics/summary").then((r) => setStats(r.data));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (showCallForm) searchRef.current?.focus();
  }, [showCallForm]);

  useEffect(() => {
    if (!showCallForm) return;
    const timer = setTimeout(() => {
      api
        .get<PaginatedResponse<Patient>>("/api/patients", { params: { search: patientSearch, page_size: 10 } })
        .then((r) => setPatients(r.data.items));
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
      setTimeout(() => { setShowCallForm(false); setCallStatus("idle"); }, 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to initiate call";
      setCallError(msg);
      setCallStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <button
          onClick={showCallForm ? () => setShowCallForm(false) : openCallForm}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
        >
          {showCallForm ? "Cancel" : "Make Call"}
        </button>
      </div>

      {showCallForm && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-slate-700">Select a patient to call</p>

          {/* Patient search */}
          <div className="relative">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by name or phone..."
              value={patientSearch}
              onChange={(e) => { setPatientSearch(e.target.value); setSelectedPatient(null); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              disabled={callStatus === "calling"}
            />
            {showDropdown && patients.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-auto">
                {patients.map((p) => (
                  <li
                    key={p.id}
                    onMouseDown={() => selectPatient(p)}
                    className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                  >
                    <span className="font-medium text-sm">{p.name ?? "—"}</span>
                    <span className="text-xs text-slate-500 font-mono">{p.phone}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Selected patient preview */}
          {selectedPatient && (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded px-3 py-2">
              <div>
                <span className="font-medium text-sm text-blue-900">{selectedPatient.name ?? "Unknown"}</span>
                <span className="ml-2 text-xs text-blue-700 font-mono">{selectedPatient.phone}</span>
              </div>
              <button onClick={handleInitiateCall} disabled={callStatus === "calling"}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded">
                {callStatus === "calling" ? "Calling..." : "Call Now"}
              </button>
            </div>
          )}

          {callStatus === "success" && <p className="text-green-600 text-sm font-medium">Call initiated successfully!</p>}
          {callStatus === "error" && <p className="text-red-600 text-sm">{callError}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Active Calls" value={activeCalls.length} accent="green" />
        <StatCard label="Total Calls" value={stats?.total_calls ?? "—"} />
        <StatCard label="Completed" value={stats?.completed_calls ?? "—"} />
        <StatCard
          label="Avg Duration"
          value={stats ? `${Math.floor(stats.average_duration_seconds)}s` : "—"}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3 text-slate-900">Active Calls</h2>
        {activeCalls.length === 0 ? (
          <div className="bg-white rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
            No active calls. Use "Make Call" above to initiate one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeCalls.map((call) => (
              <ActiveCallCard key={call.callSid} call={call} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: "green" }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent === "green" ? "text-green-600" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}
