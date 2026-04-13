// dashboard/src/pages/AddPatient.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

export default function AddPatient() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [allergies, setAllergies] = useState("");
  const [conditions, setConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { setError("Phone number is required."); return; }
    setSubmitting(true);
    setError("");
    try {
      const medical_context: Record<string, string[]> = {};
      if (allergies.trim())
        medical_context.allergies = allergies.split(",").map((s) => s.trim()).filter(Boolean);
      if (conditions.trim())
        medical_context.conditions = conditions.split(",").map((s) => s.trim()).filter(Boolean);
      if (medications.trim())
        medical_context.medications = medications.split(",").map((s) => s.trim()).filter(Boolean);

      await api.post("/api/patients", {
        phone: phone.trim(),
        name: name.trim() || null,
        medical_context,
      });
      navigate("/patients");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to create patient.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Add Patient</h1>
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <Field label="Phone Number *">
          <input type="tel" placeholder="+1234567890" value={phone}
            onChange={(e) => setPhone(e.target.value)} required
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Full Name">
          <input type="text" placeholder="Jane Doe" value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Allergies (comma-separated)">
          <input type="text" placeholder="Penicillin, Peanuts" value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Conditions (comma-separated)">
          <input type="text" placeholder="Diabetes, Hypertension" value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Medications (comma-separated)">
          <input type="text" placeholder="Metformin, Lisinopril" value={medications}
            onChange={(e) => setMedications(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </Field>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded">
            {submitting ? "Saving..." : "Save Patient"}
          </button>
          <button type="button" onClick={() => navigate("/patients")}
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
