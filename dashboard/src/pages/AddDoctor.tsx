// dashboard/src/pages/AddDoctor.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

const ALL_DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const DAY_LABELS: Record<string, string> = {
  monday:"Mon", tuesday:"Tue", wednesday:"Wed",
  thursday:"Thu", friday:"Fri", saturday:"Sat", sunday:"Sun",
};

export default function AddDoctor() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [availableDays, setAvailableDays] = useState<string[]>(
    ["monday","tuesday","wednesday","thursday","friday"]
  );
  const [availableHours, setAvailableHours] = useState("09:00-17:00");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleDay(day: string) {
    setAvailableDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !specialization.trim()) {
      setError("Name and specialization are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.post("/api/doctors", {
        name: name.trim(),
        specialization: specialization.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        available_days: availableDays,
        available_hours: availableHours,
        bio: bio.trim() || null,
        is_active: true,
      });
      navigate("/doctors");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to create doctor.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Add Doctor</h1>
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <Field label="Full Name *">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Dr. Priya Sharma" required
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Specialization *">
          <input value={specialization} onChange={(e) => setSpecialization(e.target.value)}
            placeholder="Cardiology" required
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Phone">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+1234567890"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="doctor@clinic.com"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Available Days">
          <div className="flex flex-wrap gap-2 mt-1">
            {ALL_DAYS.map((day) => (
              <button key={day} type="button" onClick={() => toggleDay(day)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  availableDays.includes(day)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-600 border-slate-300 hover:border-blue-400"
                }`}>
                {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Available Hours (e.g. 09:00-17:00)">
          <input value={availableHours} onChange={(e) => setAvailableHours(e.target.value)}
            placeholder="09:00-17:00"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Bio (optional)">
          <textarea value={bio} onChange={(e) => setBio(e.target.value)}
            rows={3} placeholder="Brief background of the doctor..."
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm resize-none" />
        </Field>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded">
            {submitting ? "Saving..." : "Save Doctor"}
          </button>
          <button type="button" onClick={() => navigate("/doctors")}
            className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 uppercase mb-1">{label}</label>
      {children}
    </div>
  );
}
