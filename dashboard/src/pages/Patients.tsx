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
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .get<PaginatedResponse<Patient>>("/api/patients", { params: { search } })
        .then((r) => setPatients(r.data.items));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete patient ${label}? All associated calls will also be deleted.`)) return;
    setDeleting(id);
    try {
      await api.delete(`/api/patients/${id}`);
      setPatients((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setDeleting(null);
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
                  <button
                    onClick={() => handleDelete(p.id, p.name ?? p.phone)}
                    disabled={deleting === p.id}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {deleting === p.id ? "..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
