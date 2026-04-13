// dashboard/src/pages/Doctors.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { Doctor, PaginatedResponse } from "@/types";

const DAY_LABELS: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

export default function Doctors() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function loadDoctors(q: string) {
    const r = await api.get<PaginatedResponse<Doctor>>("/api/doctors", {
      params: { search: q },
    });
    setDoctors(r.data.items);
  }

  useEffect(() => {
    const t = setTimeout(() => loadDoctors(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await api.delete(`/api/doctors/${id}`);
      setDoctors((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Doctors</h1>
        <Link
          to="/doctors/add"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
        >
          Add Doctor
        </Link>
      </div>

      <input
        type="text"
        placeholder="Search by name or specialization..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-md px-4 py-2 border border-slate-300 rounded"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {doctors.map((doc) => (
          <div key={doc.id} className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-slate-900">{doc.name}</div>
                <div className="text-sm text-blue-600">{doc.specialization}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                doc.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
              }`}>
                {doc.is_active ? "Active" : "Inactive"}
              </span>
            </div>

            {doc.phone && <div className="text-sm text-slate-600 font-mono">{doc.phone}</div>}
            {doc.email && <div className="text-sm text-slate-500">{doc.email}</div>}

            <div>
              <div className="text-xs text-slate-400 uppercase mb-1">Availability</div>
              <div className="flex flex-wrap gap-1">
                {doc.available_days.map((d) => (
                  <span key={d} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                    {DAY_LABELS[d] ?? d}
                  </span>
                ))}
              </div>
              <div className="text-xs text-slate-500 mt-1">{doc.available_hours}</div>
            </div>

            {doc.bio && <p className="text-xs text-slate-500 line-clamp-2">{doc.bio}</p>}

            <button
              onClick={() => handleDelete(doc.id, doc.name)}
              disabled={deleting === doc.id}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {deleting === doc.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        ))}

        {doctors.length === 0 && (
          <div className="col-span-3 text-center text-slate-400 py-12">
            No doctors found.{" "}
            <Link to="/doctors/add" className="text-blue-600 hover:underline">Add one</Link>.
          </div>
        )}
      </div>
    </div>
  );
}
